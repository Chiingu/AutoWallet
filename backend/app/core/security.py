from datetime import datetime, timedelta

import jwt
from passlib.context import CryptContext
import hashlib
import hmac
import secrets
from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours, as discussed
RECOVERY_CODE_COUNT = 10


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(user_id: str, role: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": user_id, "role": role, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def decode_token(token: str) -> str | None:
    """Returns the user_id if the token is valid, otherwise None."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None


import pyotp

# Generate a random secret
def generate_totp_secret() -> str:
    return pyotp.random_base32()

# Create a provisioning URI
def get_totp_uri(secret: str, email: str) -> str:
    return pyotp.totp.TOTP(secret).provisioning_uri(
        name=email, # Associate this TOTP account with this email address.
        issuer_name="AutoWallet" # the service/application that owns the account.
        )
# Check if this 6-digit code correct for this user's secret and the current time?
def verify_totp_code(secret: str, code: str) -> bool:
    return pyotp.TOTP(secret).verify(code, valid_window=1)


def normalize_recovery_code(code: str) -> str:
    return code.strip().upper()


def generate_recovery_codes() -> list[str]:
    return [
        secrets.token_hex(16).upper()
        for _ in range(RECOVERY_CODE_COUNT)
    ]


def hash_recovery_code(code: str) -> str:
    normalized = normalize_recovery_code(code)

    return hmac.new(
        settings.secret_key.encode("utf-8"),
        normalized.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()