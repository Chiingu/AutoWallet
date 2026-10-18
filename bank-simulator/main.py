from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="AutoWallet Bank Simulator")

# In-memorydd only - resets every restart. That's fine, it's a fake bank.
accounts: dict[str, dict] = {}


class InjectPayment(BaseModel):
    account_id: str
    reference: str
    amount: float = Field(gt=0)


@app.post("/simulator/inject")
def inject_payment(payload: InjectPayment):
    account = accounts.setdefault(payload.account_id, {"balance": 0.0, "transactions": []})

    if any(t["reference"] == payload.reference for t in account["transactions"]):
        raise HTTPException(status_code=400, detail="This reference was already injected")

    account["balance"] += payload.amount
    account["transactions"].append({"reference": payload.reference, "amount": payload.amount})
    return {"account_id": payload.account_id, "new_balance": account["balance"]}


@app.get("/simulator/accounts/{account_id}")
def get_account(account_id: str):
    if account_id not in accounts:
        raise HTTPException(status_code=404, detail="No such account")
    return accounts[account_id]