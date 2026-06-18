"""JSON-lines protocol helpers for the Jarvis agent runtime."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


class ProtocolError(ValueError):
    """Raised when a protocol message is malformed."""


@dataclass(frozen=True)
class ProtocolMessage:
    message_type: str
    message_id: str | None
    task_id: str | None
    payload: dict[str, Any]


def parse_message(line: str) -> ProtocolMessage:
    try:
        raw = json.loads(line)
    except json.JSONDecodeError as exc:
        raise ProtocolError(f"invalid_json: {exc.msg}") from exc

    if not isinstance(raw, dict):
        raise ProtocolError("message must be a JSON object")

    message_type = raw.get("type")
    if not isinstance(message_type, str) or not message_type.strip():
        raise ProtocolError("message.type is required")

    message_id = raw.get("id")
    if message_id is not None and not isinstance(message_id, str):
        raise ProtocolError("message.id must be a string")

    task_id = raw.get("task_id")
    if task_id is not None and not isinstance(task_id, str):
        raise ProtocolError("message.task_id must be a string")

    payload = raw.get("payload", {})
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise ProtocolError("message.payload must be an object")

    return ProtocolMessage(
        message_type=message_type,
        message_id=message_id,
        task_id=task_id,
        payload=payload,
    )


def make_event(
    event_type: str,
    *,
    message_id: str | None = None,
    task_id: str | None = None,
    payload: dict[str, Any] | None = None,
    ok: bool | None = None,
) -> dict[str, Any]:
    event: dict[str, Any] = {"type": event_type}
    if message_id is not None:
        event["id"] = message_id
    if task_id is not None:
        event["task_id"] = task_id
    if ok is not None:
        event["ok"] = ok
    if payload is not None:
        event["payload"] = payload
    return event


def encode_event(event: dict[str, Any]) -> str:
    return json.dumps(event, ensure_ascii=False, separators=(",", ":"))
