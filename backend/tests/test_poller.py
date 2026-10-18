"""Tests for the bank-simulator polling bridge (app/workers/poller.py).

The poller runs every 60s in production: for each user it fetches the
user's simulator account and calls process_payment() for every entry.
These tests call poll_bank_simulator() DIRECTLY instead of waiting for
a real 60-second tick — same logic, same HTTP call (mocked with respx),
same DB writes, zero sleeping. The timing itself is APScheduler's job;
what happens on each tick is ours.

(The held-lock race lives in test_concurrency.py.)

Sections:
    1. Happy path           (simulator payments land in wallets)
    2. Resilience           (404s, outages, malformed data —
                             the cycle must always continue)
    3. Idempotency          (re-reads must never double-credit)
    4. Skip rules           (users the poller must not touch)
"""
import httpx
import respx

from app.models.models import Transaction
from app.workers.poller import poll_bank_simulator
from tests.helpers import make_user, mock_account, SIMULATOR, wallet_balances


# ---------------------------------------------------------------------------
# 1. HAPPY PATH — simulator payments land in wallets
# ---------------------------------------------------------------------------


def test_poller_delivers_simulator_payment_to_wallets(db_session, poller_uses_test_db, fake_redis):
    """SCENARIO:   the bank simulator shows one 8,500 deposit for the user.
    EXPECTED:   after one poll cycle the payment is a processed transaction
                and the wallets hold the exact envelope split (the board's
                canonical example, end to end)."""
    user_id = make_user(db_session, "poller1@autowallet.dev", "ACC-POLL-1")
    with respx.mock:
        mock_account(SIMULATOR, "ACC-POLL-1",
                     [{"reference": "SIM-1", "amount": 8500}])
        poll_bank_simulator()

    tx = db_session.query(Transaction).filter(Transaction.reference == "SIM-1").first()
    assert tx is not None and tx.status.value == "processed"

    balances = wallet_balances(db_session, user_id)
    assert balances["rent"] == 3500.0
    assert balances["tax"] == 750.0
    assert balances["savings"] == 637.5
    assert balances["free"] == 3612.5
    assert sum(balances.values()) == 8500.0


def test_two_users_each_get_their_own_payments(db_session, poller_uses_test_db, fake_redis):
    """SCENARIO:   two users, each with their own simulator account and one
                payment apiece.
    EXPECTED:   after one cycle each user's transaction history contains
                exactly their own payment — no cross-user leakage."""
    a_id = make_user(db_session, "poller-a@autowallet.dev", "ACC-A")
    b_id = make_user(db_session, "poller-b@autowallet.dev", "ACC-B")
    with respx.mock:
        mock_account(SIMULATOR, "ACC-A", [{"reference": "FOR-A", "amount": 1000}])
        mock_account(SIMULATOR, "ACC-B", [{"reference": "FOR-B", "amount": 1000}])
        poll_bank_simulator()

    a_refs = {t.reference for t in db_session.query(Transaction)
              .filter(Transaction.user_id == a_id).all()}
    b_refs = {t.reference for t in db_session.query(Transaction)
              .filter(Transaction.user_id == b_id).all()}
    assert a_refs == {"FOR-A"}
    assert b_refs == {"FOR-B"}


# ---------------------------------------------------------------------------
# 2. RESILIENCE — whatever breaks mid-cycle, the cycle must continue
# ---------------------------------------------------------------------------


def test_unknown_simulator_account_is_skipped_and_cycle_continues(
    db_session, poller_uses_test_db, fake_redis
):
    """SCENARIO:   a user whose account does not exist in the simulator yet
                (404), followed by a healthy user.
    EXPECTED:   the 404 is skipped and the NEXT user still gets paid —
                one bad account must not starve everyone after it."""
    make_user(db_session, "poller-ghost@autowallet.dev", "ACC-NOPE")
    make_user(db_session, "poller-ok@autowallet.dev", "ACC-OK")
    with respx.mock:
        mock_account(SIMULATOR, "ACC-NOPE", [], status=404)
        mock_account(SIMULATOR, "ACC-OK", [{"reference": "AFTER-404", "amount": 1000}])
        poll_bank_simulator()

    tx = db_session.query(Transaction).filter(Transaction.reference == "AFTER-404").first()
    assert tx is not None, "poller stopped after the 404 and never reached the next user"


def test_simulator_down_does_not_raise(db_session, poller_uses_test_db, fake_redis):
    """SCENARIO:   the bank simulator is unreachable (connection refused).
    EXPECTED:   the poll cycle survives — no exception escapes the tick."""
    make_user(db_session, "poller-down@autowallet.dev", "ACC-DOWN")
    with respx.mock:
        respx.get(f"{SIMULATOR}/simulator/accounts/ACC-DOWN").mock(
            side_effect=httpx.ConnectError("simulator is down")
        )
        poll_bank_simulator()  # must not raise


def test_malformed_simulator_response_crashes_cycle(db_session, poller_uses_test_db, fake_redis):
    """ACCEPTANCE TESTS for QA finding #5 — blocks merge until fixed.

    Two malformed shapes, both verified live (2026-09-13) to kill the
    poll cycle on main:
      1. 200 response missing the "transactions" key → KeyError
      2. 200 response with an invalid JSON body → JSONDecodeError
    Neither is caught by the outer `except httpx.RequestError`, so every
    user ordered after the bad account is starved of payments until a
    human intervenes — while /health stays green.

    Expected once fixed: the outer except also catches ValueError (or
    response.json()["transactions"] becomes .get("transactions", []))
    — the cycle survives AND the victim user after the bad account
    still gets processed."""
    make_user(db_session, "poller-bad@autowallet.dev", "ACC-BAD")
    make_user(db_session, "poller-victim@autowallet.dev", "ACC-VICTIM")

    # shape 1: missing "transactions" key
    with respx.mock:
        respx.get(f"{SIMULATOR}/simulator/accounts/ACC-BAD").respond(json={"oops": "no key"})
        mock_account(SIMULATOR, "ACC-VICTIM", [{"reference": "AFTER-BAD-1", "amount": 100}])
        poll_bank_simulator()  # must NOT raise

    processed = db_session.query(Transaction).filter(
        Transaction.reference == "AFTER-BAD-1").first()
    assert processed is not None, \
        "finding #5 NOT fixed (missing-key case): cycle died, users after the malformed response were never paid"

    # shape 2: invalid JSON body
    with respx.mock:
        respx.get(f"{SIMULATOR}/simulator/accounts/ACC-BAD").respond(
            content="<<<not json>>>", status_code=200)
        mock_account(SIMULATOR, "ACC-VICTIM", [{"reference": "AFTER-BAD-2", "amount": 100}])
        poll_bank_simulator()  # must NOT raise

    processed = db_session.query(Transaction).filter(
        Transaction.reference == "AFTER-BAD-2").first()
    assert processed is not None, \
        "finding #5 NOT fixed (invalid-JSON case): cycle died, users after the bad response were never paid"


# ---------------------------------------------------------------------------
# 3. IDEMPOTENCY — re-reads must never double-credit
# ---------------------------------------------------------------------------


def test_transaction_already_processed_is_not_processed_twice(
    db_session, poller_uses_test_db, fake_redis
):
    """SCENARIO:   two full poll cycles over the SAME simulator history —
                the poller re-reads everything every cycle by design, so
                the duplicate reference check in process_payment is the
                only thing preventing double-crediting.
    EXPECTED:   the payment is recorded exactly once and the wallets are
                credited exactly once (1000, not 2000)."""
    user_id = make_user(db_session, "poller-dup@autowallet.dev", "ACC-DUP")
    with respx.mock:
        mock_account(SIMULATOR, "ACC-DUP", [{"reference": "TWICE", "amount": 1000}])
        poll_bank_simulator()  # cycle 1
        poll_bank_simulator()  # cycle 2 — same history still there

    count = db_session.query(Transaction).filter(Transaction.reference == "TWICE").count()
    assert count == 1, "double-crediting across cycles"

    balances = wallet_balances(db_session, user_id)
    assert sum(balances.values()) == 1000.0  # credited once, not twice


def test_reference_collision_manual_and_polled(
    db_session, poller_uses_test_db, fake_redis
):
    """SCENARIO:   HARD CASE — the same reference arrived twice through two
                DIFFERENT doors: once manually (POST /transactions) and once
                via the simulator history the poller reads.
    EXPECTED:   the polled path must not re-credit the manual payment —
                the reference uniqueness check spans both entry points."""
    from app.services.payment_processor import process_payment
    from app.models.models import User as UserModel
    user_id = make_user(db_session, "poller-coll@autowallet.dev", "ACC-COLL")
    user = db_session.query(UserModel).filter(UserModel.id == user_id).first()

    process_payment(user, "SHARED-REF", 1000, db_session)  # manual first

    with respx.mock:
        mock_account(SIMULATOR, "ACC-COLL", [{"reference": "SHARED-REF", "amount": 1000}])
        poll_bank_simulator()  # poller sees the same reference

    balances = wallet_balances(db_session, user.id)
    assert sum(balances.values()) == 1000.0, "polled path re-credited a manual payment"


# ---------------------------------------------------------------------------
# 4. SKIP RULES — users the poller must not touch
# ---------------------------------------------------------------------------


def test_user_without_bank_account_is_never_polled(db_session, poller_uses_test_db, fake_redis):
    """SCENARIO:   an OAuth-style user with bank_account_id=None.
    EXPECTED:   the poller skips them before making any HTTP request at
                all (no simulator call configured or made), and their
                (empty) history stays untouched."""
    make_user(db_session, "poller-noaccount@autowallet.dev", None)
    with respx.mock:
        assert not respx.get(f"{SIMULATOR}/simulator/accounts/").called
        poll_bank_simulator()
    # no HTTP call was ever configured; poll ran with zero requests —
    # respx.mock raises on unmatched calls, so reaching here unmocked-free
    # proves the None user was skipped before any request
    assert db_session.query(Transaction).count() == 0
