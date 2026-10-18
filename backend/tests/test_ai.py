"""The AI assistant (app/ai) — chat endpoint, provider contract, rate limit.

What this suite pins:
  RATE LIMIT   sliding window in Redis (zset, atomic pipeline): questions
               under the limit pass, the next one gets 429 + Retry-After,
               refused questions don't count, Redis-down fails OPEN.
  PROMPT       the system message carries our instructions + THIS user's
               live data; the question rides in the user message.
  VALIDATION   login + linked account required; blank / oversized / empty
               messages rejected before anything is sent.
  PROVIDER     every provider failure maps to a clean status (503 busy,
               502 rejected, 503 unreachable, 504 timeout); 503
               not-configured when no API key; the answer text passes
               through verbatim; streaming answers arrive as SSE events.
  FINDING      an xfail-strict acceptance test keeps the missing gateway
               hop (finding #15) visible until it is fixed.
"""
import httpx
import pytest
import redis

from app.ai.prompt import SYSTEM_PROMPT, build_messages, describe_user_data
from app.ai.rate_limit import check_rate_limit
from app.core.config import settings
from app.core.security import create_access_token
from app.models.models import Rule, Wallet
from tests.helpers import make_user

CHAT = "/api/ai/chat"
STREAM = "/api/ai/chat/stream"
PROVIDER_ANSWER = {"choices": [{"message": {"content": "Save more."}}]}


# ---------------------------------------------------------------------------
# Rate limit — the sliding window, unit level
# ---------------------------------------------------------------------------

def test_questions_under_the_limit_are_allowed(monkeypatch):
    # SCENARIO: the limit is 3 and the user asks 3 questions in one minute.
    # EXPECTED: all 3 pass, with no wait.
    monkeypatch.setattr(settings, "ai_rate_limit_per_minute", 3)
    for _ in range(3):
        allowed, wait = check_rate_limit("qa-user")
        assert allowed
        assert wait == 0


def test_question_over_the_limit_is_refused_with_a_wait(monkeypatch):
    # SCENARIO: the limit is 3 and a 4th question arrives inside the window.
    # EXPECTED: refused, with a sane wait (between 1 and the window + 1).
    monkeypatch.setattr(settings, "ai_rate_limit_per_minute", 3)
    for _ in range(3):
        check_rate_limit("qa-user")
    allowed, wait = check_rate_limit("qa-user")
    assert not allowed
    assert 1 <= wait <= 61


def test_refused_questions_do_not_count(monkeypatch, fake_redis):
    # SCENARIO: the limit is 3, the user hits it, then keeps trying.
    # EXPECTED: the window stays at 3 members — a refused question is
    #           removed, so it never blocks a later one longer than it must.
    monkeypatch.setattr(settings, "ai_rate_limit_per_minute", 3)
    for _ in range(3):
        check_rate_limit("qa-user")
    check_rate_limit("qa-user")  # refused — must not grow the window
    assert fake_redis.zcard("ai:ratelimit:qa-user") == 3


def test_the_rate_limit_key_expires(monkeypatch, fake_redis):
    # SCENARIO: a user asks one question then stays quiet.
    # EXPECTED: Redis holds the key with a TTL inside the 60s window —
    #           quiet users don't accumulate keys forever.
    monkeypatch.setattr(settings, "ai_rate_limit_per_minute", 3)
    check_rate_limit("qa-user")
    assert 0 < fake_redis.ttl("ai:ratelimit:qa-user") <= 60


def test_rate_limit_fails_open_when_redis_is_down(
    client, auth_headers, ai_provider, monkeypatch
):
    # SCENARIO: Redis is unreachable and the user asks a question.
    # EXPECTED: the documented choice — fail OPEN: the question goes
    #           through to the provider (a warning is logged), the app
    #           never blocks on its rate limiter being down.
    class RedisDown:
        def __getattr__(self, name):
            raise redis.RedisError("redis is down")

    monkeypatch.setattr("app.ai.rate_limit.redis_client", RedisDown())
    ai_provider.respond(json=PROVIDER_ANSWER)

    resp = client.post(CHAT, headers=auth_headers, json={"message": "hi"})
    assert resp.status_code == 200
    assert resp.json()["answer"] == "Save more."


# ---------------------------------------------------------------------------
# The prompt — instructions + the user's live data
# ---------------------------------------------------------------------------

def test_prompt_carries_instructions_user_data_and_question(db_session, test_user):
    # SCENARIO: a signed-in user with provisioned wallets asks a question.
    # EXPECTED: two messages — system (our instructions + THIS user's
    #           balances/rules/no-payments) and user (the question).
    wallets = db_session.query(Wallet).filter(Wallet.user_id == test_user.id).all()
    rules = db_session.query(Rule).filter(Rule.user_id == test_user.id).all()
    user_data = describe_user_data(wallets, rules, [])

    assert "- main: 0.00" in user_data
    assert "Rules, in the order they run:" in user_data
    assert "- none yet" in user_data  # no payments yet

    messages = build_messages("How much can I spend?", user_data)
    assert messages[0]["role"] == "system"
    assert SYSTEM_PROMPT in messages[0]["content"]
    assert user_data in messages[0]["content"]
    assert messages[1] == {"role": "user", "content": "How much can I spend?"}


def test_prompt_never_leaks_credentials(db_session, test_user):
    # SCENARIO: the prompt is built from the user's rows.
    # EXPECTED: no password hash, no 2FA secret, no email — the LLM gets
    #           balances, rules and payments only (the privacy page's
    #           promise, pinned).
    wallets = db_session.query(Wallet).filter(Wallet.user_id == test_user.id).all()
    rules = db_session.query(Rule).filter(Rule.user_id == test_user.id).all()
    user_data = describe_user_data(wallets, rules, [])
    system = build_messages("q", user_data)[0]["content"]

    assert test_user.hashed_password not in system
    assert test_user.email not in system
    assert "hashed_password" not in system


# ---------------------------------------------------------------------------
# Doors — login, linked account, input validation
# ---------------------------------------------------------------------------

def test_ai_chat_requires_login(client):
    # SCENARIO: anonymous POST to the chat endpoint.
    # EXPECTED: 401, no provider call (short-circuit before anything).
    resp = client.post(CHAT, json={"message": "hi"})
    assert resp.status_code == 401


def test_ai_requires_a_linked_bank_account(client, db_session):
    # SCENARIO: an OAuth-style user with no bank account linked.
    # EXPECTED: 403, same gate as the money endpoints.
    user_id = make_user(db_session, "ai-unlinked@autowallet.dev", bank_account_id=None)
    token = create_access_token(user_id=user_id, role="user")
    resp = client.post(CHAT, headers={"Authorization": f"Bearer {token}"},
                       json={"message": "hi"})
    assert resp.status_code == 403


def test_blank_message_is_rejected(client, auth_headers):
    # SCENARIO: whitespace-only question.
    # EXPECTED: 422 before any provider call (the strip validator).
    resp = client.post(CHAT, headers=auth_headers, json={"message": "   "})
    assert resp.status_code == 422


def test_oversized_message_is_rejected(client, auth_headers):
    # SCENARIO: a 2001-character question (limit is 2000).
    # EXPECTED: 422 — the prompt can't be stuffed with a small book.
    resp = client.post(CHAT, headers=auth_headers, json={"message": "x" * 2001})
    assert resp.status_code == 422


def test_missing_key_answers_not_configured(client, auth_headers, monkeypatch):
    # SCENARIO: no AI_API_KEY configured on the server.
    # EXPECTED: a clean 503 not_configured — never a crash, never a
    #           leaked provider request.
    monkeypatch.setattr(settings, "ai_api_key", "")
    resp = client.post(CHAT, headers=auth_headers, json={"message": "hi"})
    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "not_configured"


# ---------------------------------------------------------------------------
# Provider contract — failures mapped to clean statuses, answers verbatim
# ---------------------------------------------------------------------------

def test_chat_returns_the_provider_answer(client, auth_headers, ai_provider):
    # SCENARIO: provider answers 200 with a normal completion.
    # EXPECTED: 200, the answer text verbatim.
    ai_provider.respond(json=PROVIDER_ANSWER)
    resp = client.post(CHAT, headers=auth_headers, json={"message": "hi"})
    assert resp.status_code == 200
    assert resp.json() == {"answer": "Save more."}


def test_provider_busy_maps_to_503(client, auth_headers, ai_provider):
    # SCENARIO: provider answers 500 (or 429).
    # EXPECTED: 503 busy — the user is told to retry, not blamed.
    ai_provider.respond(status_code=500, json={"error": "boom"})
    resp = client.post(CHAT, headers=auth_headers, json={"message": "hi"})
    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "busy"


def test_provider_rejected_maps_to_502(client, auth_headers, ai_provider):
    # SCENARIO: provider answers 401 (bad key) or 400/403.
    # EXPECTED: 502 rejected — a server-side config problem, surfaced.
    ai_provider.respond(status_code=401, json={"error": "bad key"})
    resp = client.post(CHAT, headers=auth_headers, json={"message": "hi"})
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "rejected"


def test_provider_unreachable_maps_to_503(client, auth_headers, ai_provider):
    # SCENARIO: the provider host doesn't resolve / connection refused.
    # EXPECTED: 503 unreachable.
    ai_provider.side_effect = httpx.ConnectError("[Errno 111] refused")
    resp = client.post(CHAT, headers=auth_headers, json={"message": "hi"})
    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "unreachable"


def test_provider_timeout_maps_to_504(client, auth_headers, ai_provider):
    # SCENARIO: the provider hangs past the 60s timeout.
    # EXPECTED: 504 timeout — distinct from unreachable.
    ai_provider.side_effect = httpx.ConnectTimeout("too slow")
    resp = client.post(CHAT, headers=auth_headers, json={"message": "hi"})
    assert resp.status_code == 504
    assert resp.json()["detail"]["code"] == "timeout"


def test_rate_limit_blocks_the_route_after_the_limit(
    client, auth_headers, ai_provider, monkeypatch
):
    # SCENARIO: limit 2; the third question inside the minute.
    # EXPECTED: 429 with a Retry-After header, and the provider was
    #           called exactly twice — the refusal happens before the hop.
    monkeypatch.setattr(settings, "ai_rate_limit_per_minute", 2)
    ai_provider.respond(json=PROVIDER_ANSWER)

    assert client.post(CHAT, headers=auth_headers, json={"message": "1"}).status_code == 200
    assert client.post(CHAT, headers=auth_headers, json={"message": "2"}).status_code == 200
    resp = client.post(CHAT, headers=auth_headers, json={"message": "3"})
    assert resp.status_code == 429
    assert resp.headers["Retry-After"].isdigit()
    assert ai_provider.call_count == 2


# ---------------------------------------------------------------------------
# Streaming — Server-Sent Events
# ---------------------------------------------------------------------------

def test_stream_emits_token_events_then_done(client, auth_headers, ai_provider):
    # SCENARIO: provider streams two pieces then [DONE].
    # EXPECTED: an SSE body: token events carrying each piece verbatim,
    #           then a done event; content-type text/event-stream.
    ai_provider.respond(
        status_code=200,
        content=(
            b'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
            b'data: {"choices":[{"delta":{"content":" there"}}]}\n\n'
            b"data: [DONE]\n\n"
        ),
    )
    resp = client.post(STREAM, headers=auth_headers, json={"message": "hi"})
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert resp.text.count("event: token") == 2
    assert '"Hello"' in resp.text
    assert '" there"' in resp.text
    assert resp.text.rstrip().endswith("event: done\ndata: {}")


def test_stream_maps_provider_failure_to_an_error_event(client, auth_headers, ai_provider):
    # SCENARIO: the provider dies mid-stream.
    # EXPECTED: the stream answers with an error EVENT (not a crash, not a
    #           hanging connection) — the browser can show the message.
    ai_provider.respond(status_code=500, json={"error": "boom"})
    resp = client.post(STREAM, headers=auth_headers, json={"message": "hi"})
    assert resp.status_code == 200  # the stream itself opened fine
    assert "event: error" in resp.text
    assert "busy" in resp.text


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Acceptance — the gateway hop (plain pin)
#
# History: filed as finding #15 (owner: MTARZA) and carried as an
# xfail-strict tripwire until the fix landed — `app/ai/router.py:17` now
# creates the router with dependencies=[Depends(require_client)] like every
# other business router — then converted to this pin (PR #52 refresh).
# ---------------------------------------------------------------------------

def test_ai_routes_go_through_the_gateway_authorization_hop(
    client, auth_headers, authorization_service, monkeypatch
):
    # SCENARIO: a signed-in user asks a question; no key configured.
    # EXPECTED (post-fix): the request crosses the gateway hop first
    #           (the seam records exactly one /api/authorize call),
    #           THEN answers 503 not_configured.
    monkeypatch.setattr(settings, "ai_api_key", "")
    resp = client.post(CHAT, headers=auth_headers, json={"message": "hi"})
    assert len(authorization_service.calls) == 1
    assert resp.status_code == 503
