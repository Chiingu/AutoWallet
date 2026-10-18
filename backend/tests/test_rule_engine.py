"""Tests for the rule engine (app/services/rule_engine.py).

Unlike the API tests, these need no client, no database, no fixtures:
apply_rules() is a pure function — money in, allocation dict out.
We test it exactly as the team's excalidraw board specifies it.

Sections:
    1. The board's hand-traced example   (the canonical 8,500 split)
    2. The board's condition table       (true/false branches per example)
    3. Edge cases: payments vs locks     (small payments, zero, negative)
    4. Edge cases: ordering/accumulation (priority sort, same wallet)
    5. Silent-failure documentation      (QA warnings, current behavior)
    6. Remainder handling                (unallocated money lands in main)
"""
import pytest

from app.services.rule_engine import RuleInput, apply_rules


def make_rule(
    name,
    rule_type,
    target_wallet,
    priority,
    fixed_amount=None,
    percentage=None,
    condition_field=None,
    condition_operator=None,
    condition_value=None,
):
    """Build one RuleInput with keyword arguments (same fields as the DB rules)."""
    return RuleInput(
        name=name,
        rule_type=rule_type,
        target_wallet=target_wallet,
        priority=priority,
        fixed_amount=fixed_amount,
        percentage=percentage,
        condition_field=condition_field,
        condition_operator=condition_operator,
        condition_value=condition_value,
    )


def default_rules():
    """The same 4 starter rules every user gets on signup (provisioning.py)."""
    return [
        make_rule("Rent lock", "lock_fixed", "rent", 1, fixed_amount=3500,
                  condition_field="rent_balance", condition_operator="<", condition_value=3500),
        make_rule("Tax", "percentage_remainder", "tax", 2, percentage=15),
        make_rule("Savings (capped)", "percentage_remainder", "savings", 3, percentage=15,
                  condition_field="savings_balance", condition_operator="<", condition_value=10000),
        make_rule("Free to spend", "percentage_remainder", "free", 4, percentage=100),
    ]


EMPTY_BALANCES = {"rent_balance": 0, "savings_balance": 0}


# ---------------------------------------------------------------------------
# 1. THE BOARD'S HAND-TRACED EXAMPLE
# ---------------------------------------------------------------------------


def test_hand_traced_8500_example():
    """SCENARIO:   the board's canonical example — 8,500 payment, default rules.
    EXPECTED:   rent 3500, tax 750, savings 637.5, free 3612.5, and full
                conservation (every unit of the payment accounted for)."""
    allocations = apply_rules(8500, default_rules(), dict(EMPTY_BALANCES))

    assert allocations["rent"] == pytest.approx(3500)
    assert allocations["tax"] == pytest.approx(750)
    assert allocations["savings"] == pytest.approx(637.5)
    assert allocations["free"] == pytest.approx(3612.5)
    assert sum(allocations.values()) == pytest.approx(8500)


# ---------------------------------------------------------------------------
# 2. THE BOARD'S CONDITION TABLE — true and false branches
# ---------------------------------------------------------------------------


def test_condition_true_savings_cap_still_saves():
    """SCENARIO:   board example 1, TRUE branch — savings (5,000) below
                the 10,000 cap.
    EXPECTED:   the savings rule fires normally (637.5 saved)."""
    balances = {"rent_balance": 0, "savings_balance": 5000}
    allocations = apply_rules(8500, default_rules(), balances)

    assert allocations["savings"] == pytest.approx(637.5)


def test_condition_false_savings_cap_flows_onward():
    """SCENARIO:   board example 1, FALSE branch — savings already at cap.
    EXPECTED:   the rule is skipped entirely and its 15% flows onward —
                free-to-spend catches it (4,250). Conservation holds."""
    balances = {"rent_balance": 0, "savings_balance": 10000}
    allocations = apply_rules(8500, default_rules(), balances)

    assert "savings" not in allocations
    assert allocations["free"] == pytest.approx(4250)
    assert sum(allocations.values()) == pytest.approx(8500)


def test_condition_false_rent_already_covered():
    """SCENARIO:   board example 2, FALSE branch — rent envelope already
                holds 3,500.
    EXPECTED:   no double lock (rent skipped); tax takes 15% of the FULL
                8,500 pool (1,275) since nothing was carved off first."""
    balances = {"rent_balance": 3500, "savings_balance": 0}
    allocations = apply_rules(8500, default_rules(), balances)

    assert "rent" not in allocations
    assert allocations["tax"] == pytest.approx(1275)


def test_income_tier_tax_20_when_high_income():
    """SCENARIO:   board example 3 — two tax rules with opposite income-tier
                conditions, paid in that priority order.
    EXPECTED:   20% rule fires above the 15,000 tier; 15% otherwise — and
                only one of them ever allocates (first match wins)."""
    rules = [
        make_rule("Tax high tier", "percentage_remainder", "tax", 2, percentage=20,
                  condition_field="monthly_income", condition_operator=">", condition_value=15000),
        make_rule("Tax normal", "percentage_remainder", "tax", 3, percentage=15,
                  condition_field="monthly_income", condition_operator="<=", condition_value=15000),
        make_rule("Free", "percentage_remainder", "free", 9, percentage=100),
    ]

    high = apply_rules(10000, rules, {"monthly_income": 20000})
    assert high["tax"] == pytest.approx(2000)

    low = apply_rules(10000, rules, {"monthly_income": 12000})
    assert low["tax"] == pytest.approx(1500)


def test_emergency_override_skips_tax_and_savings():
    """SCENARIO:   board example 4 — emergency override: tax and savings
                only fire while main_balance >= 500.
    EXPECTED:   a nearly-broken main wallet (300) skips both rules — all
                spare money goes to free-to-spend; a healthy wallet (1000)
                saves and taxes normally."""
    rules = [
        make_rule("Rent", "lock_fixed", "rent", 1, fixed_amount=3500,
                  condition_field="rent_balance", condition_operator="<", condition_value=3500),
        make_rule("Tax", "percentage_remainder", "tax", 2, percentage=15,
                  condition_field="main_balance", condition_operator=">=", condition_value=500),
        make_rule("Savings", "percentage_remainder", "savings", 3, percentage=15,
                  condition_field="main_balance", condition_operator=">=", condition_value=500),
        make_rule("Free", "percentage_remainder", "free", 4, percentage=100),
    ]

    broke = apply_rules(8500, rules, {"rent_balance": 0, "main_balance": 300})
    assert "tax" not in broke
    assert "savings" not in broke
    assert broke["free"] == pytest.approx(5000)

    healthy = apply_rules(8500, rules, {"rent_balance": 0, "main_balance": 1000})
    assert healthy["tax"] == pytest.approx(750)


def test_first_payment_bonus_rule():
    """SCENARIO:   board example 5 — a one-time bonus rule firing only when
                is_first_payment == 1.
    EXPECTED:   the 500 bonus lands on the first payment and never again."""
    rules = [
        make_rule("First payment bonus", "lock_fixed", "savings", 1, fixed_amount=500,
                  condition_field="is_first_payment", condition_operator="==", condition_value=1),
        make_rule("Tax", "percentage_remainder", "tax", 2, percentage=15),
        make_rule("Free", "percentage_remainder", "free", 3, percentage=100),
    ]

    first = apply_rules(10000, rules, {"is_first_payment": 1})
    assert first["savings"] == pytest.approx(500)

    later = apply_rules(10000, rules, {"is_first_payment": 0})
    assert "savings" not in later


# ---------------------------------------------------------------------------
# 3. EDGE CASES — payments vs fixed locks
# ---------------------------------------------------------------------------


def test_payment_smaller_than_rent_lock():
    """SCENARIO:   only 2,000 arrives but the rent lock wants 3,500.
    EXPECTED:   rent takes what exists, nothing crashes, the pool is
                honestly empty afterwards."""
    allocations = apply_rules(2000, default_rules(), dict(EMPTY_BALANCES))
    assert allocations == pytest.approx({"rent": 2000})


def test_zero_amount_allocates_nothing():
    """SCENARIO:   a 0-amount payment reaches the engine.
    EXPECTED:   empty allocation — nothing to split."""
    assert apply_rules(0, default_rules(), dict(EMPTY_BALANCES)) == {}


def test_negative_amount_allocates_nothing():
    """SCENARIO:   a negative amount reaches the engine. The API already
                rejects negatives with 422 — this is defense in depth in
                case the engine is ever called from another path
                (e.g. the webhook).
    EXPECTED:   empty allocation, no crash."""
    assert apply_rules(-100, default_rules(), dict(EMPTY_BALANCES)) == {}


# ---------------------------------------------------------------------------
# 4. EDGE CASES — ordering and accumulation
# ---------------------------------------------------------------------------


def test_priority_order_determines_who_gets_paid_first():
    """SCENARIO:   rules passed OUT of order on purpose — the engine must
                sort by priority itself (lower number = paid first).
    EXPECTED:   whichever rule sorts first drains the pool, and the second
                one gets only the remainder."""
    a_first = [
        make_rule("A", "lock_fixed", "rent", 1, fixed_amount=1000),
        make_rule("B", "lock_fixed", "savings", 2, fixed_amount=3000),
    ]
    assert apply_rules(3500, a_first, {}) == pytest.approx({"rent": 1000, "savings": 2500})

    b_first = [
        make_rule("A", "lock_fixed", "rent", 2, fixed_amount=1000),
        make_rule("B", "lock_fixed", "savings", 1, fixed_amount=3000),
    ]
    assert apply_rules(3500, b_first, {}) == pytest.approx({"rent": 500, "savings": 3000})


def test_rules_targeting_same_wallet_accumulate():
    """SCENARIO:   two independent rules both targeting the rent wallet.
    EXPECTED:   their allocations accumulate (1000 + 1000 = 2000 into
                rent; the rest falls through to main)."""
    rules = [
        make_rule("Rent part 1", "lock_fixed", "rent", 1, fixed_amount=1000),
        make_rule("Rent part 2", "lock_fixed", "rent", 2, fixed_amount=1000),
    ]
    assert apply_rules(5000, rules, {}) == pytest.approx({"rent": 2000, "main": 3000})


# ---------------------------------------------------------------------------
# 5. SILENT-FAILURE DOCUMENTATION — QA warnings, current behavior
# ---------------------------------------------------------------------------


def test_unknown_condition_field_silently_skips_rule():
    """QA WARNING — SCENARIO:  a typo in condition_field ("savingz" vs
    "savings").
    EXPECTED (today): the rule vanishes SILENTLY — no error, no allocation.
    Reported to the team; this test documents the current behavior so any
    change is noticed."""
    rules = [
        make_rule("Savings", "percentage_remainder", "savings", 1, percentage=15,
                  condition_field="savingz_balance",  # typo!
                  condition_operator="<", condition_value=10000),
        make_rule("Free", "percentage_remainder", "free", 2, percentage=100),
    ]
    allocations = apply_rules(1000, rules, {"savings_balance": 0})
    assert "savings" not in allocations
    assert allocations["free"] == pytest.approx(1000)


def test_unknown_condition_operator_silently_skips_rule():
    """QA WARNING — SCENARIO:  an operator outside <, <=, >, >=, == (here !=).
    EXPECTED (today): the operator is ignored silently instead of raising
    an error."""
    rules = [
        make_rule("Savings", "percentage_remainder", "savings", 1, percentage=15,
                  condition_field="savings_balance", condition_operator="!=",
                  condition_value=10000),
        make_rule("Free", "percentage_remainder", "free", 2, percentage=100),
    ]
    allocations = apply_rules(1000, rules, {"savings_balance": 0})
    assert "savings" not in allocations


def test_malformed_rule_values_take_nothing_without_crashing():
    """SCENARIO:   a lock_fixed rule whose fixed_amount is None (malformed).
    EXPECTED:   no crash; the broken rule takes nothing (0.0), the pool
                flows on to the next rules."""
    rules = [
        make_rule("Broken lock", "lock_fixed", "rent", 1, fixed_amount=None),
        make_rule("Free", "percentage_remainder", "free", 2, percentage=100),
    ]
    allocations = apply_rules(1000, rules, {})
    assert allocations == pytest.approx({"rent": 0.0, "free": 1000.0})


# ---------------------------------------------------------------------------
# 6. REMAINDER HANDLING — was the xfail-tracked design gap
# ---------------------------------------------------------------------------


def test_unallocated_remainder_goes_to_main_wallet():
    """SCENARIO:   money not covered by any rule (850 leftover from a 15%
                tax rule on 1,000).
    EXPECTED:   it lands in the main wallet — never disappears. Tracked as
                an xfail until PR #7 (fix/rule_engine) landed; marker
                removed once the fix was verified."""
    rules = [make_rule("Tax", "percentage_remainder", "tax", 1, percentage=15)]
    allocations = apply_rules(1000, rules, {})

    assert allocations["main"] == pytest.approx(850)
    assert sum(allocations.values()) == pytest.approx(1000)
