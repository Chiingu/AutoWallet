"""Concurrency & locking — what happens when two things want the same money.

The Redis lock exists because payments must be serialized per user: two
simultaneous payments must both succeed WITHOUT losing or duplicating money,
and a worker holding the lock must not stall the whole system behind it.

Two pressure points, one file:

    1. Two REAL threads racing through the HTTP endpoint
       (the manual entry door — test_transactions.py §2/§3 cover the
       single-threaded guarantees; this is the race itself)
    2. A lock held FOREVER while the poller cycles past that user
       (the background entry door — acceptance test for finding #6)

Both use REAL code paths; only Redis and the simulator are faked
(fakeredis + respx, via conftest).
"""
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from app.models.models import Transaction
from app.workers.poller import poll_bank_simulator
from tests.helpers import make_user, mock_account, SIMULATOR, wallet_balances


# ---------------------------------------------------------------------------
# 1. THE HTTP ENDPOINT UNDER A REAL RACE
# ---------------------------------------------------------------------------


def test_concurrent_payments_same_user_both_processed(
    client: TestClient, auth_headers, test_user, db_session
):
    """SCENARIO:   two payments for the same user fired at the SAME instant
                from two threads (the reason the Redis lock exists).
    EXPECTED:   both 201, no 500s, and no money lost or duplicated: the
                total across all wallets equals the total paid in (5000)."""

    def pay(reference, amount):
        return client.post("/api/transactions/", headers=auth_headers,
                           json={"reference": reference, "amount": amount})

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(
            lambda args: pay(*args),
            [("RACE-1", 3000), ("RACE-2", 2000)],
        ))

    statuses = [r.status_code for r in results]
    assert statuses == [201, 201], f"one or both concurrent payments failed: {statuses}"

    total_in_wallets = sum(wallet_balances(db_session, test_user.id).values())
    assert total_in_wallets == 5000.0, "money lost or duplicated during concurrent processing"


# ---------------------------------------------------------------------------
# 2. THE POLLER UNDER A HELD LOCK — acceptance test, finding #6
# ---------------------------------------------------------------------------


def test_lock_held_by_another_worker_cycle_continues(db_session, poller_uses_test_db, fake_redis):
    """ACCEPTANCE TEST for QA finding #6 (poller half) — blocks merge until fixed.

    The manual endpoint half of #6 is fixed (409 — verified), but the
    POLLER half is not: when another worker holds the user's Redis lock
    beyond blocking_timeout=5s, process_payment raises RuntimeError and
    the per-transaction except in poller.py... catches it — BUT the
    cycle must also demonstrably continue to the NEXT user. This test
    pins the full requirement, not just the catch.

    Setup: user LOCK has their lock held forever (never released);
    user AFTER-LOCK comes after them and must still get paid."""
    locked_id = make_user(db_session, "poller-lock@autowallet.dev", "ACC-LOCK")
    make_user(db_session, "poller-afterlock@autowallet.dev", "ACC-AFTERLOCK")

    held = fake_redis.lock(f"lock:user:{locked_id}", timeout=10)
    assert held.acquire(blocking=True)

    import respx

    with respx.mock:
        mock_account(SIMULATOR, "ACC-LOCK", [{"reference": "STUCK", "amount": 100}])
        mock_account(SIMULATOR, "ACC-AFTERLOCK", [{"reference": "FREED", "amount": 100}])
        poll_bank_simulator()  # must NOT raise, and must not stop

    freed = db_session.query(Transaction).filter(
        Transaction.reference == "FREED").first()
    assert freed is not None, \
        "finding #6 NOT fixed (poller half): cycle stopped at the locked user; the next user was never paid"
