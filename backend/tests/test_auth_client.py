"""Contract tests for the require_client auth hop (app/core/auth_client.py).

The middleware takes the caller's Authorization header, POSTs it to the
external authorization service, and maps the answer:

    service says    ->  endpoint returns
    --------------      ----------------
    200 allowed     ->  request proceeds
    401             ->  401  Invalid or expired token
    403             ->  403  Client access forbidden
    anything else   ->  503  Authorization service error
    outage/timeout  ->  503  Authorization service unavailable

The fake service (the `authorization_service` fixture, conftest.py) lets
each test script one of those answers. The REAL middleware code runs in
every test — only the network hop is replaced.

Sections:
    1. Local guard behavior   (what happens before the service is called)
    2. Status mapping         (service answer -> endpoint status)
    3. Request contract       (what the middleware sends to the service)
    4. Real-service behavior  (acceptance tests for open findings)
    5. Router coverage        (findings #24/#25 — rules & gdpr must hop)

Report-only findings referenced below (owners hold the fixes):
    #11  hardcoded AUTHORIZATION_URL        (auth_client.py)
    #12  backend JWT missing `role` claim   (HOMIE)
    #13  authorize route missing leading slash (ZRAY9A)
    #14  ADMIN missing client:access        (ZRAY9A)
    #24  rules router has no gateway hop    (MEHDI)
    #25  gdpr router has no gateway hop     (MTARZA)
"""
import jwt as pyjwt
import pytest

from app.core.config import settings

# Any require_client-guarded endpoint works; wallets is the simplest.
GUARDED = "/api/wallets/"


# ---------------------------------------------------------------------------
# 1. LOCAL GUARD BEHAVIOR — before any call to the authorization service
# ---------------------------------------------------------------------------


def test_missing_token_rejected_before_auth_service_is_called(
    client, authorization_service
):
    """SCENARIO:   caller sends no Authorization header at all.
    EXPECTED:   401 from the guard itself, and the external service is
                never contacted (it short-circuits locally)."""
    resp = client.get(GUARDED)

    assert resp.status_code == 401
    assert authorization_service.calls == []  # service never called


def test_allowed_response_lets_guarded_request_through(client, auth_headers):
    """SCENARIO:   valid token, service answers 200 "allowed" (the default).
    EXPECTED:   guard opens the door; business logic runs (the user's 5
                provisioned wallets are listed)."""
    resp = client.get(GUARDED, headers=auth_headers)

    assert resp.status_code == 200
    assert isinstance(resp.json(), list) and len(resp.json()) == 5


# ---------------------------------------------------------------------------
# 2. STATUS MAPPING — what the middleware does with each service answer
# ---------------------------------------------------------------------------


def test_auth_service_401_propagates_as_401(client, auth_headers, authorization_service):
    """SCENARIO:   service says 401 (invalid/expired token).
    EXPECTED:   endpoint 401 "Invalid or expired token" — 1:1 pass-through."""
    authorization_service.respond(401)

    resp = client.get(GUARDED, headers=auth_headers)

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or expired token"


def test_auth_service_403_propagates_as_403(client, auth_headers, authorization_service):
    """SCENARIO:   service says 403 (permission denied).
    EXPECTED:   endpoint 403 "Client access forbidden" — 1:1 pass-through."""
    authorization_service.respond(403)

    resp = client.get(GUARDED, headers=auth_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Client access forbidden"


def test_auth_service_404_maps_to_503__finding13_signature(
    client, auth_headers, authorization_service
):
    """SCENARIO:   service says 404 (unknown route).
    EXPECTED:   endpoint 503 "Authorization service error".

    NOTE — this is exactly what production does TODAY: finding #13
    (owner: ZRAY9A) — `router.post("authorize", ...)` is registered
    without the leading slash, so Express 5 answers 404 for the real
    path /api/authorize, and the backend turns that into 503."""
    authorization_service.respond(404, json={"detail": "Not Found"})

    resp = client.get(GUARDED, headers=auth_headers)

    assert resp.status_code == 503
    assert resp.json()["detail"] == "Authorization service error"


def test_auth_service_500_maps_to_503(client, auth_headers, authorization_service):
    """SCENARIO:   service crashes (500).
    EXPECTED:   endpoint 503 "Authorization service error" — unexpected
                service errors degrade to 503, not a 500 from our side."""
    authorization_service.respond(500)

    resp = client.get(GUARDED, headers=auth_headers)

    assert resp.status_code == 503
    assert resp.json()["detail"] == "Authorization service error"


def test_auth_service_outage_maps_to_503(client, auth_headers, authorization_service):
    """SCENARIO:   service is down — connection refused on the gateway's port.
    EXPECTED:   endpoint 503 "Authorization service unavailable"."""
    authorization_service.refuse()

    resp = client.get(GUARDED, headers=auth_headers)

    assert resp.status_code == 503
    assert resp.json()["detail"] == "Authorization service unavailable"


def test_auth_service_timeout_maps_to_503(client, auth_headers, authorization_service):
    """SCENARIO:   service accepts the connection but hangs past the
                middleware's 3-second timeout.
    EXPECTED:   endpoint 503 "Authorization service unavailable" (same
                RequestError branch as the outage)."""
    authorization_service.timeout()

    resp = client.get(GUARDED, headers=auth_headers)

    assert resp.status_code == 503
    assert resp.json()["detail"] == "Authorization service unavailable"


# ---------------------------------------------------------------------------
# 3. REQUEST CONTRACT — what the middleware sends to the service
# ---------------------------------------------------------------------------


def test_request_shape_contract(client, auth_headers, authorization_service):
    """SCENARIO:   one guarded request passes through the middleware.
    EXPECTED:   exactly one call to the service, carrying:
                  - the exact path /api/authorize
                  - the Authorization header VERBATIM (not rewritten)
                  - body exactly {"permission": "client:access"}

    This is the interface ZRAY9A's service is built against; changing any
    of these on the backend side is a breaking contract change and must
    fail here first."""
    client.get(GUARDED, headers=auth_headers)

    assert len(authorization_service.calls) == 1
    request = authorization_service.calls[0]
    assert request.url.path == "/api/authorize"
    assert request.headers["Authorization"] == auth_headers["Authorization"]
    assert request.read() == b'{"permission":"client:access"}'


# ---------------------------------------------------------------------------
# 4. REAL-SERVICE BEHAVIOR — "realish" mode: the fake decodes the JWT and
#    enforces the role claim like the real service does
# ---------------------------------------------------------------------------


def test_real_service_grants_token_with_role_claim(
    client, test_user, authorization_service
):
    """SCENARIO:   token that DOES carry a `role` claim ("client"), decoded
                by a real-behaving service.
    EXPECTED:   endpoint 200 — this is the contract the backend must
                satisfy. Green today only because the test crafts such a
                token itself.

    The token must ALSO satisfy the backend's own verification
    (app/core/deps.py get_current_user decodes the JWT and resolves the
    user), so `sub` has to be the real test user's id."""
    authorization_service.realish()
    token = pyjwt.encode(
        {"sub": str(test_user.id), "role": "client", "exp": 4102444800},
        settings.secret_key,
        algorithm="HS256",
    )

    resp = client.get(GUARDED, headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 200


#@pytest.mark.xfail(
#    strict=True,
#    reason=(
#        "finding #12 (owner: HOMIE): backend JWTs carry only sub+exp "
#        "(app/core/security.py create_access_token) — no `role` claim. "
#        "The real authorization service (authenticate.ts) requires "
#        "payload.role, so every genuine backend token is rejected 403 "
#        "and NO guarded endpoint is reachable in production today. "
#        "xfails NOW (endpoint returns 403); flips to XPASS — and must be "
#        "un-marked — when create_access_token adds the role claim."
#    ),
#)
def test_real_service_accepts_backend_token_once_role_claim_exists(
    client, auth_headers, authorization_service
):
    """SCENARIO:   a GENUINE backend token (auth_headers fixture — the same
                create_access_token production uses) meets a real-behaving
                service.
    EXPECTED:   endpoint 200 — the DESIRED end state, i.e. finding #12
                fixed. Fails today (403) exactly because the token has no
                `role` claim; marked xfail-strict so the suite stays green
                for CI while the bug is tracked, and turns into a loud
                XPASS the moment HOMIE's fix lands."""
    authorization_service.realish()

    resp = client.get(GUARDED, headers=auth_headers)

    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# 5. ROUTER COVERAGE — every business router must cross the hop
#    (findings #24 rules / #25 gdpr; owners: MEHDI / MTARZA)
#
# transactions, wallets (and the merged analytics module) apply
# `dependencies=[Depends(require_client)]` at the router level. rules and
# gdpr do NOT — they authenticate locally (get_current_user) but never ask
# the api-gateway whether the request is allowed. Same class as #15 (AI,
# filed on PR #52); pinned here xfail-strict, one test per router: each
# XPASSes (turning the suite red ON PURPOSE) when the hop lands and must
# then be converted to a plain test with the finding closed in TESTS.md.
# ---------------------------------------------------------------------------


@pytest.mark.xfail(
    strict=True,
    reason="finding #24 (owner: MEHDI): the rules router has no gateway hop "
           "— app/api/rules.py:13 creates the APIRouter without "
           "dependencies=[Depends(require_client)] (the import even sits "
           "commented out in the file). Requests are authenticated locally "
           "but never authorized by the api-gateway, unlike wallets/"
           "transactions. Fix: add the dependency like the other routers.",
)
def test_rules_routes_go_through_the_gateway_hop(
    client, auth_headers, authorization_service
):
    """SCENARIO:   GET /api/rules/ with a valid backend token.
    EXPECTED:   the request crosses the authorization hop exactly once
                before the endpoint answers (the seam records the call) —
                the same contract wallets and transactions honor."""
    resp = client.get("/api/rules/", headers=auth_headers)

    assert resp.status_code == 200
    assert len(authorization_service.calls) == 1, \
        "finding #24: rules answered WITHOUT crossing the gateway hop"


@pytest.mark.xfail(
    strict=True,
    reason="finding #25 (owner: MTARZA): the gdpr router has no gateway hop "
           "— app/gdpr/router.py:22 creates the APIRouter without "
           "dependencies=[Depends(require_client)]. Same gap as #24/#15; "
           "the export/delete paths are as sensitive as any money endpoint.",
)
def test_gdpr_routes_go_through_the_gateway_hop(
    client, auth_headers, authorization_service
):
    """SCENARIO:   GET /api/gdpr/export with a valid backend token.
    EXPECTED:   the request crosses the authorization hop exactly once
                before the export answers."""
    resp = client.get("/api/gdpr/export", headers=auth_headers)

    assert resp.status_code == 200
    assert len(authorization_service.calls) == 1, \
        "finding #25: gdpr answered WITHOUT crossing the gateway hop"
