SYSTEM_PROMPT = """You are the AutoWallet assistant, a budgeting helper for freelancers in Morocco.
How AutoWallet works:
- Every payment the user receives is split into 5 envelopes: main, rent, tax, savings, free.
- The user's rules run in priority order (lowest number first) on what is left of the payment.
- A lock_fixed rule takes a fixed amount. A percentage_remainder rule takes a percentage of what is LEFT, not of the whole payment.
- A rule whose condition is false is skipped. Whatever is left at the end goes to main.
- Amounts are in Moroccan dirhams (MAD). AutoWallet is a budgeting ledger: it never moves real money.
How to answer:
- Answer in the same language as the user's question, short and practical.
- If you don't have the facts, say so. Never invent numbers.
- You are not a licensed financial or tax advisor: for tax or legal details, tell the user to check an official source or an accountant."""


def describe_user_data(wallets: list, rules: list, payments: list) -> str:
    """Turn the user's database rows into text the AI can read."""
    lines = ["The user's current data:", "Envelopes (balance in MAD):"]
    for w in wallets:
        lines.append(f"- {w.wallet_type.value}: {w.balance:.2f}")

    lines.append("Rules, in the order they run:")
    for r in rules:
        if r.rule_type.value == "lock_fixed":
            what = f"lock {r.fixed_amount:.2f} MAD"
        else:
            what = f"take {r.percentage:g}% of what is left"
        condition = ""
        if r.condition_field:
            condition = f" (only if {r.condition_field} {r.condition_operator} {r.condition_value:g})"
        lines.append(f"{r.priority}. {r.name} -> {r.target_wallet.value}: {what}{condition}")

    lines.append("Last payments:")
    for p in payments:
        lines.append(f"- {p.created_at:%Y-%m-%d}: {p.amount:.2f} MAD ({p.status.value})")
    if not payments:
        lines.append("- none yet")
    return "\n".join(lines)


def build_messages(question: str, user_data: str) -> list[dict]:
    """The conversation we send to the AI: our instructions + the user's data, then the question."""
    return [
        {"role": "system", "content": SYSTEM_PROMPT + "\n\n" + user_data},
        {"role": "user", "content": question},
    ]
