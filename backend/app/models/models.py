import enum
import uuid
from datetime import datetime
from sqlalchemy import UniqueConstraint

from sqlalchemy import (
    Column, String, Float, Integer, Boolean,
    ForeignKey, DateTime, Enum as SAEnum
)
from sqlalchemy.orm import relationship

from app.core.database import Base


class UserRole(str, enum.Enum):
    """Two roles for now — this is what the 'Advanced permissions' module needs later."""
    user = "user"
    admin = "admin"

class WalletType(str, enum.Enum):
    """The five envelopes FlowPay's rule engine splits money into."""
    main = "main"
    rent = "rent"
    tax = "tax"
    savings = "savings"
    free = "free"


class RuleType(str, enum.Enum):
    """The two kinds of rule the engine understands, from our earlier diagrams."""
    lock_fixed = "lock_fixed"
    percentage_remainder = "percentage_remainder"


class TransactionStatus(str, enum.Enum):
    pending = "pending"
    processed = "processed"
    failed = "failed"


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=True)  # nullable: OAuth users won't have one
    full_name = Column(String, nullable=False)
    role = Column(SAEnum(UserRole), default=UserRole.user, nullable=False)
    is_active = Column(Boolean, default=True)
    bank_account_id = Column(String, nullable=True, unique=True)
    email_verified = Column(Boolean,nullable=False,default=False,)

    # OAuth login — filled in only if the user signs up via Google/GitHub/etc.
    oauth_provider = Column(String, nullable=True)
    oauth_id = Column(String, nullable=True)

    # 2FA — empty until the user turns it on
    two_factor_secret = Column(String, nullable=True)
    two_factor_enabled = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)

    wallets = relationship("Wallet", back_populates="owner", cascade="all, delete-orphan")
    rules = relationship("Rule", back_populates="owner", cascade="all, delete-orphan")
    transactions = relationship("Transaction", back_populates="owner", cascade="all, delete-orphan")
    recovery_codes = relationship("TwoFactorRecoveryCode",back_populates="user",cascade="all, delete-orphan",)

class TwoFactorRecoveryCode(Base):
    __tablename__ = "two_factor_recovery_codes"

    id = Column(
        String,
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    user_id = Column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    code_hash = Column(String(64), nullable=False)

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    user = relationship(
        "User",
        back_populates="recovery_codes",
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "code_hash",
            name="uq_recovery_code_user_hash",
        ),
    )

class Wallet(Base):
    __tablename__ = "wallets"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    wallet_type = Column(SAEnum(WalletType), nullable=False)
    balance = Column(Float, default=0.0, nullable=False)

    owner = relationship("User", back_populates="wallets")


class Rule(Base):
    __tablename__ = "rules"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    rule_type = Column(SAEnum(RuleType), nullable=False)
    target_wallet = Column(SAEnum(WalletType), nullable=False)
    priority = Column(Integer, nullable=False)  # lower number = runs first

    fixed_amount = Column(Float, nullable=True)      # used when rule_type = lock_fixed
    percentage = Column(Float, nullable=True)        # used when rule_type = percentage_remainder

    # Optional condition, e.g. "only run if savings balance < 5000"
    condition_field = Column(String, nullable=True)
    condition_operator = Column(String, nullable=True)   # "<", ">", "==", etc.
    condition_value = Column(Float, nullable=True)

    is_active = Column(Boolean, default=True)

    owner = relationship("User", back_populates="rules")


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    reference = Column(String, unique=True, nullable=False, index=True)  # duplicate check uses this
    amount = Column(Float, nullable=False)
    status = Column(SAEnum(TransactionStatus), default=TransactionStatus.pending)
    created_at = Column(DateTime, default=datetime.utcnow)
    processed_at = Column(DateTime, nullable=True)

    owner = relationship("User", back_populates="transactions")