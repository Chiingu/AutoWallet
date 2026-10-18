from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.deps import get_current_user
from app.services.provisioning import create_default_rules, create_default_wallets

from app.api.schemas import Token, UserLogin, UserOut, UserRegister, LinkBankAccount
from app.core.database import get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.models.models import User

from app.core.redis_client import redis_client
from app.gdpr.email import EmailError

from app.api.schemas import TwoFactorSetupOut, TwoFactorVerify
from app.core.security import generate_totp_secret, get_totp_uri, verify_totp_code
from app.api.schemas import (
    ResendVerificationRequest,
    VerifyEmailRequest,
    MessageResponse,
    DisableTwoFactorRequest
)

from sqlalchemy import delete

from app.models.models import TwoFactorRecoveryCode
from app.api.schemas import (
    RecoveryCodesOut,
    RegenerateRecoveryCodesRequest,
)

from app.core.security import (
    generate_recovery_codes,
    hash_recovery_code,
)

from app.services.email_verification import token_key

import logging
from app.services.email_verification import send_verification_email
logger = logging.getLogger(__name__)
from sqlalchemy.exc import SQLAlchemyError
from redis.exceptions import RedisError

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
)
def register(
    payload: UserRegister,
    db: Session = Depends(get_db),
):
    email = str(payload.email).strip().lower()

    if db.query(User).filter(User.email == email).first():
        raise HTTPException(
            status_code=400,
            detail="An account with this email already exists",
        )

    if db.query(User).filter(
        User.bank_account_id == payload.bank_account_id
    ).first():
        raise HTTPException(
            status_code=400,
            detail="This bank account is already linked to another user",
        )

    user = User(
        full_name=payload.full_name,
        email=email,
        hashed_password=hash_password(payload.password),
        bank_account_id=payload.bank_account_id,
        email_verified=False,
    )

    try:
        db.add(user)
        db.flush()

        create_default_wallets(user, db)
        create_default_rules(user, db)

        db.commit()
        db.refresh(user)

    except Exception:
        db.rollback()
        raise

    # The account is already committed.
    # Email failure must not cancel registration.
    try:
        send_verification_email(user)

    except (EmailError, RedisError):
        logger.exception(
            "Could not initiate verification email for user %s",
            user.id,
        )

    return user


@router.post("/login", response_model=Token)
def login(
    payload: UserLogin,
    db: Session = Depends(get_db),
):
    email = str(payload.email).strip().lower()

    user = (
        db.query(User)
        .filter(User.email == email)
        .first()
    )

    if (
        not user
        or not user.hashed_password
        or not verify_password(
            payload.password,
            user.hashed_password,
        )
    ):
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password",
        )

    if user.two_factor_enabled:
        if payload.totp_code and payload.recovery_code:
            raise HTTPException(
                status_code=400,
                detail="Provide only one 2FA method",
            )

        if payload.totp_code:
            if not verify_totp_code(
                user.two_factor_secret,
                payload.totp_code,
            ):
                raise HTTPException(
                    status_code=401,
                    detail="Invalid 2FA code",
                )

        elif payload.recovery_code:
            code_hash = hash_recovery_code(
                payload.recovery_code
            )

            try:
                result = db.execute(
                    delete(TwoFactorRecoveryCode).where(
                        TwoFactorRecoveryCode.user_id
                        == user.id,
                        TwoFactorRecoveryCode.code_hash
                        == code_hash,
                    )
                )

                if result.rowcount != 1:
                    db.rollback()
                    raise HTTPException(
                        status_code=401,
                        detail="Invalid recovery code",
                    )

                db.commit()

            except HTTPException:
                raise

            except Exception:
                db.rollback()
                raise

        else:
            raise HTTPException(
                status_code=401,
                detail="2FA code required",
            )

    return Token(
        access_token=create_access_token(
            user_id=user.id,
            role=user.role.value,
        )
    )


# get has no request body
@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user

@router.post("/2fa/setup", response_model=TwoFactorSetupOut)
def setup_2fa(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.two_factor_enabled:
        raise HTTPException(
            status_code=409,
            detail="2FA is already enabled",
        )

    secret = generate_totp_secret()

    current_user.two_factor_secret = secret
    db.commit()

    return TwoFactorSetupOut(
        secret=secret,
        provisioning_uri=get_totp_uri(
            secret,
            current_user.email,
        ),
    )

@router.post("/2fa/verify", response_model=RecoveryCodesOut)
def verify_2fa(
    payload: TwoFactorVerify,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.two_factor_enabled:
        raise HTTPException(
            status_code=409,
            detail="2FA is already enabled",
        )

    if not current_user.two_factor_secret:
        raise HTTPException(
            status_code=400,
            detail="2FA setup has not been started",
        )

    if not verify_totp_code(
        current_user.two_factor_secret,
        payload.code,
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid code",
        )

    codes = generate_recovery_codes()

    try:
        for code in codes:
            db.add(
                TwoFactorRecoveryCode(
                    user_id=current_user.id,
                    code_hash=hash_recovery_code(code),
                )
            )

        current_user.two_factor_enabled = True
        db.commit()

    except Exception:
        db.rollback()
        raise

    return RecoveryCodesOut(
        message="2FA enabled. Save your recovery codes.",
        recovery_codes=codes,
    )


@router.post(
    "/2fa/recovery-codes/regenerate",
    response_model=RecoveryCodesOut,
)
def regenerate_recovery_codes(
    payload: RegenerateRecoveryCodesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.two_factor_enabled:
        raise HTTPException(
            status_code=400,
            detail="2FA is not enabled",
        )

    if (
        not current_user.hashed_password
        or not verify_password(
            payload.password,
            current_user.hashed_password,
        )
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials",
        )

    if not verify_totp_code(
        current_user.two_factor_secret,
        payload.totp_code,
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials",
        )

    codes = generate_recovery_codes()

    try:
        db.execute(
            delete(TwoFactorRecoveryCode).where(
                TwoFactorRecoveryCode.user_id
                == current_user.id
            )
        )

        for code in codes:
            db.add(
                TwoFactorRecoveryCode(
                    user_id=current_user.id,
                    code_hash=hash_recovery_code(code),
                )
            )

        db.commit()

    except Exception:
        db.rollback()
        raise

    return RecoveryCodesOut(
        message="Recovery codes regenerated.",
        recovery_codes=codes,
    )


@router.post("/link-bank-account", response_model=UserOut)
def link_bank_account(
    payload: LinkBankAccount,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.bank_account_id is not None:
        raise HTTPException(status_code=400, detail="A bank account is already linked")

    if db.query(User).filter(User.bank_account_id == payload.bank_account_id).first():
        raise HTTPException(status_code=400, detail="This bank account is already linked to another user")

    current_user.bank_account_id = payload.bank_account_id
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post(
    "/email/resend",
    response_model=MessageResponse,
)
def resend_verification(
    payload: ResendVerificationRequest,
    db: Session = Depends(get_db),
):
    generic_response = MessageResponse(
        message=(
            "If the account needs verification, "
            "a verification email will be sent."
        )
    )

    email = str(payload.email).strip().lower()

    user = (
        db.query(User)
        .filter(User.email == email)
        .first()
    )

    if user is None or user.email_verified:
        return generic_response

    cooldown_key = f"email_verify:cooldown:{user.id}"

    cooldown_started = redis_client.set(
        cooldown_key,
        "1",
        nx=True,
        ex=60,
    )

    if not cooldown_started:
        return generic_response

    try:
        send_verification_email(user)

    except EmailError:
        redis_client.delete(cooldown_key)

        logger.warning(
            "Verification resend failed for user %s",
            user.id,
        )

        raise HTTPException(
            status_code=503,
            detail="Email service temporarily unavailable",
        )

    return generic_response

@router.post(
    "/email/verify",
    response_model=MessageResponse,
)
def verify_email(
    payload: VerifyEmailRequest,
    db: Session = Depends(get_db),
):
    user_id = redis_client.getdel(
        token_key(payload.token)
    )

    if user_id is None:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired verification token",
        )

    user = (
        db.query(User)
        .filter(User.id == user_id)
        .first()
    )

    if user is None:
        raise HTTPException(
            status_code=400,
            detail="Invalid verification token",
        )

    if user.email_verified:
        return MessageResponse(
            message="Email already verified"
        )

    try:
        user.email_verified = True
        db.commit()

    except SQLAlchemyError:
        db.rollback()

        logger.exception(
            "Failed to verify email for user %s",
            user.id,
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Verification temporarily unavailable. "
                "Please request another verification link."
            ),
        )

    return MessageResponse(
        message="Email verified successfully"
    )


@router.post("/2fa/disable", response_model=MessageResponse)
def disable_2fa(
    payload: DisableTwoFactorRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.two_factor_enabled:
        raise HTTPException(
            status_code=409,
            detail="2FA is not enabled",
        )

    if (
        not current_user.hashed_password
        or not verify_password(
            payload.password,
            current_user.hashed_password,
        )
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials",
        )

    if bool(payload.totp_code) == bool(payload.recovery_code):
        raise HTTPException(
            status_code=400,
            detail="Provide exactly one 2FA method",
        )

    if payload.totp_code:
        if (
            not current_user.two_factor_secret
            or not verify_totp_code(
                current_user.two_factor_secret,
                payload.totp_code,
            )
        ):
            raise HTTPException(
                status_code=401,
                detail="Invalid credentials",
            )

    else:
        code_hash = hash_recovery_code(payload.recovery_code)

        existing_code = db.query(TwoFactorRecoveryCode.id).filter(
            TwoFactorRecoveryCode.user_id == current_user.id,
            TwoFactorRecoveryCode.code_hash == code_hash,
        ).first()

        if existing_code is None:
            raise HTTPException(
                status_code=401,
                detail="Invalid credentials",
            )

    try:
        db.execute(
            delete(TwoFactorRecoveryCode).where(
                TwoFactorRecoveryCode.user_id == current_user.id
            )
        )

        current_user.two_factor_enabled = False
        current_user.two_factor_secret = None

        db.commit()

    except Exception:
        db.rollback()
        raise

    return MessageResponse(
        message="Two-factor authentication disabled successfully"
    )
