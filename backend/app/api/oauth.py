
import hashlib
import hmac
import logging
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.schemas import OAuthExchangeRequest, Token
from app.core.config import settings
from app.core.database import get_db
from app.core.redis_client import redis_client
from app.core.security import create_access_token
from app.models.models import User
from app.services.provisioning import (
    create_default_rules,
    create_default_wallets,
)

router = APIRouter(prefix="/api/auth/oauth/google", tags=["oauth"])
logger = logging.getLogger(__name__)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

OAUTH_STATE_TTL_SECONDS = 600
OAUTH_EXCHANGE_TTL_SECONDS = 120

COOKIE_NAME = "autowallet_google_oauth_nonce"
COOKIE_PATH = "/api/auth/oauth/google"

# Configure this explicitly for your deployment.
# HTTPS must be used in production.
COOKIE_SECURE = settings.google_redirect_uri.startswith("https://")


def _state_key(state: str, nonce: str) -> str:
    """
    Bind the OAuth state to the browser's random nonce.
    Neither the raw state nor nonce is stored in the Redis key.
    """
    digest = hashlib.sha256(
        f"{nonce}:{state}".encode("utf-8")
    ).hexdigest()
    return f"oauth:state:{digest}"


def _exchange_key(code: str) -> str:
    """
    Hash exchange codes before using them as Redis keys.
    """
    digest = hashlib.sha256(code.encode("utf-8")).hexdigest()
    return f"oauth:exchange:{digest}"


def _clear_oauth_cookie(response):
    response.delete_cookie(
        key=COOKIE_NAME,
        path=COOKIE_PATH,
        secure=COOKIE_SECURE,
        httponly=True,
        samesite="lax",
    )
    return response


def _google_request_error():
    return HTTPException(
        status_code=502,
        detail="Google authentication is temporarily unavailable",
    )


@router.get("/login")
def google_login():
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)

    try:
        redis_client.setex(
            _state_key(state, nonce),
            OAUTH_STATE_TTL_SECONDS,
            "1",
        )
    except Exception:
        logger.exception("Could not store OAuth state")
        raise HTTPException(
            status_code=503,
            detail="Authentication service unavailable",
        )

    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
    }

    response = RedirectResponse(
        url=f"{GOOGLE_AUTH_URL}?{urlencode(params)}",
        status_code=302,
    )

    response.set_cookie(
        key=COOKIE_NAME,
        value=nonce,
        max_age=OAUTH_STATE_TTL_SECONDS,
        path=COOKIE_PATH,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
    )

    return response


@router.get("/callback")
def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    nonce = request.cookies.get(COOKIE_NAME)

    # Reject missing browser-bound state.
    if not state or not nonce:
        raise HTTPException(
            status_code=400,
            detail="Invalid OAuth session",
            headers={
                "Cache-Control": "no-store",
            },
        )

    # Check both values together, and consume the state once.
    try:
        stored_state = redis_client.getdel(
            _state_key(state, nonce)
        )
    except Exception:
        logger.exception("OAuth state validation failed")
        raise HTTPException(
            status_code=503,
            detail="Authentication service unavailable",
        )

    if stored_state is None:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired OAuth state",
        )

    if error:
        raise HTTPException(
            status_code=400,
            detail="Google authentication was cancelled or denied",
        )

    if not code:
        raise HTTPException(
            status_code=400,
            detail="Missing Google authorization code",
        )

    # Exchange Google's authorization code server-to-server.
    try:
        token_response = httpx.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": settings.google_redirect_uri,
            },
            timeout=10.0,
        )
    except httpx.RequestError:
        logger.exception("Google token endpoint unavailable")
        raise _google_request_error()

    if token_response.status_code != 200:
        raise HTTPException(
            status_code=401,
            detail="Google rejected the authorization code",
        )

    try:
        token_data = token_response.json()
    except ValueError:
        raise _google_request_error()

    access_token = token_data.get("access_token")

    if not isinstance(access_token, str) or not access_token:
        raise HTTPException(
            status_code=401,
            detail="Google did not return a valid access token",
        )

    # Retrieve identity from Google's userinfo endpoint.
    try:
        userinfo_response = httpx.get(
            GOOGLE_USERINFO_URL,
            headers={
                "Authorization": f"Bearer {access_token}"
            },
            timeout=10.0,
        )
    except httpx.RequestError:
        logger.exception("Google userinfo endpoint unavailable")
        raise _google_request_error()

    if userinfo_response.status_code != 200:
        raise HTTPException(
            status_code=401,
            detail="Could not verify Google identity",
        )

    try:
        profile = userinfo_response.json()
    except ValueError:
        raise _google_request_error()

    google_id = profile.get("sub")
    email = profile.get("email")
    full_name = profile.get("name") or email

    if (
        not isinstance(google_id, str)
        or not google_id
        or not isinstance(email, str)
        or not email
    ):
        raise HTTPException(
            status_code=401,
            detail="Google identity information is incomplete",
        )

    # Finding #18: require verified email.
    if profile.get("email_verified") is not True:
        raise HTTPException(
            status_code=401,
            detail="Google email is not verified",
        )

    # Look up the Google identity by its stable Google subject.
    user = (
        db.query(User)
        .filter(
            User.oauth_provider == "google",
            User.oauth_id == google_id,
        )
        .first()
    )

    if user is None:
        # Do not silently link an existing password account.
        existing_email_user = (
            db.query(User)
            .filter(User.email == email)
            .first()
        )

        if existing_email_user is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    "An account with this email already exists. "
                    "Sign in using your existing method."
                ),
            )

        # Create a new Google-only user.
        user = User(
            email=email,
            full_name=full_name,
            hashed_password=None,
            bank_account_id=None,
            oauth_provider="google",
            oauth_id=google_id,
        )

        try:
            db.add(user)
            db.flush()

            create_default_wallets(user, db)
            create_default_rules(user, db)

            db.commit()
            db.refresh(user)

        except IntegrityError:
            db.rollback()
            logger.warning(
                "Concurrent Google account creation conflict"
            )
            raise HTTPException(
                status_code=409,
                detail="Account creation conflict. Please retry.",
            )
        except Exception:
            db.rollback()
            logger.exception("Google user provisioning failed")
            raise HTTPException(
                status_code=500,
                detail="Could not create account",
            )

    # Issue a short-lived, single-use frontend exchange code.
    exchange_code = secrets.token_urlsafe(32)

    try:
        redis_client.setex(
            _exchange_key(exchange_code),
            OAUTH_EXCHANGE_TTL_SECONDS,
            str(user.id),
        )
    except Exception:
        logger.exception("Could not store OAuth exchange code")
        raise HTTPException(
            status_code=503,
            detail="Authentication service unavailable",
        )

    separator = (
        "&" if "?" in settings.frontend_google_callback_url else "?"
    )

    frontend_callback = (
        f"{settings.frontend_google_callback_url}"
        f"{separator}{urlencode({'code': exchange_code})}"
    )

    response = RedirectResponse(
        url=frontend_callback,
        status_code=302,
    )

    _clear_oauth_cookie(response)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"

    return response


@router.post("/exchange", response_model=Token)
def exchange_google_code(
    payload: OAuthExchangeRequest,
    db: Session = Depends(get_db),
):
    if not payload.code:
        raise HTTPException(
            status_code=400,
            detail="Missing OAuth exchange code",
        )

    try:
        user_id = redis_client.getdel(
            _exchange_key(payload.code)
        )
    except Exception:
        logger.exception("OAuth exchange failed")
        raise HTTPException(
            status_code=503,
            detail="Authentication service unavailable",
        )

    if user_id is None:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired OAuth exchange code",
        )

    user = (
        db.query(User)
        .filter(User.id == user_id)
        .first()
    )

    if user is None:
        raise HTTPException(
            status_code=401,
            detail="User not found",
        )

    # If your User model has an active/disabled status,
    # validate it here before issuing a JWT.

    return Token(
        access_token=create_access_token(
            user_id=user.id,
            role=user.role.value,
        )
    )
