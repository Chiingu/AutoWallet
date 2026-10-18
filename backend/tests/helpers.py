"""Shared helpers for the backend test suite.

Plain support functions used by more than one test module (NOT fixtures —
those live in conftest.py). Import what you need:

    from tests.helpers import make_user, wallet_balances, mock_account, SIMULATOR
"""
from app.core.security import hash_password
from app.models.models import User, Wallet
from app.services.provisioning import create_default_rules, create_default_wallets

# The bank-simulator base URL as the backend sees it (respx intercepts it).
SIMULATOR = "http://127.0.0.1:8001"


def make_user(db_session, email, bank_account_id=None):
    """Create a user (optionally bank-linked) + the promised 5 wallets and
    4 rules, and return the user id.

    The id is read eagerly because later poller commits expire ORM objects —
    always compare against this returned id, never user.id after a poll."""
    user = User(
        email=email,
        full_name=f"User {email}",
        hashed_password=hash_password("SuperSecret1337!"),
        bank_account_id=bank_account_id,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    user_id = user.id  # read eagerly: poller commits will expire ORM objects
    create_default_wallets(user, db_session)
    create_default_rules(user, db_session)
    db_session.commit()
    return user_id


def wallet_balances(db_session, user_id):
    """Read a user's wallet balances straight from the database, as a dict
    keyed by wallet type ("rent", "tax", "savings", "free", "main")."""
    wallets = db_session.query(Wallet).filter(Wallet.user_id == user_id).all()
    return {w.wallet_type.value: w.balance for w in wallets}


def mock_account(simulator_url, account_id, transactions, status=200):
    """Tell respx: when the poller asks for this simulator account, answer
    with the given transactions (status 200) or the given status code."""
    import respx

    route = respx.get(f"{simulator_url}/simulator/accounts/{account_id}")
    if status == 200:
        route.respond(json={"balance": sum(t["amount"] for t in transactions),
                            "transactions": transactions})
    else:
        route.respond(status_code=status)
    return route
