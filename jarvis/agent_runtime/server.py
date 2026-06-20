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
from agent_runtime.graphs.desktop_graph import ACTION_POLICIES, run_desktop_task


INTERNAL_ACTIONS = {"ask_user", "report"}
TOOL_ACTIONS = set(ACTION_POLICIES) - INTERNAL_ACTIONS


def is_png_move_demo(command: str) -> bool:
    text = str(command or "").lower()
    return "png" in text and "desktop" in text and "move" in text and "images" in text


def write_event(stdout: TextIO, event: dict[str, Any]) -> None:
    stdout.write(encode_event(event) + "\n")
    stdout.flush()


class AgentRuntimeServer:
    def __init__(self) -> None:
        self.tasks: dict[str, dict[str, Any]] = {}

    def _path_location_hint(self, raw_path: str) -> str:
        parts = [part.lower() for part in Path(raw_path).parts]
        if "desktop" in parts:
            return "desktop"
        if "downloads" in parts:
            return "downloads"
        if "documents" in parts:
            return "documents"
        if "pictures" in parts:
            return "pictures"
        if "videos" in parts:
            return "videos"
        if "music" in parts:
            return "music"
        return "computer"

    def _maybe_recover_missing_path(
        self,
        *,
        message_id: str | None,
        task_id: str,
        task: dict[str, Any],
        result: Any,
    ) -> list[dict[str, Any]] | None:
        step = task.get("pending_step") or {}
        action = str(step.get("action") or "")
        args = step.get("args") if isinstance(step.get("args"), dict) else {}
        error = str(result.get("error") or "") if isinstance(result, dict) else ""
        raw_path = str((result.get("path") if isinstance(result, dict) else "") or args.get("path") or "")

        if action not in {"file.open", "file.reveal", "file.create_text_file"}:
            return None
        if "path does not exist" not in error.lower() and "parent path does not exist" not in error.lower():
            return None
        if not raw_path:
            return None

        query_path = Path(raw_path).parent if action == "file.create_text_file" else Path(raw_path)
        query = query_path.name.strip()
        if not query:
            return None

        location = self._path_location_hint(raw_path)
        request_id = f"{task_id}:{step.get('id') or action}:recover_search"
        task["pending_kind"] = "generic_recovery_search"
        task["pending_request_id"] = request_id
        task["recovery_original_step"] = step

        return [
            make_event(
                "event",
                message_id=message_id,
                task_id=task_id,
                payload={
                    "message": f"Path was missing. Searching for {query!r} in {location}.",
                    "missing_path": raw_path,
                    "query": query,
                    "location": location,
                },
            ),
            make_event(
                "tool_request",
                message_id=message_id,
                task_id=task_id,
                payload={
                    "request_id": request_id,
                    "action": "file.search",
                    "policy": ACTION_POLICIES["file.search"],
                    "args": {"query": query, "location": location, "limit": 10},
                },
            ),
        ]

    def _handle_recovery_search_result(
        self,
        *,
        message_id: str | None,
        task_id: str,
        task: dict[str, Any],
        result: Any,
    ) -> list[dict[str, Any]]:
        candidates = result.get("results") if isinstance(result, dict) else []
        if not isinstance(candidates, list) or not candidates:
            task["pending_kind"] = None
            return [
                make_event(
                    "phase_changed",
                    message_id=message_id,
                    task_id=task_id,
                    payload={"phase": "failed"},
                ),
                make_event(
                    "error",
                    message_id=message_id,
                    task_id=task_id,
                    ok=False,
                    payload={"error": "Path did not exist and recovery search found no matches.", "result": result},
                ),
            ]

        preferred = next((item for item in candidates if isinstance(item, dict) and item.get("type") == "directory"), None)
        selected = preferred or next((item for item in candidates if isinstance(item, dict)), None)
        selected_path = str((selected or {}).get("path") or "")
        if not selected_path:
            task["pending_kind"] = None
            return [
                make_event(
                    "phase_changed",
                    message_id=message_id,
                    task_id=task_id,
                    payload={"phase": "failed"},
                ),
                make_event(
                    "error",
                    message_id=message_id,
                    task_id=task_id,
                    ok=False,
                    payload={"error": "Recovery search returned a result without a path.", "result": result},
                ),
            ]

        original_step = task.get("recovery_original_step") or task.get("pending_step") or {}
        action = str(original_step.get("action") or "file.open")
        original_args = original_step.get("args") if isinstance(original_step.get("args"), dict) else {}
        request_id = f"{task_id}:{original_step.get('id') or action}:recover_open"
        task["pending_kind"] = "generic_recovery_open"
        task["pending_request_id"] = request_id
        task["pending_step"] = original_step
        next_args = {"path": selected_path}
        if action == "file.create_text_file":
            file_name = Path(str(original_args.get("path") or "new_file.txt")).name or "new_file.txt"
            next_args = {
                "path": str(Path(selected_path) / file_name),
                "content": str(original_args.get("content") or ""),
            }

        return [
            make_event(
                "event",
                message_id=message_id,
                task_id=task_id,
                payload={"message": f"Found fallback path: {selected_path}", "target": selected},
            ),
            make_event(
                "tool_request",
                message_id=message_id,
                task_id=task_id,
                payload={
                    "request_id": request_id,
                    "action": action,
                    "policy": ACTION_POLICIES.get(action, "low_risk"),
                    "args": next_args,
                },
            ),
        ]

    def _complete_generic_step(
        self,
        *,
        message_id: str | None,
        task_id: str,
        task: dict[str, Any],
        result: Any,
        recovered: bool = False,
    ) -> list[dict[str, Any]]:
        step = task.get("pending_step") or {}
        task["pending_kind"] = None
        task["pending_request_id"] = None
        task["pending_step"] = None
        task["recovery_original_step"] = None
        task.setdefault("executed_steps", []).append({
            "id": step.get("id"),
            "action": step.get("action"),
            "status": "completed",
            "result": result,
            "recovered": recovered,
        })
        state = task.get("state") or run_desktop_task(str(task.get("user_command") or ""), task_id)
        state["observations"] = list(task.get("observations") or [])
        state["executed_steps"] = list(task.get("executed_steps") or [])
        task["state"] = state
        return self.continue_generic_task(message_id, task_id)

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
                "kind": "png_move_demo",
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
        self.tasks[task_id] = {
            "task_id": task_id,
            "kind": "generic_plan",
            "user_command": user_command,
            "state": state,
            "plan": list(state.get("plan") or []),
            "next_step_index": 0,
            "observations": [],
            "executed_steps": [],
            "pending_kind": None,
            "pending_request_id": None,
            "pending_step": None,
        }
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
            recovery = None
            if pending_kind == "generic_tool":
                recovery = self._maybe_recover_missing_path(
                    message_id=message.message_id,
                    task_id=task_id,
                    task=task,
                    result=result,
                )
            if recovery:
                return recovery

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

        if pending_kind == "generic_tool":
            return self._complete_generic_step(
                message_id=message.message_id,
                task_id=task_id,
                task=task,
                result=result,
            )

        if pending_kind == "generic_recovery_search":
            return self._handle_recovery_search_result(
                message_id=message.message_id,
                task_id=task_id,
                task=task,
                result=result,
            )

        if pending_kind == "generic_recovery_open":
            return self._complete_generic_step(
                message_id=message.message_id,
                task_id=task_id,
                task=task,
                result=result,
                recovered=True,
            )

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

    def continue_generic_task(self, message_id: str | None, task_id: str) -> list[dict[str, Any]]:
        task = self.tasks.get(task_id)
        if not task:
            return [
                make_event(
                    "error",
                    message_id=message_id,
                    task_id=task_id,
                    ok=False,
                    payload={"error": "unknown task for continue"},
                )
            ]

        state = task.get("state") or run_desktop_task(str(task.get("user_command") or ""), task_id)
        plan = list(task.get("plan") or state.get("plan") or [])
        index = int(task.get("next_step_index") or 0)

        while index < len(plan):
            step = plan[index] if isinstance(plan[index], dict) else {}
            task["next_step_index"] = index + 1
            index += 1

            if step.get("enabled") is False:
                continue

            action = str(step.get("action") or "").strip()
            args = step.get("args") if isinstance(step.get("args"), dict) else {}
            step_id = str(step.get("id") or action or f"step_{index}")

            if action == "report":
                message = str(args.get("message") or step.get("title") or "Task completed.")
                state["phase"] = "finalized"
                state["executed_steps"] = list(task.get("executed_steps") or [])
                self.tasks.pop(task_id, None)
                return [
                    make_event(
                        "phase_changed",
                        message_id=message_id,
                        task_id=task_id,
                        payload={"phase": "finalized"},
                    ),
                    make_event(
                        "final_report",
                        message_id=message_id,
                        task_id=task_id,
                        ok=True,
                        payload={"phase": "finalized", "message": message, "state": state},
                    ),
                ]

            if action == "ask_user":
                state["phase"] = "needs_input"
                state["plan"] = plan
                task["state"] = state
                task["pending_kind"] = "generic_user_choice"
                return self.plan_events(message_id, task_id, state)

            if action in TOOL_ACTIONS:
                request_id = f"{task_id}:{step_id}"
                task["pending_kind"] = "generic_tool"
                task["pending_request_id"] = request_id
                task["pending_step"] = step
                state["phase"] = "executing"
                task["state"] = state
                return [
                    make_event(
                        "phase_changed",
                        message_id=message_id,
                        task_id=task_id,
                        payload={"phase": "executing"},
                    ),
                    make_event(
                        "tool_request",
                        message_id=message_id,
                        task_id=task_id,
                        payload={
                            "request_id": request_id,
                            "action": action,
                            "policy": step.get("policy") or ACTION_POLICIES.get(action, "observe"),
                            "args": args,
                        },
                    ),
                ]

            task.setdefault("executed_steps", []).append({
                "id": step_id,
                "action": action,
                "status": "skipped",
                "error": f"Unsupported plan action: {action or 'missing'}",
            })

        state["phase"] = "finalized"
        state["executed_steps"] = list(task.get("executed_steps") or [])
        self.tasks.pop(task_id, None)
        return [
            make_event(
                "phase_changed",
                message_id=message_id,
                task_id=task_id,
                payload={"phase": "finalized"},
            ),
            make_event(
                "final_report",
                message_id=message_id,
                task_id=task_id,
                ok=True,
                payload={"phase": "finalized", "message": "Plan completed.", "state": state},
            ),
        ]

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

        if action == "continue" and task.get("kind") == "generic_plan":
            return self.continue_generic_task(message.message_id, task_id)

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
        events = [
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
        ]
        if phase == "needs_input":
            events.append(
                make_event(
                    "needs_input",
                    message_id=message_id,
                    task_id=task_id,
                    ok=True,
                    payload={"phase": phase, "message": "User input required.", "state": state},
                )
            )
        elif phase == "failed":
            errors = state.get("errors") if isinstance(state.get("errors"), list) else []
            message = "Agent planning failed."
            if errors and isinstance(errors[0], dict) and errors[0].get("message"):
                message = str(errors[0]["message"])
            events.append(
                make_event(
                    "error",
                    message_id=message_id,
                    task_id=task_id,
                    ok=False,
                    payload={"phase": phase, "error": message, "state": state},
                )
            )
        elif phase == "finalized":
            events.append(
                make_event(
                    "final_report",
                    message_id=message_id,
                    task_id=task_id,
                    ok=True,
                    payload={"phase": phase, "message": "Plan completed.", "state": state},
                )
            )
        else:
            events.append(
                make_event(
                    "event",
                    message_id=message_id,
                    task_id=task_id,
                    ok=True,
                    payload={"phase": phase, "message": "Plan prepared. Press Continue to run.", "state": state},
                )
            )

        return events


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
