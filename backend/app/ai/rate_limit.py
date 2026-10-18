import logging
import time
import uuid

import redis
from fastapi import Depends, HTTPException

from app.core.config import settings
from app.core.deps import get_current_user
from app.core.redis_client import redis_client
from app.models.models import User

logger = logging.getLogger(__name__)

WINDOW_SECONDS = 60


def check_rate_limit(user_id: str) -> tuple[bool, int]:
    """Count this question. Return (allowed, seconds to wait if not allowed)."""
    limit = settings.ai_rate_limit_per_minute
    key = f"ai:ratelimit:{user_id}"
    now = time.time()
    member = f"{now}:{uuid.uuid4().hex}"

    pipe = redis_client.pipeline(transaction=True)
    pipe.zremrangebyscore(key, 0, now - WINDOW_SECONDS)  # forget questions older than 60 s
    pipe.zadd(key, {member: now})  # add this question
    pipe.zcard(key)  # how many questions in the last 60 s?
    pipe.expire(key, WINDOW_SECONDS)  # Redis deletes the list when the user stays quiet
    _, _, count, _ = pipe.execute()

    if count <= limit:
        return True, 0
    redis_client.zrem(key, member)  # refused questions don't count
    oldest = redis_client.zrange(key, 0, 0, withscores=True)
    wait = int(oldest[0][1] + WINDOW_SECONDS - now) + 1 if oldest else WINDOW_SECONDS
    return False, wait


def ai_rate_limit(current_user: User = Depends(get_current_user)) -> None:
    """Refuse with 429 when the user asked too many AI questions in the last minute."""
    try:
        allowed, wait = check_rate_limit(current_user.id)
    except redis.RedisError:
        logger.warning("Redis is down: the AI rate limit is not checked for this request")
        return
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={"code": "rate_limited", "message": f"Too many questions. Try again in {wait} seconds."},
            headers={"Retry-After": str(wait)},
        )
