import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.ai.prompt import build_messages, describe_user_data
from app.ai.provider import AIError, ask_llm, check_configured, stream_llm
from app.ai.rate_limit import ai_rate_limit
from app.ai.schemas import ChatRequest, ChatResponse
from app.core.auth_client import require_client
from app.core.database import get_db
from app.core.deps import require_linked_account
from app.models.models import Rule, Transaction, User, Wallet

# Like the other money routes, every AI request first asks the api-gateway if it is allowed.
router = APIRouter(prefix="/api/ai", tags=["ai"], dependencies=[Depends(require_client)])


def load_user_data(current_user: User = Depends(require_linked_account), db: Session = Depends(get_db)) -> str:
    """Read the user's envelopes, active rules and last 5 payments, as text for the AI."""
    wallets = db.query(Wallet).filter(Wallet.user_id == current_user.id).all()
    rules = (
        db.query(Rule)
        .filter(Rule.user_id == current_user.id, Rule.is_active == True)  # noqa: E712
        .order_by(Rule.priority)
        .all()
    )
    payments = (
        db.query(Transaction)
        .filter(Transaction.user_id == current_user.id)
        .order_by(Transaction.created_at.desc())
        .limit(5)
        .all()
    )
    user_data = describe_user_data(wallets, rules, payments)
    db.close()  # an answer can stream for a minute: give the database connection back now
    return user_data


@router.post("/chat", response_model=ChatResponse, dependencies=[Depends(ai_rate_limit)])
async def chat(payload: ChatRequest, user_data: str = Depends(load_user_data)):
    # Ask Gemini with our instructions + this user's data, and send its answer back
    try:
        answer = await ask_llm(build_messages(payload.message, user_data))
    except AIError as err:
        # Turn the provider problem into a clear HTTP error for the browser
        raise HTTPException(status_code=err.status, detail={"code": err.code, "message": err.message})
    return ChatResponse(answer=answer)


def sse(event: str, data: dict) -> str:
    """One Server-Sent Event: a name, the data as JSON, then an empty line."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def answer_events(messages: list[dict]):
    """The answer as events: token, token, ... then done (or error if it breaks)."""
    try:
        async for piece in stream_llm(messages):
            yield sse("token", {"text": piece})
    except AIError as err:
        yield sse("error", {"code": err.code, "message": err.message})
        return
    yield sse("done", {})


@router.post("/chat/stream", dependencies=[Depends(ai_rate_limit)])
async def chat_stream(payload: ChatRequest, user_data: str = Depends(load_user_data)):
    """Same question as /chat, but the answer arrives piece by piece (Server-Sent Events)."""
    try:
        check_configured()
    except AIError as err:
        raise HTTPException(status_code=err.status, detail={"code": err.code, "message": err.message})
    messages = build_messages(payload.message, user_data)
    return StreamingResponse(
        answer_events(messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
