"""Tests for the transaction endpoints: creating payments, wallet updates,
duplicate protection, access control, and rule conditions live through the
API.

(The concurrency races live in test_concurrency.py.)

Sections:
    1. Payment processing   (the money actually lands where the rules say)
    2. Data integrity       (records, duplicates, validation, auth)
    3. Access control       (IDOR: lists scoped to the owner)
    4. Rule conditions      (savings cap enforced through the API)
"""
from fastapi.testclient import TestClient

from app.core.security import create_access_token
from app.models.models import Transaction, User, Wallet
from tests.helpers import wallet_balances


# ---------------------------------------------------------------------------
# 1. PAYMENT PROCESSING — the board's envelope example, verified in the DB
# ---------------------------------------------------------------------------


def test_transaction_updates_wallets(client: TestClient, auth_headers, test_user, db_session):
    """SCENARIO:   the board's canonical 8,500 MAD deposit.
    EXPECTED:   201 "processed", and the DATABASE (not just the response)
                shows the exact envelope split:
                rent 3500 + tax 750 + savings 637.50 + free 3612.50."""
    response = client.post(
        "/api/transactions/",
        headers=auth_headers,
        json={"reference": "DEP-001", "amount": 8500},
    )

    assert response.status_code == 201
    assert response.json()["status"] == "processed"

    balances = wallet_balances(db_session, test_user.id)
    assert balances["rent"] == 3500.0
    assert balances["tax"] == 750.0
    assert balances["savings"] == 637.5
    assert balances["free"] == 3612.5
    assert balances["main"] == 0.0


# ---------------------------------------------------------------------------
# 2. DATA INTEGRITY — records, duplicates, validation, auth
# ---------------------------------------------------------------------------


def test_transaction_recorded_with_status_and_timestamps(client, auth_headers, db_session):
    """SCENARIO:   a valid payment.
    EXPECTED:   a Transaction row exists with status "processed", a
                processed_at timestamp, and the paid amount."""
    client.post("/api/transactions/", headers=auth_headers,
                json={"reference": "DEP-002", "amount": 1000})

    tx = db_session.query(Transaction).filter(Transaction.reference == "DEP-002").first()
    assert tx is not None
    assert tx.status.value == "processed"
    assert tx.processed_at is not None
    assert tx.amount == 1000


def test_duplicate_reference_rejected_and_balances_unchanged(
    client, auth_headers, test_user, db_session
):
    """SCENARIO:   the same payment reference submitted twice with different
                amounts.
    EXPECTED:   first 201, second 400 "already exists" — and the money-safety
                guarantee: the rejected payment changed NOTHING in the DB."""
    first = client.post("/api/transactions/", headers=auth_headers,
                        json={"reference": "DUP-REF", "amount": 5000})
    assert first.status_code == 201

    before = wallet_balances(db_session, test_user.id)

    second = client.post("/api/transactions/", headers=auth_headers,
                         json={"reference": "DUP-REF", "amount": 9999})
    assert second.status_code == 400
    assert "already exists" in second.json()["detail"]

    after = wallet_balances(db_session, test_user.id)
    assert before == after


def test_non_positive_amounts_rejected(client, auth_headers):
    """SCENARIO:   payments of 0 and of -50.
    EXPECTED:   both 422 (amount validation rejects non-positive money)."""
    zero = client.post("/api/transactions/", headers=auth_headers,
                       json={"reference": "ZERO-1", "amount": 0})
    negative = client.post("/api/transactions/", headers=auth_headers,
                           json={"reference": "NEG-1", "amount": -50})

    assert zero.status_code == 422
    assert negative.status_code == 422


def test_transactions_require_auth(client: TestClient):
    """SCENARIO:   payment attempt with no Authorization header.
    EXPECTED:   401 (the endpoint is not reachable anonymously)."""
    response = client.post("/api/transactions/",
                           json={"reference": "NOAUTH", "amount": 100})

    assert response.status_code == 401


# ---------------------------------------------------------------------------
# 3. ACCESS CONTROL — IDOR: lists are scoped to the owner
# ---------------------------------------------------------------------------


def test_transactions_scoped_to_owner(client, auth_headers, db_session):
    """SCENARIO:   user A pays; user B (a second registered user) lists
                THEIR OWN transactions.
    EXPECTED:   user B's list never contains user A's payment, while user
                A's list does (IDOR protection on the listing endpoint)."""
    client.post("/api/transactions/", headers=auth_headers,
                json={"reference": "MINE-1", "amount": 100})

    other = User(email="other@autowallet.dev", full_name="Other User",
                 hashed_password="x", bank_account_id="MA64000100008888")
    db_session.add(other)
    db_session.commit()
    other_headers = {"Authorization": "Bearer " + create_access_token(user_id=other.id, role=other.role.value)}

    other_refs = [t["reference"] for t in
                  client.get("/api/transactions/", headers=other_headers).json()]
    assert "MINE-1" not in other_refs

    mine_refs = [t["reference"] for t in
                 client.get("/api/transactions/", headers=auth_headers).json()]
    assert "MINE-1" in mine_refs


# ---------------------------------------------------------------------------
# 4. RULE CONDITIONS — savings cap enforced through the API
# ---------------------------------------------------------------------------


def test_conditional_rules_apply_live_through_api(client, auth_headers, test_user, db_session):
    """SCENARIO:   savings already AT its 10,000 cap, then an 8,500 payment.
    EXPECTED:   the savings rule's condition skips it (stays 10,000), rent
                and tax still take their shares, and the 15% that savings
                would have taken flows to free instead (4,250)."""
    db_session.query(Wallet).filter(
        Wallet.user_id == test_user.id, Wallet.wallet_type == "savings"
    ).first().balance = 10000.0  # at the cap
    db_session.commit()

    client.post("/api/transactions/", headers=auth_headers,
                json={"reference": "CAPPED-1", "amount": 8500})

    balances = wallet_balances(db_session, test_user.id)
    assert balances["savings"] == 10000.0   # unchanged: cap condition skipped the rule
    assert balances["rent"] == 3500.0
    assert balances["tax"] == 750.0
    assert balances["free"] == 4250.0       # savings' 15% went to free instead
    assert sum(balances.values()) == 18500.0  # 10,000 pre-existing + 8,500 payment
