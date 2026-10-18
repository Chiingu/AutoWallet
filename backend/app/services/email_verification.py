import hashlib
import secrets
from app.core.redis_client import redis_client
from urllib.parse import urlencode
from app.core.config import settings
from app.gdpr.email import send_email, EmailError


VERIFY_TTL = 15 * 60  # 15 minutes


def token_key(token: str) -> str:
    fingerprint = hashlib.sha256(
        token.encode("utf-8")
    ).hexdigest()

    return f"email_verify:{fingerprint}"


def create_verification_token(user_id: str) -> str:
    token = secrets.token_urlsafe(32)

    redis_client.setex(
        token_key(token),
        VERIFY_TTL,
        str(user_id),
    )

    return token


def send_verification_email(user):
    token = create_verification_token(str(user.id))

    separator = (
        "&" if "?" in settings.frontend_email_verify_url
        else "?"
    )

    verification_url = (
        f"{settings.frontend_email_verify_url}"
        f"{separator}{urlencode({'token': token})}"
    )

    try:
        send_email(
            to=user.email,
            subject="Verify your AutoWallet email",
            body=(
                "Hello,\n\n"
                "Please verify your AutoWallet email address:\n\n"
                f"{verification_url}\n\n"
                "This link expires in 15 minutes.\n\n"
                "If you did not create this account, "
                "you can ignore this email."
            ),
        )

    except EmailError:
        redis_client.delete(token_key(token))
        raise