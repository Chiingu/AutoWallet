"""The GDPR module (app/gdpr) — export, and the two-step account deletion.

What this suite pins:
  EXPORT     JSON and CSV (zip of 4 tables) downloads of EVERYTHING the
             app stores about the caller — minus secrets (no password
             hash, no 2FA secret). Scoped to the owner: no other user's
             data ever rides along. Works for users without a linked
             bank account (GDPR rights don't depend on product state).
  DELETION   two steps: a 6-digit code is EMAILED (hash stored in Redis,
             never the code), then the code confirms deletion of the
             account and ALL its data (cascade). Wrong codes are counted
             (5 max, then the code is cancelled); codes expire (15 min);
             an immediate second request is refused with 429 + Retry-After;
             an email failure answers 503 and clears the code; Redis down
             answers 503 — deletion is never confirmed blind.
"""
import hashlib
import io
import re
import zipfile

import redis

from app.core.security import create_access_token
from app.models.models import Transaction, TransactionStatus, Rule, User, Wallet
from tests.helpers import make_user

EXPORT = "/api/gdpr/export"
REQUEST = "/api/gdpr/delete-request"
CONFIRM = "/api/gdpr/delete-confirm"


def _auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user_id=user_id, role='user')}"}


def _delete_key(user_id: str) -> str:
    return f"gdpr:delete:{user_id}"


def _captured_code(outbox: list[dict]) -> str:
    """Pull the 6-digit code out of the deletion email."""
    for email in outbox:
        match = re.search(r"confirmation code is: (\d{6})", email["body"])
        if match:
            return match.group(1)
    raise AssertionError("no deletion code found in the outbox")


# ---------------------------------------------------------------------------
# Export — JSON
# ---------------------------------------------------------------------------

def test_export_json_contains_all_data_but_no_secrets(client, auth_headers, test_user, gdpr_email):
    # SCENARIO: a user downloads their data as JSON.
    # EXPECTED: 200 JSON with profile + 5 envelopes + 4 rules + payments;
    #           the password hash and 2FA secret are NEVER in the export.
    resp = client.get(EXPORT, headers=auth_headers)
    assert resp.status_code == 200
    assert "application/json" in resp.headers["content-type"]

    data = resp.json()
    assert data["profile"]["email"] == test_user.email
    assert data["profile"]["bank_account_id"] == test_user.bank_account_id
    assert len(data["envelopes"]) == 5
    assert len(data["rules"]) == 4
    assert data["payments"] == []

    profile_text = resp.text
    assert "hashed_password" not in profile_text
    assert "two_factor_secret" not in profile_text


def test_export_is_scoped_to_the_requester(client, auth_headers, db_session):
    # SCENARIO: user B has a payment; user A exports their data.
    # EXPECTED: B's reference appears nowhere in A's export — GDPR export
    #           can never become a cross-user data leak.
    b_id = make_user(db_session, "gdpr-b@autowallet.dev", bank_account_id="MA64000100000GDPRB")
    db_session.add(Transaction(user_id=b_id, reference="B-ONLY-REF", amount=100,
                               status=TransactionStatus.processed))
    db_session.commit()

    resp = client.get(EXPORT, headers=auth_headers)
    assert resp.status_code == 200
    assert "B-ONLY-REF" not in resp.text
    assert "gdpr-b@autowallet.dev" not in resp.text


def test_export_works_without_a_linked_bank_account(client, db_session, gdpr_email):
    # SCENARIO: an OAuth user with no bank account linked exports anyway.
    # EXPECTED: 200 — GDPR rights never depend on product state.
    user_id = make_user(db_session, "gdpr-unlinked@autowallet.dev", bank_account_id=None)
    resp = client.get(EXPORT, headers=_auth(user_id))
    assert resp.status_code == 200
    assert resp.json()["profile"]["bank_account_id"] is None


def test_export_requires_login(client):
    # SCENARIO: anonymous export request.
    # EXPECTED: 401 — a person's data is never downloadable blind.
    resp = client.get(EXPORT)
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Export — CSV (zip of 4 tables)
# ---------------------------------------------------------------------------

def test_export_csv_is_a_zip_of_four_tables(client, auth_headers, gdpr_email):
    # SCENARIO: a user downloads the CSV format.
    # EXPECTED: a zip with profile/envelopes/rules/payments CSVs, envelope
    #           rows carrying the 5 wallets.
    resp = client.get(EXPORT, params={"format": "csv"}, headers=auth_headers)
    assert resp.status_code == 200
    assert "application/zip" in resp.headers["content-type"]

    archive = zipfile.ZipFile(io.BytesIO(resp.content))
    assert set(archive.namelist()) == {"profile.csv", "envelopes.csv", "rules.csv", "payments.csv"}

    envelopes = archive.read("envelopes.csv").decode()
    lines = [line for line in envelopes.splitlines() if line.strip()]
    assert lines[0] == "type,balance"
    assert len(lines) == 1 + 5  # header + the 5 wallets


# ---------------------------------------------------------------------------
# Deletion, step 1 — the emailed code
# ---------------------------------------------------------------------------

def test_delete_request_emails_a_six_digit_code_and_stores_only_its_hash(
    client, auth_headers, test_user, gdpr_email, fake_redis
):
    # SCENARIO: a user asks to delete their account.
    # EXPECTED: 202 + the email carries a 6-digit code; Redis stores ONLY
    #           sha256(user:code) with 15 minutes TTL — the code itself is
    #           never at rest in Redis.
    resp = client.post(REQUEST, headers=auth_headers)
    assert resp.status_code == 202

    code = _captured_code(gdpr_email)
    key = _delete_key(test_user.id)
    stored = fake_redis.hgetall(key)
    expected_hash = hashlib.sha256(f"{test_user.id}:{code}".encode()).hexdigest()
    assert stored["hash"] == expected_hash
    assert stored["tries"] == "0"
    assert 0 < fake_redis.ttl(key) <= 15 * 60


def test_an_immediate_second_code_request_is_refused(client, auth_headers, gdpr_email):
    # SCENARIO: the user clicks "send the code again" right away.
    # EXPECTED: 429 with Retry-After ~60 — email bombing is rate-limited.
    assert client.post(REQUEST, headers=auth_headers).status_code == 202
    resp = client.post(REQUEST, headers=auth_headers)
    assert resp.status_code == 429
    assert 1 <= int(resp.headers["Retry-After"]) <= 60


def test_email_failure_answers_503_and_clears_the_code(
    client, auth_headers, test_user, monkeypatch, fake_redis
):
    # SCENARIO: the SMTP server is down when the code must be sent.
    # EXPECTED: 503 email_unavailable and the Redis key DELETED — a code
    #           the user never received must not sit waiting to be brute-
    #           forced for 15 minutes.
    from app.gdpr.email import EmailError

    def boom(to, subject, body):
        raise EmailError("smtp down")

    monkeypatch.setattr("app.gdpr.router.send_email", boom)

    resp = client.post(REQUEST, headers=auth_headers)
    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "email_unavailable"
    assert fake_redis.hgetall(_delete_key(test_user.id)) == {}


# ---------------------------------------------------------------------------
# Deletion, step 2 — confirming the code
# ---------------------------------------------------------------------------

def test_confirm_without_a_code_is_rejected(client, auth_headers):
    # SCENARIO: confirming without ever requesting a code.
    # EXPECTED: 400 no_code.
    resp = client.post(CONFIRM, headers=auth_headers, json={"code": "123456"})
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "no_code"


def test_a_wrong_code_counts_the_tries_and_keeps_the_account(
    client, auth_headers, test_user, gdpr_email, db_session
):
    # SCENARIO: the user typos the code once.
    # EXPECTED: 400 wrong_code announcing the tries left (5 max → 4), and
    #           the account is untouched.
    client.post(REQUEST, headers=auth_headers)
    code = _captured_code(gdpr_email)
    wrong = "000000" if code != "000000" else "123456"

    resp = client.post(CONFIRM, headers=auth_headers, json={"code": wrong})
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "wrong_code"
    assert "4 tries left" in resp.json()["detail"]["message"]

    assert db_session.query(User).filter(User.id == test_user.id).first() is not None


def test_five_wrong_codes_cancel_the_code(client, auth_headers, gdpr_email):
    # SCENARIO: five wrong codes in a row — a brute-force attempt.
    # EXPECTED: the 5th is refused with 429 too_many_tries, the code is
    #           cancelled, and the REAL code no longer works afterwards.
    client.post(REQUEST, headers=auth_headers)
    code = _captured_code(gdpr_email)
    wrong = "000000" if code != "000000" else "123456"

    for i in range(4):
        assert client.post(CONFIRM, headers=auth_headers, json={"code": wrong}).status_code == 400
    assert client.post(CONFIRM, headers=auth_headers, json={"code": wrong}).status_code == 429

    resp = client.post(CONFIRM, headers=auth_headers, json={"code": code})
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "no_code"


def test_the_correct_code_deletes_the_account_and_all_its_data(
    client, auth_headers, test_user, gdpr_email, db_session
):
    # SCENARIO: the user confirms deletion with the emailed code.
    # EXPECTED: 200; the user AND all wallets/rules/payments are gone
    #           (the cascade promise); a confirmation email goes out.
    client.post(REQUEST, headers=auth_headers)
    code = _captured_code(gdpr_email)

    resp = client.post(CONFIRM, headers=auth_headers, json={"code": code})
    assert resp.status_code == 200

    uid = test_user.id
    assert db_session.query(User).filter(User.id == uid).first() is None
    assert db_session.query(Wallet).filter(Wallet.user_id == uid).count() == 0
    assert db_session.query(Rule).filter(Rule.user_id == uid).count() == 0
    assert db_session.query(Transaction).filter(Transaction.user_id == uid).count() == 0

    assert any("was deleted" in email["subject"] for email in gdpr_email)


def test_redis_down_answers_503_for_deletion(client, auth_headers, monkeypatch):
    # SCENARIO: Redis is unreachable during a deletion step.
    # EXPECTED: 503 unavailable — the code flow refuses to operate blind;
    #           deletion is never confirmed against an unknownable code.
    class RedisDown:
        def __getattr__(self, name):
            raise redis.RedisError("redis is down")

    monkeypatch.setattr("app.gdpr.router.redis_client", RedisDown())
    resp = client.post(REQUEST, headers=auth_headers)
    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "unavailable"
