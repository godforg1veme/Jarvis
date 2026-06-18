"""Stdio JSON-lines server for the Jarvis Python agent runtime."""

from __future__ import annotations

import sys
import traceback
from pathlib import Path
from typing import Any, TextIO

from agent_runtime.client_protocol import (
    ProtocolError,
    ProtocolMessage,
    encode_event,
    make_event,
    parse_message,
)
from agent_runtime.graphs.desktop_graph import run_desktop_task


def is_png_move_demo(command: str) -> bool:
    text = str(command or "").lower()
    return "png" in text and "desktop" in text and "move" in text and "images" in text


def write_event(stdout: TextIO, event: dict[str, Any]) -> None:
    stdout.write(encode_event(event) + "\n")
    stdout.flush()


class AgentRuntimeServer:
    def __init__(self) -> None:
        self.tasks: dict[str, dict[str, Any]] = {}

    def handle_message(self, message: ProtocolMessage) -> list[dict[str, Any]]:
        if message.message_type == "ping":
            return [make_event("pong", message_id=message.message_id, ok=True)]
        if message.message_type == "start_task":
            return self.handle_start_task(message)
        if message.message_type == "tool_result":
            return self.handle_tool_result(message)
        if message.message_type == "task_action":
            return self.handle_task_action(message)

        return [
            make_event(
                "error",
                message_id=message.message_id,
                task_id=message.task_id,
                ok=False,
                payload={"error": f"unknown message type: {message.message_type}"},
            )
        ]

    def handle_start_task(self, message: ProtocolMessage) -> list[dict[str, Any]]:
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

        task_id = message.task_id or f"task-{message.message_id or 'runtime'}"

        if is_png_move_demo(user_command):
            request_id = f"{task_id}:search_png_desktop"
            self.tasks[task_id] = {
                "task_id": task_id,
                "user_command": user_command,
                "observations": [],
                "pending_request_id": request_id,
                "pending_kind": "search_png_desktop",
                "candidates": [],
                "destination": None,
            }
            return [
                make_event(
                    "phase_changed",
                    message_id=message.message_id,
                    task_id=task_id,
                    payload={"phase": "observing"},
                ),
                make_event(
                    "tool_request",
                    message_id=message.message_id,
                    task_id=task_id,
                    payload={
                        "request_id": request_id,
                        "action": "file.search",
                        "policy": "observe",
                        "args": {"query": "*.png", "location": "desktop", "limit": 20},
                    },
                ),
            ]

        state = run_desktop_task(user_command, task_id)
        return self.plan_events(message.message_id, task_id, state)

    def handle_tool_result(self, message: ProtocolMessage) -> list[dict[str, Any]]:
        task_id = message.task_id
        if not task_id or task_id not in self.tasks:
            return [
                make_event(
                    "error",
                    message_id=message.message_id,
                    task_id=task_id,
                    ok=False,
                    payload={"error": "unknown task for tool_result"},
                )
            ]

        task = self.tasks[task_id]
        result = message.payload.get("result")
        request_id = message.payload.get("request_id")
        pending_kind = task.get("pending_kind")
        task["observations"].append({"request_id": request_id, "result": result})

        if isinstance(result, dict) and result.get("ok") is False:
            task["pending_kind"] = None
            return [
                make_event(
                    "phase_changed",
                    message_id=message.message_id,
                    task_id=task_id,
                    payload={"phase": "failed"},
                ),
                make_event(
                    "error",
                    message_id=message.message_id,
                    task_id=task_id,
                    ok=False,
                    payload={"error": result.get("error") or "Tool execution failed.", "result": result},
                ),
            ]

        if pending_kind == "search_png_desktop":
            if isinstance(result, dict) and isinstance(result.get("results"), list):
                task["candidates"] = result["results"][:20]

            state = run_desktop_task(str(task.get("user_command") or ""), task_id)
            state["observations"] = list(task["observations"])
            state["candidates"] = list(task.get("candidates") or [])
            task["state"] = state
            task["pending_kind"] = "await_destination_choice"
            return self.plan_events(message.message_id, task_id, state)

        if pending_kind == "create_images_folder":
            destination = task.get("destination")
            if isinstance(result, dict) and result.get("path"):
                destination = result["path"]
                task["destination"] = destination

            paths = [
                item.get("path")
                for item in task.get("candidates", [])
                if isinstance(item, dict) and item.get("path")
            ][:20]
            if not paths:
                task["pending_kind"] = None
                return [
                    make_event(
                        "final_report",
                        message_id=message.message_id,
                        task_id=task_id,
                        ok=True,
                        payload={"phase": "finalized", "message": "PNG files were not found.", "moved": 0},
                    )
                ]

            request_id = f"{task_id}:move_png_batch"
            task["pending_kind"] = "move_png_batch"
            task["pending_request_id"] = request_id
            return [
                make_event(
                    "phase_changed",
                    message_id=message.message_id,
                    task_id=task_id,
                    payload={"phase": "needs_confirmation"},
                ),
                make_event(
                    "tool_request",
                    message_id=message.message_id,
                    task_id=task_id,
                    payload={
                        "request_id": request_id,
                        "action": "file.move_batch",
                        "policy": "requires_strong_confirmation",
                        "args": {"paths": paths, "to": destination},
                    },
                ),
            ]

        if pending_kind == "move_png_batch":
            task["pending_kind"] = None
            moved = 0
            if isinstance(result, dict) and isinstance(result.get("results"), list):
                moved = len(result["results"])
            return [
                make_event(
                    "phase_changed",
                    message_id=message.message_id,
                    task_id=task_id,
                    payload={"phase": "finalized"},
                ),
                make_event(
                    "final_report",
                    message_id=message.message_id,
                    task_id=task_id,
                    ok=True,
                    payload={
                        "phase": "finalized",
                        "message": f"Moved {moved} PNG file(s) to Images.",
                        "moved": moved,
                    },
                ),
            ]

        state = task.get("state") or run_desktop_task(str(task.get("user_command") or ""), task_id)
        state["observations"] = list(task["observations"])
        return self.plan_events(message.message_id, task_id, state)

    def handle_task_action(self, message: ProtocolMessage) -> list[dict[str, Any]]:
        task_id = message.task_id
        action = str(message.payload.get("action") or "").strip()
        if not task_id or task_id not in self.tasks:
            return [
                make_event(
                    "error",
                    message_id=message.message_id,
                    task_id=task_id,
                    ok=False,
                    payload={"error": "unknown task for task_action"},
                )
            ]

        task = self.tasks[task_id]
        if action == "cancel":
            self.tasks.pop(task_id, None)
            return [
                make_event(
                    "final_report",
                    message_id=message.message_id,
                    task_id=task_id,
                    ok=True,
                    payload={"phase": "finalized", "message": "Task cancelled by user."},
                )
            ]

        if action == "stop_after_current_step":
            task["stop_after_current_step"] = True
            return [
                make_event(
                    "event",
                    message_id=message.message_id,
                    task_id=task_id,
                    payload={"message": "Will stop after the current step."},
                )
            ]

        if action == "user_choice" and task.get("pending_kind") == "await_destination_choice":
            choice = message.payload.get("choice")
            index = message.payload.get("index")
            task["observations"].append({"type": "user_choice", "index": index, "choice": choice})
            destination = str(Path.home() / "Desktop" / "Images")
            request_id = f"{task_id}:create_images_folder"
            task["destination"] = destination
            task["pending_kind"] = "create_images_folder"
            task["pending_request_id"] = request_id
            return [
                make_event(
                    "phase_changed",
                    message_id=message.message_id,
                    task_id=task_id,
                    payload={"phase": "needs_confirmation"},
                ),
                make_event(
                    "tool_request",
                    message_id=message.message_id,
                    task_id=task_id,
                    payload={
                        "request_id": request_id,
                        "action": "file.create_folder",
                        "policy": "requires_confirmation",
                        "args": {"path": destination},
                    },
                ),
            ]

        return [
            make_event(
                "event",
                message_id=message.message_id,
                task_id=task_id,
                payload={"message": f"Task action accepted: {action or 'unknown'}"},
            )
        ]

    def plan_events(self, message_id: str | None, task_id: str, state: dict[str, Any]) -> list[dict[str, Any]]:
        phase = state.get("phase")
        return [
            make_event(
                "phase_changed",
                message_id=message_id,
                task_id=task_id,
                payload={"phase": phase},
            ),
            make_event(
                "plan_draft",
                message_id=message_id,
                task_id=task_id,
                payload={"state": state, "plan": state.get("plan", [])},
            ),
            make_event(
                "needs_input" if phase == "needs_input" else "final_report",
                message_id=message_id,
                task_id=task_id,
                ok=True,
                payload={
                    "phase": phase,
                    "message": "User input required." if phase == "needs_input" else "Plan prepared.",
                    "state": state,
                },
            ),
        ]


def handle_message(message: ProtocolMessage) -> list[dict[str, Any]]:
    return AgentRuntimeServer().handle_message(message)


def serve(stdin: TextIO = sys.stdin, stdout: TextIO = sys.stdout) -> int:
    runtime = AgentRuntimeServer()
    write_event(stdout, make_event("ready", ok=True, payload={"runtime": "jarvis-agent-runtime"}))

    for line in stdin:
        line = line.strip()
        if not line:
            continue

        try:
            message = parse_message(line)
            for event in runtime.handle_message(message):
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
