from datetime import datetime

from sqlalchemy.orm import Session

from app.analytics.events import publish_payment_processed
from app.core.redis_client import redis_client
from app.models.models import Allocation, Rule, Transaction, TransactionStatus, User, Wallet, WalletType
from app.services.rule_engine import RuleInput, apply_rules


def process_payment(user: User, reference: str, amount: float, db: Session) -> Transaction | None:
    """
    Shared by both the manual POST /transactions endpoint and the polling job.
    Returns None if this reference was already processed (not an error - just a no-op).
    """
    lock = redis_client.lock(f"lock:user:{user.id}", timeout=10, blocking_timeout=5)
    if not lock.acquire(blocking=True):
        raise RuntimeError(f"Could not acquire lock for user {user.id}")

    try:
        if db.query(Transaction).filter(Transaction.reference == reference).first():
            return None  # already processed - not an error, just skip it

        transaction = Transaction(user_id=user.id, reference=reference, amount=amount, status=TransactionStatus.pending)
        db.add(transaction)
        db.commit()
        db.refresh(transaction)

        wallets = db.query(Wallet).filter(Wallet.user_id == user.id).all()
        wallet_balances = {f"{w.wallet_type.value}_balance": w.balance for w in wallets}
        wallets_by_type = {w.wallet_type.value: w for w in wallets}

        rules = db.query(Rule).filter(Rule.user_id == user.id, Rule.is_active == True).all()  # noqa: E712
        rule_inputs = [
            RuleInput(
                name=r.name, rule_type=r.rule_type.value, target_wallet=r.target_wallet.value,
                priority=r.priority, fixed_amount=r.fixed_amount, percentage=r.percentage,
                condition_field=r.condition_field, condition_operator=r.condition_operator,
                condition_value=r.condition_value,
            )
            for r in rules
        ]

        allocations = apply_rules(amount, rule_inputs, wallet_balances)
        for wallet_type, take in allocations.items():
            wallets_by_type[wallet_type].balance += take
            # keep how this payment was split, for the analytics dashboard
            db.add(Allocation(transaction_id=transaction.id, user_id=user.id, wallet_type=WalletType(wallet_type), amount=take))

        transaction.status = TransactionStatus.processed
        transaction.processed_at = datetime.utcnow()
        db.commit()
        db.refresh(transaction)
        publish_payment_processed(user.id, reference, amount, allocations)
        return transaction
    finally:
        lock.release()