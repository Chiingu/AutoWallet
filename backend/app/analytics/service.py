"""The calculations behind the analytics dashboard: which payments, how they were split, totals per period."""
import csv
import io
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Literal

from fpdf import FPDF
from sqlalchemy.orm import Session

from app.models.models import Allocation, Transaction, TransactionStatus, User, Wallet, WalletType

ENVELOPES = [w.value for w in WalletType]  # main, rent, tax, savings, free
Interval = Literal["day", "week", "month"]


@dataclass
class Filters:
    """What the user chose on the dashboard: a date range and, optionally, one envelope."""
    start: date
    end: date
    envelope: WalletType | None = None

    def envelopes(self) -> list[str]:
        return [self.envelope.value] if self.envelope else ENVELOPES


def payments_in_range(db: Session, user: User, filters: Filters) -> list[Transaction]:
    """The user's processed payments between start and end (both days included), oldest first."""
    since = datetime.combine(filters.start, time.min)
    until = datetime.combine(filters.end + timedelta(days=1), time.min)
    return (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user.id,
            Transaction.status == TransactionStatus.processed,
            Transaction.created_at >= since,
            Transaction.created_at < until,
        )
        .order_by(Transaction.created_at)
        .all()
    )


def splits_of(db: Session, payments: list[Transaction]) -> dict[str, dict[str, float]]:
    """For each payment id: how much went into each envelope (from the allocations table)."""
    splits: dict[str, dict[str, float]] = defaultdict(dict)
    if not payments:
        return splits
    rows = db.query(Allocation).filter(Allocation.transaction_id.in_([p.id for p in payments])).all()
    for row in rows:
        splits[row.transaction_id][row.wallet_type.value] = row.amount
    return splits


def matching_payments(db: Session, user: User, filters: Filters) -> tuple[list[Transaction], dict[str, dict[str, float]]]:
    """The payments of the period and their splits. With an envelope filter: only the payments that fed that envelope."""
    payments = payments_in_range(db, user, filters)
    splits = splits_of(db, payments)
    if filters.envelope:
        payments = [p for p in payments if splits[p.id].get(filters.envelope.value, 0.0) > 0]
    return payments, splits


def summary(db: Session, user: User, filters: Filters) -> dict:
    """Totals for the period: how much arrived, and how much went into each envelope."""
    payments, splits = matching_payments(db, user, filters)
    envelopes = filters.envelopes()

    by_envelope = {e: 0.0 for e in envelopes}
    for payment in payments:
        for envelope, amount in splits[payment.id].items():
            if envelope in by_envelope:
                by_envelope[envelope] += amount

    amounts = [p.amount for p in payments]
    balances = {
        w.wallet_type.value: round(w.balance, 2)
        for w in db.query(Wallet).filter(Wallet.user_id == user.id).all()
        if w.wallet_type.value in envelopes
    }
    return {
        "start": filters.start,
        "end": filters.end,
        "envelope": filters.envelope.value if filters.envelope else None,
        "payments": len(payments),
        "received": round(sum(amounts), 2),
        "average_payment": round(sum(amounts) / len(amounts), 2) if amounts else 0.0,
        "largest_payment": round(max(amounts), 2) if amounts else 0.0,
        "by_envelope": {e: round(v, 2) for e, v in by_envelope.items()},
        "balances": balances,
    }


def period_key(day: date, interval: Interval) -> str:
    """The label of the period a day belongs to: 2026-10-08, 2026-W41 or 2026-10."""
    if interval == "day":
        return day.isoformat()
    if interval == "week":
        year, week, _ = day.isocalendar()
        return f"{year}-W{week:02d}"
    return f"{day.year}-{day.month:02d}"


def timeseries(db: Session, user: User, filters: Filters, interval: Interval) -> dict:
    """One point per day/week/month (empty periods included as 0), for the charts."""
    envelopes = filters.envelopes()
    points: dict[str, dict] = {}
    day = filters.start
    while day <= filters.end:
        key = period_key(day, interval)
        points.setdefault(key, {"period": key, "received": 0.0, "envelopes": {e: 0.0 for e in envelopes}})
        day += timedelta(days=1)

    payments, splits = matching_payments(db, user, filters)
    for payment in payments:
        point = points[period_key(payment.created_at.date(), interval)]
        point["received"] += payment.amount
        for envelope, amount in splits[payment.id].items():
            if envelope in point["envelopes"]:
                point["envelopes"][envelope] += amount

    for point in points.values():
        point["received"] = round(point["received"], 2)
        point["envelopes"] = {e: round(v, 2) for e, v in point["envelopes"].items()}
    return {
        "start": filters.start,
        "end": filters.end,
        "interval": interval,
        "envelope": filters.envelope.value if filters.envelope else None,
        "points": list(points.values()),
    }


def report_rows(db: Session, user: User, filters: Filters) -> tuple[list[str], list[list]]:
    """The payments of the period as table rows: date, reference, amount, then one column per envelope."""
    payments, splits = matching_payments(db, user, filters)
    envelopes = filters.envelopes()
    header = ["date", "reference", "amount", *envelopes]
    rows = [
        [
            p.created_at.strftime("%Y-%m-%d %H:%M"),
            p.reference,
            round(p.amount, 2),
            *[round(splits[p.id].get(e, 0.0), 2) for e in envelopes],
        ]
        for p in payments
    ]
    return header, rows


def to_csv(header: list[str], rows: list[list]) -> str:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(header)
    writer.writerows(rows)
    return out.getvalue()


def _latin1(text) -> str:
    """The built-in PDF fonts only know Latin-1: replace anything else instead of crashing."""
    return str(text).encode("latin-1", "replace").decode("latin-1")


def to_pdf(user: User, filters: Filters, totals: dict, header: list[str], rows: list[list]) -> bytes:
    """A one-file report: the period, the totals, then every payment and its split."""
    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_title("AutoWallet report")
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(0, 10, "AutoWallet report", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", size=11)
    envelope = f"  -  envelope: {filters.envelope.value}" if filters.envelope else ""
    pdf.cell(0, 7, _latin1(f"{user.email}  -  from {filters.start} to {filters.end}{envelope}"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Totals", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", size=11)
    pdf.cell(0, 6, f"Payments: {totals['payments']}   -   Received: {totals['received']:,.2f} MAD   -   "
                   f"Average: {totals['average_payment']:,.2f} MAD", new_x="LMARGIN", new_y="NEXT")
    split = "   -   ".join(f"{e}: {v:,.2f} MAD" for e, v in totals["by_envelope"].items())
    pdf.cell(0, 6, _latin1(f"Split: {split}"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Payments", new_x="LMARGIN", new_y="NEXT")
    if not rows:
        pdf.set_font("Helvetica", size=11)
        pdf.cell(0, 6, "No payments in this period.", new_x="LMARGIN", new_y="NEXT")
    else:
        pdf.set_font("Helvetica", size=9)
        with pdf.table(text_align="LEFT") as table:
            table.row([_latin1(h) for h in header])
            for row in rows:
                table.row([_latin1(f"{v:,.2f}" if isinstance(v, float) else v) for v in row])
    return bytes(pdf.output())
