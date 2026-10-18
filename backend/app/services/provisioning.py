from sqlalchemy.orm import Session

from app.models.models import Rule, RuleType, User, Wallet, WalletType


def create_default_wallets(user: User, db: Session) -> None:
    for wallet_type in WalletType:
        db.add(Wallet(user_id=user.id, wallet_type=wallet_type, balance=0.0))


def create_default_rules(user: User, db: Session) -> None:
    rules = [
        Rule(user_id=user.id, name="Rent lock", rule_type=RuleType.lock_fixed,
             target_wallet=WalletType.rent, priority=1, fixed_amount=3500.0,
             condition_field="rent_balance", condition_operator="<", condition_value=3500.0),

        Rule(user_id=user.id, name="Tax", rule_type=RuleType.percentage_remainder,
             target_wallet=WalletType.tax, priority=2, percentage=15.0),

        Rule(user_id=user.id, name="Savings (capped)", rule_type=RuleType.percentage_remainder,
             target_wallet=WalletType.savings, priority=3, percentage=15.0,
             condition_field="savings_balance", condition_operator="<", condition_value=10000.0),

        Rule(user_id=user.id, name="Free to spend", rule_type=RuleType.percentage_remainder,
             target_wallet=WalletType.free, priority=4, percentage=100.0),
    ]
    db.add_all(rules)