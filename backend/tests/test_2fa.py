"""Backend acceptance tests for the 2FA findings raised against PR #64.

House conventions apply (see tests/TESTS.md):
- Every test below is a finding carved in stone: it asserts the DESIRED
  (post-fix) behavior and is xfail-strict while the finding is open.
- Reason text names the finding number, the owner, and the exact fix
  location — whoever picks it up starts warm.
- These tests call REAL app code against fake infrastructure (in-memory
  sqlite, fakeredis, no SMTP/TOTP app needed — codes are generated with
  pyotp in-process, the same library the app verifies with).
"""

import pyotp

import pytest
from fastapi.testclient import TestClient


def _enable_2fa(client: TestClient, auth_headers: dict) -> str:
    """Turn 2FA on for the fixture user through the REAL endpoints and
    return the secret, so tests can mint valid TOTP codes."""
    setup = client.post("/api/auth/2fa/setup", headers=auth_headers)
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]
    verify = client.post(
        "/api/auth/2fa/verify",
        headers=auth_headers,
        json={"code": pyotp.TOTP(secret).now()},
    )
    assert verify.status_code == 200, verify.text
    return secret


def _login_body(email: str, password: str, totp_code: str | None = None) -> dict:
    body = {"email": email, "password": password}
    if totp_code is not None:
        body["totp_code"] = totp_code
    return body


# ---------------------------------------------------------------------------
# Finding #27 — no rate limiting on 2FA attempts at /login
# ---------------------------------------------------------------------------

@pytest.mark.xfail(
    strict=True,
    reason="finding #27 (owner: MEHDI): /login verifies the TOTP/recovery "
           "second factor with NO rate limiting and NO attempt lockout "
           "(app/api/auth.py login — the verify_totp_code call sits before "
           "token issuance and nothing counts failures). A client who "
           "captured email+password can brute-force a 6-digit TOTP "
           "(10^6 keyspace, valid_window=1) at request speed; recovery "
           "codes share the same hole. Fix: count failed 2FA attempts per "
           "user (Redis EXPIRE window) BEFORE the verify call and refuse "
           "with 429 once a small threshold is crossed.",
)
def test_login_rejects_2fa_after_repeated_failed_attempts(client, test_user, auth_headers):
    """SCENARIO:   the attacker HAS the password (phish/leak) but not the
                second factor; he hammers /login with wrong TOTP codes.
    EXPECTED:   before the attempt count grows unreasonable, the backend
                must answer 429 (or lock the factor) — NOT keep grading
                answers at request speed."""
    _enable_2fa(client, auth_headers)

    # wrong-code storm: 10 rapid attempts, all counting as real requests
    statuses = [
        client.post(
            "/api/auth/login",
            json=_login_body(test_user.email, "SuperSecret1337!", "000000"),
        ).status_code
        for _ in range(10)
    ]

    assert 429 in statuses, (
        "finding #27 NOT fixed: 10 consecutive failed 2FA attempts were all "
        f"graded normally ({set(statuses)}) — no rate limit engages"
    )


# ---------------------------------------------------------------------------
# Finding #28 — no way to disable 2FA once enabled
# ---------------------------------------------------------------------------

@pytest.mark.xfail(
    strict=True,
    reason="finding #28 (owner: MEHDI): auth.py has POST /2fa/setup, "
           "/2fa/verify and /2fa/recovery-codes/regenerate — but NO "
           "disable endpoint, so a user who loses both the TOTP device and "
           "the recovery codes is locked out of his own account forever "
           "(no support path turns two_factor_enabled off). Fix: add POST "
           "/api/auth/2fa/disable, gated by password + one valid second "
           "factor (TOTP or recovery code), that clears two_factor_secret "
           "and flushes outstanding recovery codes in one transaction.",
)
def test_2fa_can_be_disabled_by_the_user(client, test_user, auth_headers):
    """SCENARIO:   the user still holds one second factor (device) but
                wants 2FA gone (e.g. rotating devices, ditching the app).
    EXPECTED:   a single authenticated call turns 2FA off and the NEXT
                login needs no second factor again."""
    _enable_2fa(client, auth_headers)

    disable = client.post("/api/auth/2fa/disable", headers=auth_headers)
    assert disable.status_code == 200, (
        f"finding #28 NOT fixed: /api/auth/2fa/disable answers "
        f"{disable.status_code} ({disable.json().get('detail')}) — endpoint missing"
    )

    fresh = client.post(
        "/api/auth/login",
        json=_login_body(test_user.email, "SuperSecret1337!"),
    )
    assert fresh.status_code == 200, fresh.text
    assert "access_token" in fresh.json()
