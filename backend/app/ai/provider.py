import json
import logging
from collections.abc import AsyncIterator

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class AIError(Exception):
    """The AI provider failed. `message` is safe to show to the user."""

    def __init__(self, code: str, message: str, status: int):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def check_configured() -> None:
    """Stop early (503) when no API key is set, before calling the provider."""
    if not settings.ai_api_key:
        raise AIError("not_configured", "The AI assistant is not configured on this server.", 503)


def _error_for(response: httpx.Response) -> AIError:
    """Turn the provider's error answer into an AIError, and log the real reason for us."""
    logger.warning("AI provider answered %s: %s", response.status_code, response.text[:300])
    if response.status_code in (400, 401, 403):
        return AIError("rejected", "The AI service refused our request. Check the API key and the model.", 502)
    if response.status_code == 429 or response.status_code >= 500:
        return AIError("busy", "The AI service is busy right now. Please try again in a minute.", 503)
    return AIError("error", f"The AI service answered with an error ({response.status_code}).", 502)


def _request(messages: list[dict], stream: bool) -> tuple[str, dict, dict]:
    """Address, headers and body of one chat request to the provider."""
    url = f"{settings.ai_base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {settings.ai_api_key}"}
    body = {"model": settings.ai_model, "messages": messages, "stream": stream}
    return url, headers, body


async def ask_llm(messages: list[dict]) -> str:
    """Send the conversation to the AI provider and return the whole answer text."""
    check_configured()
    url, headers, body = _request(messages, stream=False)
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(url, headers=headers, json=body)
    except httpx.TimeoutException:
        raise AIError("timeout", "The AI took too long to answer. Please try again.", 504)
    except httpx.RequestError:
        raise AIError("unreachable", "The AI service can't be reached right now.", 503)

    if response.status_code != 200:
        raise _error_for(response)
    try:
        return response.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        raise AIError("bad_answer", "The AI service sent an answer we couldn't read.", 502)


async def stream_llm(messages: list[dict]) -> AsyncIterator[str]:
    """Same as ask_llm, but give back the answer piece by piece, as soon as the provider sends it."""
    check_configured()
    url, headers, body = _request(messages, stream=True)
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream("POST", url, headers=headers, json=body) as response:
                if response.status_code != 200:
                    await response.aread()
                    raise _error_for(response)
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue  # empty lines between pieces
                    data = line[len("data:"):].strip()
                    if data == "[DONE]":
                        return
                    try:
                        piece = json.loads(data)["choices"][0]["delta"].get("content")
                    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
                        continue  # a piece we can't read: skip it
                    if piece:
                        yield piece
    except httpx.TimeoutException:
        raise AIError("timeout", "The AI took too long to answer. Please try again.", 504)
    except httpx.RequestError:
        raise AIError("unreachable", "The AI service can't be reached right now.", 503)
