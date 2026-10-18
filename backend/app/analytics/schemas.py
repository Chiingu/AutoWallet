from datetime import date

from pydantic import BaseModel


class Summary(BaseModel):
    """Totals for the chosen period."""
    start: date
    end: date
    envelope: str | None
    payments: int
    received: float
    average_payment: float
    largest_payment: float
    by_envelope: dict[str, float]  # how much went into each envelope during the period
    balances: dict[str, float]  # the envelope balances right now


class TimeseriesPoint(BaseModel):
    period: str  # "2026-10-08", "2026-W41" or "2026-10"
    received: float
    envelopes: dict[str, float]


class Timeseries(BaseModel):
    """One point per day, week or month: what the charts draw."""
    start: date
    end: date
    interval: str
    envelope: str | None
    points: list[TimeseriesPoint]
