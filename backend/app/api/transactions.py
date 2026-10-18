from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.schemas import TransactionCreate, TransactionOut
from app.core.database import get_db
from app.core.deps import get_current_user, require_linked_account
from app.models.models import Rule, Transaction, TransactionStatus, User, Wallet
from app.services.rule_engine import RuleInput, apply_rules
from app.api.schemas import TransactionOut
from app.core.redis_client import redis_client
from app.services.payment_processor import process_payment
from app.core.auth_client import require_client

router = APIRouter(prefix="/api/transactions", tags=["transactions"], dependencies=[Depends(require_client)])


@router.post("/", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def create_transaction(
    payload: TransactionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_linked_account),
):
    try:
        transaction = process_payment(current_user, payload.reference, payload.amount, db)
    except RuntimeError:
        raise HTTPException(
            status_code=409,
            detail="Another payment for this account is still being processed, try again shortly",
        )
    if transaction is None:
        raise HTTPException(status_code=400, detail="A transaction with this reference already exists")
    return transaction


@router.get("/", response_model=list[TransactionOut])
def list_transactions(db: Session = Depends(get_db), current_user: User = Depends(require_linked_account)):
    return (
        db.query(Transaction)
        .filter(Transaction.user_id == current_user.id)
        .order_by(Transaction.created_at.desc())
        .all()
    )