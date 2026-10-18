import json
import logging

import redis

from app.core.redis_client import redis_client

logger = logging.getLogger(__name__)


def user_channel(user_id: str) -> str:
    """The Redis channel where this user's live events go (the analytics dashboard listens to it)."""
    return f"events:user:{user_id}"


def publish_payment_processed(user_id: str, reference: str, amount: float, allocations: dict[str, float]) -> None:
    """Announce that a payment was split. If Redis is down, the payment still succeeds."""
    event = {"type": "payment.processed", "reference": reference, "amount": amount, "allocations": allocations}
    try:
        redis_client.publish(user_channel(user_id), json.dumps(event))
    except redis.RedisError:
        logger.warning("Could not publish the live event for user %s", user_id)
