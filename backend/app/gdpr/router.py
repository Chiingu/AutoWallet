import csv
import hashlib
import hmac
import io
import json
import secrets
import zipfile
from datetime import datetime, timezone
from typing import Literal

import redis
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.redis_client import redis_client
from app.gdpr.email import EmailError, send_email
from app.gdpr.schemas import DeleteConfirm, GdprMessage
from app.models.models import Rule, Transaction, User, Wallet

router = APIRouter(prefix="/api/gdpr", tags=["gdpr"])

CODE_VALID_SECONDS = 15 * 60  # the deletion code works for 15 minutes
RESEND_WAIT_SECONDS = 60  # a new code can be asked for 1 minute after the last one
MAX_TRIES = 5  # wrong codes allowed before the code is cancelled

ENVELOPE_COLUMNS = ["type", "balance"]
RULE_COLUMNS = [
    "priority", "name", "type", "envelope", "fixed_amount", "percentage",
    "condition_field", "condition_operator", "condition_value", "active",
]
PAYMENT_COLUMNS = ["reference", "amount", "status", "created_at", "processed_at"]



def _unavailable() -> HTTPException:
    """Redis is down: we can't keep or check the deletion code."""
    return HTTPException(
        status_code=503,
        detail={"code": "unavailable", "message": "This is not available right now. Please try again later."},
    )


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _date_for_email() -> str:
    return _now().strftime("%d %B %Y at %H:%M UTC")


def collect_user_data(user: User, db: Session) -> dict:
    """Everything AutoWallet stores about this user, as plain data. Never the password hash or the 2FA secret."""
    wallets = db.query(Wallet).filter(Wallet.user_id == user.id).all()
    rules = db.query(Rule).filter(Rule.user_id == user.id).order_by(Rule.priority).all()
    payments = db.query(Transaction).filter(Transaction.user_id == user.id).order_by(Transaction.created_at).all()
    return {
        "exported_at": _now().isoformat(),
        "profile": {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "bank_account_id": user.bank_account_id,
            "role": user.role.value,
            "signs_in_with": "google" if user.oauth_provider == "google" else "email and password",
            "two_factor_enabled": bool(user.two_factor_enabled),
            "created_at": _iso(user.created_at),
        },
        "envelopes": [{"type": w.wallet_type.value, "balance": w.balance} for w in wallets],
        "rules": [
            {
                "priority": r.priority,
                "name": r.name,
                "type": r.rule_type.value,
                "envelope": r.target_wallet.value,
                "fixed_amount": r.fixed_amount,
                "percentage": r.percentage,
                "condition_field": r.condition_field,
                "condition_operator": r.condition_operator,
                "condition_value": r.condition_value,
                "active": r.is_active,
            }
            for r in rules
        ],
        "payments": [
            {
                "reference": t.reference,
                "amount": t.amount,
                "status": t.status.value if t.status else None,
                "created_at": _iso(t.created_at),
                "processed_at": _iso(t.processed_at),
            }
            for t in payments
        ],
    }


def _csv(rows: list[dict], columns: list[str]) -> str:
    """One table as CSV text: the first line holds the column names."""
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=columns)
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue()


def _zip_of_csv(data: dict) -> bytes:
    """profile.csv, envelopes.csv, rules.csv and payments.csv in one zip file."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("profile.csv", _csv([data["profile"]], list(data["profile"])))
        archive.writestr("envelopes.csv", _csv(data["envelopes"], ENVELOPE_COLUMNS))
        archive.writestr("rules.csv", _csv(data["rules"], RULE_COLUMNS))
        archive.writestr("payments.csv", _csv(data["payments"], PAYMENT_COLUMNS))
    return buffer.getvalue()


def _send_quietly(to: str, subject: str, body: str) -> None:
    """Send a confirmation email. If it fails, the action still succeeds (send_email already logged why)."""
    try:
        send_email(to, subject, body)
    except EmailError:
        pass


def _code_key(user_id: str) -> str:
    return f"gdpr:delete:{user_id}"


def _hash_code(user_id: str, code: str) -> str:
    """We store a hash of the code, never the code itself."""
    return hashlib.sha256(f"{user_id}:{code}".encode()).hexdigest()


@router.get("/export")
def export_my_data(
    file_format: Literal["json", "csv"] = Query("json", alias="format"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Download a copy of everything AutoWallet stores about you: JSON, or CSV tables in a zip."""
    data = collect_user_data(current_user, db)
    _send_quietly(
        current_user.email,
        "Your AutoWallet data export",
        f"Hello {current_user.full_name},\n\n"
        f"A copy of your AutoWallet data was downloaded on {_date_for_email()} ({file_format.upper()}).\n"
        "If this wasn't you, change your password and turn on two-factor authentication.\n\n"
        "The AutoWallet team",
    )
    if file_format == "csv":
        return Response(
            _zip_of_csv(data),
            media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="autowallet-my-data.zip"'},
        )
    return Response(
        json.dumps(data, indent=2, ensure_ascii=False),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="autowallet-my-data.json"'},
    )


@router.post("/delete-request", status_code=202, response_model=GdprMessage)
def request_account_deletion(current_user: User = Depends(get_current_user)):
    """Step 1 of 2: email a 6-digit code that confirms the deletion (valid 15 minutes)."""
    key = _code_key(current_user.id)
    code = f"{secrets.randbelow(1_000_000):06d}"
    try:
        seconds_left = redis_client.ttl(key)
        if seconds_left > CODE_VALID_SECONDS - RESEND_WAIT_SECONDS:
            wait = seconds_left - (CODE_VALID_SECONDS - RESEND_WAIT_SECONDS)
            raise HTTPException(
                status_code=429,
                detail={"code": "wait", "message": f"A code was just sent. You can ask for a new one in {wait} seconds."},
                headers={"Retry-After": str(wait)},
            )
        pipe = redis_client.pipeline(transaction=True)
        pipe.delete(key)  # a new code replaces the old one
        pipe.hset(key, mapping={"hash": _hash_code(current_user.id, code), "tries": 0})
        pipe.expire(key, CODE_VALID_SECONDS)
        pipe.execute()
    except redis.RedisError:
        raise _unavailable()

    try:
        send_email(
            current_user.email,
            "Confirm the deletion of your AutoWallet account",
            f"Hello {current_user.full_name},\n\n"
            "Someone asked to delete your AutoWallet account and all its data.\n\n"
            f"Your confirmation code is: {code}\n"
            "It is valid for 15 minutes.\n\n"
            "If this wasn't you, ignore this email: nothing will be deleted.\n\n"
            "The AutoWallet team",
        )
    except EmailError:
        redis_client.delete(key)
        raise HTTPException(
            status_code=503,
            detail={"code": "email_unavailable", "message": "We could not send the confirmation email. Please try again later."},
        )
    return GdprMessage(message="We sent a 6-digit code to your email. It is valid for 15 minutes.")


@router.post("/delete-confirm", response_model=GdprMessage)
def confirm_account_deletion(
    payload: DeleteConfirm,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Step 2 of 2: check the code, then delete the account and ALL its data (envelopes, rules, payments)."""
    key = _code_key(current_user.id)
    try:
        stored_hash = redis_client.hget(key, "hash")
        if stored_hash is None:
            raise HTTPException(
                status_code=400,
                detail={"code": "no_code", "message": "There is no valid code. Ask for a new one."},
            )
        tries = redis_client.hincrby(key, "tries", 1)
        if not hmac.compare_digest(stored_hash, _hash_code(current_user.id, payload.code)):
            tries_left = MAX_TRIES - tries
            if tries_left <= 0:
                redis_client.delete(key)
                raise HTTPException(
                    status_code=429,
                    detail={"code": "too_many_tries", "message": "Too many wrong codes. Ask for a new one."},
                )
            raise HTTPException(
                status_code=400,
                detail={"code": "wrong_code", "message": f"Wrong code. {tries_left} {'try' if tries_left == 1 else 'tries'} left."},
            )
        redis_client.delete(key)
    except redis.RedisError:
        raise _unavailable()

    email, name = current_user.email, current_user.full_name
    db.delete(current_user)  # the cascade also deletes the user's envelopes, rules and payments
    db.commit()
    _send_quietly(
        email,
        "Your AutoWallet account was deleted",
        f"Hello {name},\n\n"
        f"Your AutoWallet account and all its data (envelopes, rules and payments) were deleted on {_date_for_email()}.\n"
        "Thank you for trying AutoWallet.\n\n"
        "The AutoWallet team",
    )
    return GdprMessage(message="Your account and all its data were deleted.")
