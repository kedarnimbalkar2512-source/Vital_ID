"""Thin Groq client (OpenAI-compatible API) that always asks for JSON and validates it with Pydantic."""

import json
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from ..config import get_settings

T = TypeVar("T", bound=BaseModel)

DISCLAIMER = "AI suggestion — verify clinically. Not a diagnosis or prescription."


class AIUnavailable(Exception):
    pass


def ai_configured() -> bool:
    return bool(get_settings().groq_api_key)


def _chat(messages: list[dict], *, model: str, temperature: float, json_mode: bool = True) -> str:
    s = get_settings()
    if not s.groq_api_key:
        raise AIUnavailable("GROQ_API_KEY is not configured")
    body: dict = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": 4096}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    try:
        resp = httpx.post(
            f"{s.groq_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {s.groq_api_key}"},
            json=body,
            timeout=s.groq_timeout_sec,
        )
    except httpx.HTTPError as e:
        raise AIUnavailable(f"Could not reach Groq: {e}") from e
    if resp.status_code != 200:
        raise AIUnavailable(f"Groq returned {resp.status_code}: {resp.text[:300]}")
    return resp.json()["choices"][0]["message"]["content"]


def complete_json(system: str, user: str | list, schema: type[T], *, temperature: float = 0.1, model: str | None = None) -> tuple[T, str]:
    """Returns (validated object, model name). Retries once, feeding the validation error back."""
    model = model or get_settings().groq_model
    schema_hint = json.dumps(schema.model_json_schema())
    messages = [
        {"role": "system", "content": f"{system}\n\nReply with a single JSON object matching this JSON Schema:\n{schema_hint}"},
        {"role": "user", "content": user},
    ]
    last_error = ""
    for _ in range(2):
        content = _chat(messages, model=model, temperature=temperature)
        try:
            return schema.model_validate_json(content), model
        except ValidationError as e:
            last_error = str(e)[:800]
            messages += [
                {"role": "assistant", "content": content},
                {"role": "user", "content": f"That JSON did not match the schema: {last_error}. Return corrected JSON only."},
            ]
    raise AIUnavailable(f"Model output failed validation: {last_error}")
