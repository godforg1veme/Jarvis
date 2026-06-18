"""Stdio JSON-lines server for the Jarvis Python agent runtime."""

from __future__ import annotations

import sys
import traceback
from typing import Any, TextIO

from agent_runtime.client_protocol import (
    ProtocolError,
    ProtocolMessage,
    encode_event,
    make_event,
    parse_message,
)
from agent_runtime.graphs.desktop_graph import run_desktop_task


def write_event(stdout: TextIO, event: dict[str, Any]) -> None:
    stdout.write(encode_event(event) + "\n")
    stdout.flush()


def handle_message(message: ProtocolMessage) -> list[dict[str, Any]]:
    if message.message_type == "ping":
        return [make_event("pong", message_id=message.message_id, ok=True)]

    if message.message_type == "start_task":
        user_command = str(message.payload.get("user_command") or "").strip()
        if not user_command:
            return [
                make_event(
                    "error",
                    message_id=message.message_id,
                    task_id=message.task_id,
                    ok=False,
                    payload={"error": "user_command is required"},
                )
            ]

        state = run_desktop_task(user_command, message.task_id)
        task_id = state.get("task_id")
        return [
            make_event(
                "phase_changed",
                message_id=message.message_id,
                task_id=task_id,
                payload={"phase": "classifying"},
            ),
            make_event(
                "plan_draft",
                message_id=message.message_id,
                task_id=task_id,
                payload={"state": state, "plan": state.get("plan", [])},
            ),
            make_event(
                "needs_input" if state.get("phase") == "needs_input" else "final_report",
                message_id=message.message_id,
                task_id=task_id,
                ok=True,
                payload={
                    "phase": state.get("phase"),
                    "message": "План подготовлен." if state.get("phase") != "needs_input" else "Нужно уточнение пользователя.",
                    "state": state,
                },
            ),
        ]

    return [
        make_event(
            "error",
            message_id=message.message_id,
            task_id=message.task_id,
            ok=False,
            payload={"error": f"unknown message type: {message.message_type}"},
        )
    ]


def serve(stdin: TextIO = sys.stdin, stdout: TextIO = sys.stdout) -> int:
    write_event(stdout, make_event("ready", ok=True, payload={"runtime": "jarvis-agent-runtime"}))

    for line in stdin:
        line = line.strip()
        if not line:
            continue

        try:
            message = parse_message(line)
            for event in handle_message(message):
                write_event(stdout, event)
        except ProtocolError as exc:
            write_event(stdout, make_event("error", ok=False, payload={"error": str(exc)}))
        except Exception as exc:  # pragma: no cover - defensive boundary
            write_event(
                stdout,
                make_event(
                    "error",
                    ok=False,
                    payload={"error": str(exc), "traceback": traceback.format_exc()},
                ),
            )

    return 0


if __name__ == "__main__":
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(serve())
