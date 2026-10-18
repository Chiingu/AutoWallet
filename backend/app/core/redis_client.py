import redis

from app.core.config import settings

# create a Redis client object that our application
# uses to talk to a Redis server 
# and contructing from URL Instead of passing host, port and database number as separate arguments:
# like this redis://localhost:6379/0
# and With decode_responses=True, the client automatically decodes byte responses into Python str using UTF-8: 
redis_client = redis.Redis.from_url(settings.redis_url, decode_responses=True)