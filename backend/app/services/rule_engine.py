from dataclasses import dataclass


@dataclass
class RuleInput:
    """A plain description of one rule - no database, no ORM, just data."""
    name: str
    rule_type: str          # "lock_fixed" or "percentage_remainder"
    target_wallet: str
    priority: int
    fixed_amount: float | None = None
    percentage: float | None = None
    condition_field: str | None = None
    condition_operator: str | None = None
    condition_value: float | None = None


# THE TRANSLATOR
_OPERATORS = {
    "<": lambda a, b: a < b,
    "<=": lambda a, b: a <= b,
    ">": lambda a, b: a > b,
    ">=": lambda a, b: a >= b,
    "==": lambda a, b: a == b,
}


def _condition_met(rule: RuleInput, wallet_balances: dict[str, float]) -> bool:
    if rule.condition_field is None:
        return True  # no condition means always run

    current_value = wallet_balances.get(rule.condition_field)
    if current_value is None:
        return False  # can't check a condition we have no data for - skip to be safe

    op = _OPERATORS.get(rule.condition_operator)
    if op is None:
        return False

    return op(current_value, rule.condition_value)

def apply_rules(amount: float, rules: list[RuleInput], wallet_balances: dict[str, float]) -> dict[str, float]:
    """
    Splits `amount` across rules, in priority order (lowest number runs first).
    Returns {target_wallet: amount_allocated}. Pure function - no DB, easy to test.
    """
    pool = amount
    allocations: dict[str, float] = {}

    for rule in sorted(rules, key=lambda r: r.priority):
        if pool <= 0:
            break
        if not _condition_met(rule, wallet_balances):
            continue

        if rule.rule_type == "lock_fixed":
            take = min(rule.fixed_amount or 0.0, pool)
        else:  # percentage_remainder
            take = pool * ((rule.percentage or 0.0) / 100)

            # Self-capping rule: if this rule's own condition checks its own
            # target wallet against a "<" threshold, never take more than
            # what's left under that cap.
            own_balance_field = f"{rule.target_wallet}_balance"
            if rule.condition_field == own_balance_field and rule.condition_operator in ("<", "<="):
                current = wallet_balances.get(own_balance_field, 0.0)
                room_left = max(0.0, rule.condition_value - current)
                take = min(take, room_left)

        allocations[rule.target_wallet] = allocations.get(rule.target_wallet, 0.0) + take
        pool -= take
    if pool > 0:
        allocations["main"] = allocations.get("main", 0.0) + pool

    return allocations