from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.schemas import RuleOut
from app.core.database import get_db
from app.core.deps import get_current_user, require_linked_account
from app.models.models import Rule, User
from app.api.schemas import OnboardingRulesUpdate

from app.core.auth_client import require_client

# , dependencies=[Depends(require_client)
router = APIRouter(prefix="/api/rules", tags=["rules"], dependencies=[Depends(require_client)]) 


@router.get("/", response_model=list[RuleOut])
def list_rules(db: Session = Depends(get_db), current_user: User = Depends(require_linked_account)):
    return db.query(Rule).filter(Rule.user_id == current_user.id).order_by(Rule.priority).all()

@router.patch("/onboarding", response_model=list[RuleOut])
def update_onboarding_rules(
    payload: OnboardingRulesUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_linked_account),
):
    rules = db.query(Rule).filter(Rule.user_id == current_user.id).all()
    by_name = {r.name: r for r in rules}

    rent = by_name.get("Rent lock")
    if rent:
        rent.fixed_amount = payload.rent_amount
        rent.condition_value = payload.rent_amount

    tax = by_name.get("Tax")
    if tax:
        tax.percentage = payload.tax_percent

    savings = by_name.get("Savings (capped)")
    if savings:
        savings.percentage = payload.savings_percent
        savings.condition_value = payload.savings_cap

    db.commit()
    return db.query(Rule).filter(Rule.user_id == current_user.id).order_by(Rule.priority).all()