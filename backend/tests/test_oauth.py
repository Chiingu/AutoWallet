"""Tests for the Google OAuth module and the linked-account gate (PR #19).

Sections:
    1. Gate & link flows       (green: the documented design works today)
    2. Google callback errors  (green: hostile inputs end in clean 401s —
                               re-pinned to the state dance after PR #51)
    3. Acceptance tests        (finding #10 legs; xfail-strict while open)
    4. Provisioning parity     (OAuth signup promises the same 5+4)
    5. OAuth security          (#17/#18/#19 CLOSED and pinned as plain
                               tests; #20 still xfail-strict)

Report-only findings referenced below (owners hold the fixes):
    #9   OAuth config hard-requires 3 Google secrets — verified live via
         the compose boot crash; no automated test here (it is a
         config-boot behavior, not an endpoint).
    #10  transactions must be gated by require_linked_account like
         wallets/rules are — POST leg FIXED, GET leg REOPENED (see §3).
    #17  the OAuth state is not bound to the browser that requested it —
         login-CSRF / authorization-code injection (see §5). FIXED by
         Mehdi's OAuth hardening; the acceptance test is now a plain pin.
    #18  Google's email is linked onto existing password accounts without
         checking email_verified — the classic OAuth ATO pattern (see §5).
         FIXED (email_verified required; silent linking removed entirely).
    #19  a userinfo answer without "sub" crashes with KeyError/500 instead
         of the intended clean 401 (see §5). FIXED (.get() + explicit 401).
    #20  the 4 required settings PR #51 added are missing from the
         committed .env.example, so the app can't boot from it (see §5).

The full Google round-trip (real redirect, real token exchange) is not
tested here — it needs live Google credentials; the callback is tested
from the point where Google would have answered (code exchange -> 401).
The state dance (GET /login, harvest state from the redirect, replay it
at /callback) IS exercised — against fakeredis, never Google.
"""
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from app.core.security import create_access_token
from app.models.models import User
from app.models.models import UserRole



@pytest.fixture
def oauth_user_id(db_session):
    """An OAuth-style user exactly like Google signup produces:
    no password, no bank account, plus the same provisioning the
    Google callback performs (5 wallets + 4 rules)."""
    from app.services.provisioning import create_default_rules, create_default_wallets

    user = User(
        email="oauth.user@autowallet.dev",
        full_name="OAuth User",
        hashed_password=None,
        bank_account_id=None,
        oauth_provider="google",
        oauth_id="google-id-1",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    user_id = user.id  # read eagerly: commits below expire ORM objects
    create_default_wallets(user, db_session)
    create_default_rules(user, db_session)
    db_session.commit()
    return user_id


@pytest.fixture
def oauth_headers(oauth_user_id):
    token = create_access_token(
        user_id=oauth_user_id,
        role=UserRole.user.value,
    )
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# 1. GATE & LINK FLOWS — the documented design, green today
# ---------------------------------------------------------------------------


def test_me_stays_open_for_unlinked_oauth_user(client: TestClient, oauth_headers):
    """SCENARIO:   an unlinked OAuth user opens /api/auth/me.
    EXPECTED:   200 with bank_account_id None — /me is deliberately NOT
                gated, so the user can discover the linking requirement."""
    response = client.get("/api/auth/me", headers=oauth_headers)

    assert response.status_code == 200
    assert response.json()["bank_account_id"] is None


def test_gate_blocks_wallets_for_unlinked_user(client: TestClient, oauth_headers):
    """SCENARIO:   an unlinked OAuth user lists wallets.
    EXPECTED:   403 with a detail message pointing at the link flow."""
    response = client.get("/api/wallets/", headers=oauth_headers)

    assert response.status_code == 403
    assert "link a bank account" in response.json()["detail"]


def test_gate_blocks_rules_for_unlinked_user(client: TestClient, oauth_headers):
    """SCENARIO:   an unlinked OAuth user lists rules.
    EXPECTED:   403 (same gate as wallets)."""
    response = client.get("/api/rules/", headers=oauth_headers)

    assert response.status_code == 403


def test_link_bank_account_opens_the_gate(client: TestClient, oauth_headers, db_session):
    """SCENARIO:   the full Plan-B flow — link a bank account, then retry
                the previously blocked endpoint.
    EXPECTED:   403 before linking; 200 after; the linked id is echoed;
                the 5 provisioned wallets are readable."""
    blocked = client.get("/api/wallets/", headers=oauth_headers)
    assert blocked.status_code == 403

    linked = client.post(
        "/api/auth/link-bank-account",
        headers=oauth_headers,
        json={"bank_account_id": "MA6400010000OA1"},
    )
    assert linked.status_code == 200
    assert linked.json()["bank_account_id"] == "MA6400010000OA1"

    opened = client.get("/api/wallets/", headers=oauth_headers)
    assert opened.status_code == 200
    assert len(opened.json()) == 5  # wallets were provisioned at OAuth signup


def test_double_link_rejected(client: TestClient, oauth_headers):
    """SCENARIO:   linking a second bank account after one is already set.
    EXPECTED:   first link 200, second attempt 400 "already linked"."""
    first = client.post("/api/auth/link-bank-account", headers=oauth_headers,
                        json={"bank_account_id": "MA6400010000OA2"})
    assert first.status_code == 200

    second = client.post("/api/auth/link-bank-account", headers=oauth_headers,
                         json={"bank_account_id": "MA6400010000OA3"})

    assert second.status_code == 400
    assert "already linked" in second.json()["detail"]


def test_link_stealing_someone_elses_bank_id_rejected(
    client, auth_headers, oauth_headers
):
    """SCENARIO:   an OAuth user claims a bank_account_id ALREADY owned by
                another user (auth_headers fixture: MA64000100000042).
    EXPECTED:   400 "already linked to another user" — no account theft."""
    stolen = client.post("/api/auth/link-bank-account", headers=oauth_headers,
                         json={"bank_account_id": "MA64000100000042"})

    assert stolen.status_code == 400
    assert "already linked to another user" in stolen.json()["detail"]


def test_link_requires_valid_body(client: TestClient, oauth_headers):
    """SCENARIO:   linking with a too-short bank id ("MA").
    EXPECTED:   422 (min_length=3 validation)."""
    response = client.post("/api/auth/link-bank-account", headers=oauth_headers,
                           json={"bank_account_id": "MA"})

    assert response.status_code == 422


def test_link_requires_auth(client: TestClient):
    """SCENARIO:   linking with no Authorization header.
    EXPECTED:   401."""
    response = client.post("/api/auth/link-bank-account",
                           json={"bank_account_id": "MA6400010000OA4"})

    assert response.status_code == 401


# ---------------------------------------------------------------------------
# 2. GOOGLE CALLBACK ERRORS — hostile inputs end in clean 401s
# ---------------------------------------------------------------------------


def _login_state(client: TestClient) -> str:
    """Complete GET /login in THIS browser and harvest the state from the
    Google redirect — exactly the dance a real browser does now (PR #51).
    follow_redirects=False: the TestClient must NOT follow the redirect to
    accounts.google.com (a real network call — and it would swallow the 307
    whose Location carries the state)."""
    resp = client.get("/api/auth/oauth/google/login", follow_redirects=False)
    assert resp.status_code in (302, 307)
    return parse_qs(urlparse(resp.headers["location"]).query)["state"][0]


def _fake_google(
    monkeypatch,
    *,
    token_status: int = 200,
    userinfo_status: int = 200,
    userinfo_body: dict | None = None,
):
    """Answer Google's two server-to-server calls (token exchange, userinfo)
    from inside the test — no test ever talks to the real Google."""
    import httpx

    class _FakeResponse:
        def __init__(self, status_code: int, body: dict):
            self.status_code = status_code
            self._body = body

        def json(self) -> dict:
            return self._body

    def fake_post(url, data=None, **kwargs):
        return _FakeResponse(token_status, {"access_token": "google-access-token"})

    def fake_get(url, headers=None, **kwargs):
        return _FakeResponse(userinfo_status, userinfo_body or {})

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setattr(httpx, "get", fake_get)


def test_google_callback_bad_code_is_handled(client: TestClient, monkeypatch):
    """SCENARIO:   the full legit dance (login -> state), then Google
                rejects the forged code (400 at token exchange).
    EXPECTED:   a clean 401 "Google rejected ..." — no crash, no traceback."""
    state = _login_state(client)
    _fake_google(monkeypatch, token_status=400)

    response = client.get(
        "/api/auth/oauth/google/callback", params={"code": "forged", "state": state},
        follow_redirects=False,
    )

    assert response.status_code == 401
    assert "Google rejected" in response.json()["detail"]


def test_google_callback_garbage_userinfo_response(client: TestClient, monkeypatch):
    """SCENARIO:   token exchange SUCCEEDS but the userinfo call comes back
                hostile (403).
    EXPECTED:   a clean 401 with a safe, generic error — not a KeyError/500
                and not a leak of what went wrong."""
    state = _login_state(client)
    _fake_google(monkeypatch, userinfo_status=403)

    response = client.get(
        "/api/auth/oauth/google/callback", params={"code": "real-looking", "state": state},
        follow_redirects=False,
    )

    assert response.status_code == 401
    # The app deliberately answers with a generic message; pin it.
    assert response.json()["detail"] == "Could not verify Google identity"


# ---------------------------------------------------------------------------
# 3. ACCEPTANCE TESTS — finding #10, one test per leg (owner: HOMIE)
# ---------------------------------------------------------------------------


def test_transactions_gated_for_unlinked_user(client: TestClient, oauth_headers):
    """SCENARIO:   an unlinked OAuth user POSTs a payment.
    EXPECTED:   403 — the POST leg of finding #10, VERIFIED FIXED
                (HOMIE added require_linked_account to create_transaction)."""
    payment = client.post("/api/transactions/", headers=oauth_headers,
                          json={"reference": "UNLINKED-1", "amount": 5000})

    assert payment.status_code == 403, \
        "finding #10 NOT fixed: unlinked OAuth user can still create payments"


# @pytest.mark.xfail(
#     strict=True,
#     reason=(
#         "finding #10 REOPENED — fix was partial (owner: HOMIE): "
#         "require_linked_account was added to create_transaction "
#         "(app/api/transactions.py:23) but NOT to list_transactions "
#         "(app/api/transactions.py:38, still plain get_current_user), so an "
#         "unlinked OAuth user can still READ the transaction list (200 vs 403). "
#         "Unmasked by the authorization-service seam: pre-seam this leg failed "
#         "with 503-outage and was indistinguishable from the fixed legs. "
#         "Flips to XPASS when require_linked_account lands on list_transactions."
#     ),
# )
def test_transaction_list_gated_for_unlinked_user(client: TestClient, oauth_headers):
    """SCENARIO:   an unlinked OAuth user GETs the transaction list.
    EXPECTED:   403 — the GET leg of finding #10. wallets.py and rules.py
                gate their list endpoints; transactions.py must match.
                Fails today (200) because list_transactions is ungated;
                xfail-strict keeps the suite green while the bug is open."""
    listing = client.get("/api/transactions/", headers=oauth_headers)

    assert listing.status_code == 403, \
        "finding #10 REOPENED: unlinked OAuth user can still read transactions"


# ---------------------------------------------------------------------------
# 4. PROVISIONING PARITY — OAuth signup promises the same 5 + 4
# ---------------------------------------------------------------------------


def test_oauth_user_provisioning_matches_promise(db_session, oauth_user_id):
    """SCENARIO:   a user created via the Google OAuth path.
    EXPECTED:   the DB holds the same 5 wallets + 4 rules a normal signup
                gets (oauth.py calls the same provisioning functions)."""
    from app.models.models import Rule, Wallet

    wallets = db_session.query(Wallet).filter(Wallet.user_id == oauth_user_id).all()
    rules = db_session.query(Rule).filter(Rule.user_id == oauth_user_id).all()
    assert len(wallets) == 5
    assert len(rules) == 4


# ---------------------------------------------------------------------------
# 5. OAUTH SECURITY — findings #17/#18/#19 CLOSED, #20 open
#
# #17, #18 and #19 were filed from the QA review of PR #51 and FIXED by
# Mehdi's OAuth hardening: their acceptance tests XPASSed (strict) in the
# worktree against his branch, so the markers were removed here — they are
# now plain contract pins. #20 (required settings can't boot from the
# committed .env.example) is still open and stays xfail-strict: it
# converts the same way the moment its fix lands.
# The full analysis is the OAuth security review document, kept outside
# the repo (QA's shared documents) — ask QA for it.
#
# STATUS: findings #17/#18/#19 (cycle-2 OAuth) are FIXED on main — the
# /login flow now issues an httpOnly autowallet_google_oauth_nonce cookie
# and the Redis key binds hash(nonce:state); email_verified is checked
# before the link branch; userinfo payloads are read with .get() and a
# clean 401. The xfail-strict tripwires XPASSed (suite red as designed),
# so the markers were removed in the PR #52 refresh — the tests below are
# plain regression pins now. A regression is a green-to-red change, not
# an xfail.
# ---------------------------------------------------------------------------


def test_a_state_issued_to_another_browser_is_rejected(client: TestClient, monkeypatch):
    """SCENARIO:   the ATTACKER's browser does /login (state S lands in Redis,
                unused), then the VICTIM's browser — which never requested
                anything — opens /callback?code=<attacker's code>&state=S.
    EXPECTED:   400 — the cookie-bound state means a browser that never
                started the flow cannot complete one (finding #17, FIXED)."""
    from app.main import app as fastapi_app

    state = _login_state(client)  # the attacker's browser starts the flow
    _fake_google(
        monkeypatch,
        userinfo_body={
            "sub": "google-attacker-1",
            "email": "attacker@autowallet.dev",
            "email_verified": True,
            "name": "Attacker",
        },
    )

    victim_browser = TestClient(fastapi_app)  # a DIFFERENT browser: no cookies, no /login
    response = victim_browser.get(
        "/api/auth/oauth/google/callback",
        params={"code": "attacker-code", "state": state},
        follow_redirects=False,
    )

    assert response.status_code == 400, \
        "a state from ANOTHER browser must not complete a login"


def test_unverified_google_email_never_links_onto_an_existing_account(
    client: TestClient, monkeypatch, db_session
):
    """SCENARIO:   Google answers with an identity that CLAIMS the victim's
                email but carries email_verified: false.
    EXPECTED:   401, and the victim's password account stays un-linked
                (finding #18, FIXED — emailed-linked accounts are refused)."""
    from tests.helpers import make_user

    victim_id = make_user(db_session, "oauth-victim@autowallet.dev",
                          bank_account_id="MA6400010000VICT")

    state = _login_state(client)
    _fake_google(
        monkeypatch,
        userinfo_body={
            "sub": "google-attacker-2",
            "email": "oauth-victim@autowallet.dev",   # claims the VICTIM's email
            "email_verified": False,
            "name": "Attacker",
        },
    )
    response = client.get(
        "/api/auth/oauth/google/callback", params={"code": "real-looking", "state": state},
        follow_redirects=False,
    )

    assert response.status_code == 401, \
        "an unverified email must never complete an OAuth login"

    db_session.expire_all()
    victim = db_session.query(User).filter(User.id == victim_id).first()
    assert victim.oauth_provider is None, \
        "the Google identity must NOT be linked onto the victim's account"
    assert victim.oauth_id is None


def test_userinfo_without_sub_answers_401_not_500(client: TestClient, monkeypatch):
    """SCENARIO:   token exchange succeeds, but the userinfo answer is 200
                with a malformed body (no 'sub').
    EXPECTED:   the clean 401 — never an unhandled KeyError/500
                (finding #19, FIXED)."""
    state = _login_state(client)
    _fake_google(monkeypatch, userinfo_body={"email": "who@autowallet.dev"})

    response = client.get(
        "/api/auth/oauth/google/callback", params={"code": "real-looking", "state": state},
        follow_redirects=False,
    )

    assert response.status_code == 401, \
        "malformed userinfo must answer 401, not crash"


@pytest.mark.xfail(
    strict=True,
    reason="finding #20 (owner: MEHDI): PR #51 added four REQUIRED settings "
           "(frontend_google_callback_url, postgres_user, postgres_password, "
           "postgres_db — app/core/config.py) with no defaults, but did not "
           "add postgres_* to backend/.env.example — so `cp .env.example "
           ".env` (what CI and new clones do) can't boot the app: 3 CI jobs "
           "red at import. Fix: defaults (the AI module's pattern) or "
           "complete the example file.",
)
def test_the_app_boots_from_the_committed_env_example(monkeypatch):
    """SCENARIO:   CI and a fresh clone configure the backend with exactly
                `cp .env.example .env` — nothing else.
    EXPECTED:   Settings constructs from backend/.env.example alone; the
                committed example must always be a complete boot recipe."""
    from pathlib import Path

    for var in (
        "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB",
        "FRONTEND_GOOGLE_CALLBACK_URL",
    ):
        monkeypatch.delenv(var, raising=False)

    from app.core.config import Settings

    env_file = Path(__file__).resolve().parents[1] / ".env.example"
    Settings(_env_file=env_file)  # DESIRED: constructs — today raises ValidationError
