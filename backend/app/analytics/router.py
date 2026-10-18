import json
from datetime import date, datetime, timedelta, timezone
from typing import Literal

import redis
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from redis import asyncio as aioredis
from sqlalchemy.orm import Session

from app.analytics import service
from app.analytics.events import user_channel
from app.analytics.schemas import Summary, Timeseries
from app.core.auth_client import require_client
from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.models import User, WalletType

# Like the other money routes, every analytics request first asks the api-gateway if it is allowed.
router = APIRouter(prefix="/api/analytics", tags=["analytics"], dependencies=[Depends(require_client)])

DEFAULT_DAYS = 30  # no dates chosen → the last 30 days
MAX_DAYS = {"day": 366, "week": 1100, "month": 1100}  # keeps the charts readable
KEEPALIVE_SECONDS = 15  # the live stream sends a small "still here" line this often


def period_filters(
    start: date | None = Query(None, description="First day, YYYY-MM-DD (default: 30 days before end)"),
    end: date | None = Query(None, description="Last day, YYYY-MM-DD (default: today)"),
    envelope: WalletType | None = Query(None, description="Only this envelope"),
) -> service.Filters:
    """The date range and envelope filter shared by every analytics endpoint."""
    end = end or datetime.now(timezone.utc).date()
    start = start or end - timedelta(days=DEFAULT_DAYS - 1)
    if start > end:
        raise HTTPException(
            status_code=422,
            detail={"code": "bad_range", "message": "The start date must be before the end date."},
        )
    return service.Filters(start=start, end=end, envelope=envelope)


@router.get("/summary", response_model=Summary)
def get_summary(
    current_user: User = Depends(get_current_user),
    filters: service.Filters = Depends(period_filters),
    db: Session = Depends(get_db),
):
    """Totals for the period: number of payments, money received, how much went into each envelope."""
    return service.summary(db, current_user, filters)


@router.get("/timeseries", response_model=Timeseries)
def get_timeseries(
    current_user: User = Depends(get_current_user),
    interval: Literal["day", "week", "month"] = "day",
    filters: service.Filters = Depends(period_filters),
    db: Session = Depends(get_db),
):
    """One point per day, week or month: what the line, bar and pie charts draw."""
    if (filters.end - filters.start).days + 1 > MAX_DAYS[interval]:
        raise HTTPException(
            status_code=422,
            detail={"code": "range_too_long", "message": f"Choose at most {MAX_DAYS[interval]} days for this interval."},
        )
    return service.timeseries(db, current_user, filters, interval)


@router.get("/export")
def export_report(
    current_user: User = Depends(get_current_user),
    file_format: Literal["csv", "pdf"] = Query("csv", alias="format"),
    filters: service.Filters = Depends(period_filters),
    db: Session = Depends(get_db),
):
    """Download the payments of the period and how each one was split: CSV (spreadsheet) or PDF (report)."""
    header, rows = service.report_rows(db, current_user, filters)
    name = f"autowallet-report-{filters.start}-to-{filters.end}.{file_format}"
    if file_format == "pdf":
        totals = service.summary(db, current_user, filters)
        content = service.to_pdf(current_user, filters, totals, header, rows)
        return Response(content, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}"'})
    return Response(
        service.to_csv(header, rows),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def live_events(client: aioredis.Redis, user_id: str):
    """Forward this user's 'payment.processed' events from Redis to the browser, as soon as they happen."""
    pubsub = client.pubsub()
    await pubsub.subscribe(user_channel(user_id))
    try:
        yield sse("ready", {})
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=KEEPALIVE_SECONDS)
            if message is None:
                yield ": keep-alive\n\n"  # a comment line: keeps proxies from closing a quiet connection
                continue
            yield f"event: payment\ndata: {message['data']}\n\n"
    finally:  # the browser left: stop listening
        await pubsub.unsubscribe()
        await pubsub.aclose()
        await client.aclose()


@router.get("/live", responses={200: {"content": {"text/event-stream": {}}}})
async def live_updates(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Server-Sent Events: 'ready' once, then 'payment' each time one of your payments is processed."""
    user_id = current_user.id
    db.close()  # the stream can stay open for hours: give the database connection back now
    client = aioredis.from_url(settings.redis_url, decode_responses=True)
    try:
        await client.ping()
    except redis.RedisError:
        await client.aclose()
        raise HTTPException(
            status_code=503,
            detail={"code": "unavailable", "message": "Live updates are not available right now."},
        )
    return StreamingResponse(
        live_events(client, user_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
