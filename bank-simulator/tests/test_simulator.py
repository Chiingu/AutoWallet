"""Tests for the bank simulator (bank-simulator/main.py).

The simulator is the fake bank the backend polls every 60s. Its two
endpoints are simple and stateless-ish (in-memory), so these tests use
the same TestClient style as the backend suite — but with one twist:
the simulator keeps its state in a module-level dict, so each test
resets it by hand to stay isolated.
"""
import pytest
from fastapi.testclient import TestClient

import main  # the simulator app module


@pytest.fixture
def client():
    """Test client with a clean account book for every test."""
    main.accounts = {}  # reset the simulator's in-memory state
    with TestClient(main.app) as c:
        yield c
    main.accounts = {}


def inject(client, account_id="ACC-1", reference="REF-1", amount=1000.0, **extra):
    """Standard inject call; tests override what they need."""
    return client.post("/simulator/inject", json={
        "account_id": account_id, "reference": reference, "amount": amount, **extra
    })


def get_account(client, account_id="ACC-1"):
    return client.get(f"/simulator/accounts/{account_id}")


def test_inject_creates_account_and_returns_new_balance(client):
    response = inject(client, amount=500)
    assert response.status_code == 200
    assert response.json() == {"account_id": "ACC-1", "new_balance": 500.0}


def test_account_auto_created_on_first_mention(client):
    """Injecting to a never-seen account must NOT 404 — the account is
    created on first mention (documented simulator behavior)."""
    assert get_account(client, "BRAND-NEW").status_code == 404  # not seen yet
    inject(client, account_id="BRAND-NEW")
    assert get_account(client, "BRAND-NEW").status_code == 200


def test_second_inject_accumulates_balance(client):
    inject(client, reference="R1", amount=300)
    response = inject(client, reference="R2", amount=200)
    assert response.status_code == 200
    assert response.json()["new_balance"] == 500.0

    history = get_account(client).json()["transactions"]
    assert {t["reference"] for t in history} == {"R1", "R2"}


def test_duplicate_reference_rejected_and_balance_unchanged(client):
    """The money-safety pattern: a rejected duplicate must leave the
    account exactly as it was."""
    inject(client, reference="DUP", amount=1000)

    before = get_account(client).json()
    rejected = inject(client, reference="DUP", amount=9999)
    after = get_account(client).json()

    assert rejected.status_code == 400
    assert "already injected" in rejected.json()["detail"]
    assert before == after  # balance AND history untouched


def test_unknown_account_returns_404(client):
    assert get_account(client, "GHOST").status_code == 404


def test_get_returns_balance_and_history(client):
    inject(client, reference="TX-A", amount=150.5)
    body = get_account(client).json()
    assert body["balance"] == 150.5
    assert body["transactions"] == [{"reference": "TX-A", "amount": 150.5}]


def test_accounts_are_isolated_from_each_other(client):
    inject(client, account_id="ACC-A", reference="R1", amount=100)
    inject(client, account_id="ACC-B", reference="R1", amount=200)  # same ref, other account: fine

    assert get_account(client, "ACC-A").json()["balance"] == 100.0
    assert get_account(client, "ACC-B").json()["balance"] == 200.0


def test_missing_fields_rejected(client):
    assert client.post("/simulator/inject", json={"account_id": "X"}).status_code == 422
    assert client.post("/simulator/inject", json={"reference": "R"}).status_code == 422
    assert client.post("/simulator/inject", json={}).status_code == 422


def test_negative_and_zero_amounts_rejected():
    """ACCEPTANCE TEST for QA finding #4 — blocks merge until fixed.

    The simulator feeds the backend via the polling path, which performs
    no validation of its own. A negative or zero "deposit" accepted here
    becomes a real processed transaction with a negative amount on the
    backend (pinned and verified live 2026-09-13). The manual endpoint
    (TransactionCreate, Field(gt=0)) already rejects these — the fake
    bank must not be more permissive than the system it feeds.

    Expected once fixed: InjectPayment.amount gains Field(gt=0) and
    these injects return 422 like TransactionCreate does."""
    import main
    main.accounts = {}
    with TestClient(main.app) as client:
        assert inject(client, reference="NEG", amount=-500).status_code == 422
        assert inject(client, reference="ZERO", amount=0).status_code == 422
        assert get_account(client).status_code == 404 
    main.accounts = {}
