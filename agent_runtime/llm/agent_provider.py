"""Agent LLM provider abstraction.

The Desktop Agent uses this module for planning only. Tool execution stays in
Node.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


class AgentLlmUnavailable(RuntimeError):
    """Raised when the configured agent LLM cannot be used."""


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_ai_settings(root: Path | None = None) -> dict[str, Any]:
    settings_path = (root or project_root()) / "data" / "ai-settings.json"
    try:
        with settings_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        data = {}
    except json.JSONDecodeError as exc:
        raise AgentLlmUnavailable(f"Invalid AI settings JSON: {exc}") from exc

    if not isinstance(data, dict):
        return {}
    return data


def agent_ai_settings(root: Path | None = None) -> dict[str, Any]:
    settings = load_ai_settings(root)
    agent_ai = settings.get("agentAi") or {}
    if not isinstance(agent_ai, dict):
        agent_ai = {}

    return {
        "provider": str(agent_ai.get("provider") or "gemini").strip().lower(),
        "model": str(agent_ai.get("model") or "gemini-3.1-flash-lite").strip(),
        "timeoutMs": int(agent_ai.get("timeoutMs") or 30000),
        "maxRetries": int(agent_ai.get("maxRetries") or 1),
        "complexityPolicy": str(agent_ai.get("complexityPolicy") or "static-v1").strip(),
    }


def get_gemini_api_key(env: dict[str, str] | None = None) -> str:
    source = env or os.environ
    return str(source.get("GEMINI_API_KEY") or source.get("GOOGLE_API_KEY") or "").strip()


def parse_json_object(text: str) -> dict[str, Any]:
    raw = str(text or "").strip()
    if not raw:
        raise ValueError("LLM response is empty")

    if raw.startswith("```"):
      lines = raw.splitlines()
      if lines and lines[0].startswith("```"):
          lines = lines[1:]
      if lines and lines[-1].startswith("```"):
          lines = lines[:-1]
      raw = "\n".join(lines).strip()

    first = raw.find("{")
    last = raw.rfind("}")
    if first >= 0 and last > first:
        raw = raw[first:last + 1]

    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("LLM response must be a JSON object")
    return parsed


def build_gemini_chat_model(settings: dict[str, Any] | None = None, env: dict[str, str] | None = None):
    config = settings or agent_ai_settings()
    api_key = get_gemini_api_key(env)
    if not api_key:
        raise AgentLlmUnavailable("GEMINI_API_KEY or GOOGLE_API_KEY is required for agentAi.provider=gemini")

    try:
        from langchain_google_genai import ChatGoogleGenerativeAI
    except Exception as exc:  # pragma: no cover - depends on optional venv deps
        raise AgentLlmUnavailable("langchain-google-genai is not installed. Run node scripts/ensureAgentRuntime.js") from exc

    return ChatGoogleGenerativeAI(
        model=config["model"],
        api_key=api_key,
        temperature=0,
        timeout=config["timeoutMs"] / 1000,
        max_retries=config["maxRetries"],
    )


def build_agent_chat_model(root: Path | None = None, env: dict[str, str] | None = None):
    settings = agent_ai_settings(root)
    provider = settings["provider"]
    if provider != "gemini":
        raise AgentLlmUnavailable(f"Unsupported agentAi.provider in v1: {provider}")
    return build_gemini_chat_model(settings, env)


def invoke_strict_json(messages: list[Any], *, model: Any | None = None, root: Path | None = None) -> dict[str, Any]:
    chat_model = model or build_agent_chat_model(root)
    response = chat_model.invoke(messages)
    content = getattr(response, "content", response)
    if isinstance(content, list):
        content = "\n".join(str(part.get("text") if isinstance(part, dict) else part) for part in content)
    return parse_json_object(str(content))
