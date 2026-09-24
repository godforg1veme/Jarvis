import json
import unittest
from pathlib import Path

import agent_runtime.server as server_module
from agent_runtime.client_protocol import ProtocolError, ProtocolMessage, encode_event, make_event, parse_message
from agent_runtime.graphs.desktop_graph import run_desktop_task
from agent_runtime.server import AgentRuntimeServer, apply_disabled_steps


class ProtocolTests(unittest.TestCase):
    def test_parse_ping(self):
        message = parse_message('{"type":"ping","id":"1"}')
        self.assertEqual(message.message_type, "ping")
        self.assertEqual(message.message_id, "1")
        self.assertEqual(message.payload, {})

    def test_reject_non_object(self):
        with self.assertRaises(ProtocolError):
            parse_message("[]")

    def test_encode_utf8_event(self):
        encoded = encode_event(make_event("event", payload={"message": "Привет"}))
        decoded = json.loads(encoded)
        self.assertEqual(decoded["payload"]["message"], "Привет")

    def test_demo_plan_needs_input(self):
        state = run_desktop_task("Агент, найди все png на рабочем столе и перемести до 20 штук в папку Images")
        self.assertEqual(state["phase"], "needs_input")
        self.assertTrue(any(step["action"] == "ask_user" for step in state["plan"]))

    def test_disabling_steps_reports_broken_dependencies_and_blocks_continue(self):
        plan = [
            {"id": "search", "action": "file.search", "depends_on": []},
            {"id": "move", "action": "file.move_batch", "depends_on": ["search"]},
        ]
        next_plan, errors = apply_disabled_steps(plan, ["search"])
        self.assertFalse(next_plan[0]["enabled"])
        self.assertTrue(next_plan[1]["enabled"])
        self.assertEqual(next_plan[1]["status"], "blocked")
        self.assertEqual(errors[0]["dependencyId"], "search")

        runtime = AgentRuntimeServer()
        runtime.tasks["disable-task"] = {
            "task_id": "disable-task",
            "kind": "generic_plan",
            "user_command": "test",
            "state": {"phase": "planning", "plan": plan, "dependency_errors": []},
            "plan": plan,
            "next_step_index": 0,
        }
        events = runtime.handle_task_action(ProtocolMessage(
            "task_action", "disable-1", "disable-task",
            {"action": "disable_steps", "disabledStepIds": ["search"]},
        ))
        self.assertTrue(any(event["type"] == "plan_validation_error" for event in events))

        blocked = runtime.handle_task_action(ProtocolMessage(
            "task_action", "continue-1", "disable-task", {"action": "continue"},
        ))
        self.assertEqual(blocked[0]["type"], "plan_validation_error")

        valid = runtime.handle_task_action(ProtocolMessage(
            "task_action", "disable-2", "disable-task",
            {"action": "disable_steps", "disabledStepIds": ["search", "move"]},
        ))
        self.assertFalse(any(event["type"] == "plan_validation_error" for event in valid))

    def test_open_desktop_folder_uses_user_desktop(self):
        state = run_desktop_task('открой папку "проверка" на рабочем столе', "folder-task")
        self.assertEqual(state["phase"], "planning")
        self.assertEqual(state["plan"][0]["action"], "file.open")
        self.assertEqual(
            state["plan"][0]["args"]["path"],
            str(Path.home() / "Desktop" / "проверка"),
        )
        self.assertNotIn("Public", state["plan"][0]["args"]["path"])

    def test_create_text_file_in_desktop_folder_uses_create_text_file_tool(self):
        state = run_desktop_task(
            'открой папку проверка на рабочем столе и создай там текстовый файл',
            "text-file-task",
        )
        actions = [step["action"] for step in state["plan"]]
        self.assertEqual(actions[:2], ["file.open", "file.create_text_file"])
        self.assertEqual(
            state["plan"][1]["args"]["path"],
            str(Path.home() / "Desktop" / "проверка" / "new_file.txt"),
        )

    def test_llm_create_folder_txt_is_corrected_to_create_text_file(self):
        def fake_invoker(_messages):
            return {
                "plan": [
                    {
                        "id": "create_file",
                        "title": "Create text file",
                        "action": "file.create_folder",
                        "policy": "requires_confirmation",
                        "args": {"path": r"C:\Users\Public\Desktop\проверка\new_file.txt"},
                    }
                ]
            }

        state = run_desktop_task("создай текстовый файл", "llm-correct", llm_invoker=fake_invoker)
        self.assertEqual(state["plan"][0]["action"], "file.create_text_file")
        self.assertTrue(any("corrected" in warning.get("message", "") for warning in state["dependency_errors"]))

    def test_llm_plan_uses_fake_invoker(self):
        def fake_invoker(_messages):
            return {
                "plan": [
                    {
                        "id": "explain",
                        "title": "Explain limitation",
                        "action": "report",
                        "policy": "observe",
                        "args": {"message": "Bluetooth control is not implemented."},
                    }
                ]
            }

        state = run_desktop_task("turn on bluetooth", "llm-task", llm_invoker=fake_invoker)
        self.assertEqual(state["phase"], "planning")
        self.assertEqual(state["llm_provider"], "gemini")
        self.assertEqual(state["plan"][0]["action"], "report")

    def test_non_demo_task_accepts_continue(self):
        original = server_module.run_desktop_task

        def fake_run_desktop_task(user_command, task_id=None):
            return {
                "task_id": task_id or "task",
                "user_command": user_command,
                "phase": "planning",
                "plan": [
                    {
                        "id": "report",
                        "title": "Report",
                        "action": "report",
                        "policy": "observe",
                        "args": {"message": "done"},
                        "depends_on": [],
                    }
                ],
            }

        server_module.run_desktop_task = fake_run_desktop_task
        try:
            runtime = AgentRuntimeServer()
            start = parse_message(json.dumps({
                "type": "start_task",
                "id": "start-1",
                "task_id": "generic-task",
                "payload": {"user_command": "do something"},
            }))
            start_events = runtime.handle_message(start)
            self.assertTrue(any(event["type"] == "plan_draft" for event in start_events))

            cont = parse_message(json.dumps({
                "type": "task_action",
                "id": "continue-1",
                "task_id": "generic-task",
                "payload": {"action": "continue"},
            }))
            events = runtime.handle_message(cont)
            self.assertFalse(any(
                event["type"] == "error" and "unknown task" in event.get("payload", {}).get("error", "")
                for event in events
            ))
            self.assertTrue(any(event["type"] == "final_report" for event in events))
        finally:
            server_module.run_desktop_task = original

    def test_fast_path_candidate_context_reuses_selected_file(self):
        runtime = AgentRuntimeServer()
        task_id = "fast-path-file"
        source_path = str(Path.home() / "Desktop" / "chosen.txt")
        start_events = runtime.handle_message(ProtocolMessage(
            "start_task",
            "start-fast-file",
            task_id,
            {
                "user_command": "открой выбранный файл",
                "initial_context": {
                    "kind": "candidate_selection",
                    "reason": "Выберите файл.",
                    "candidates": [
                        {"type": "file", "name": "chosen.txt", "path": source_path},
                        {"type": "file", "name": "other.txt", "path": str(Path.home() / "Desktop" / "other.txt")},
                    ],
                },
            },
        ))
        self.assertTrue(any(event["type"] == "needs_input" for event in start_events))

        choice_events = runtime.handle_message(ProtocolMessage(
            "task_action",
            "choose-fast-file",
            task_id,
            {"action": "user_choice", "index": 0, "choice": "chosen.txt"},
        ))
        request = next(event for event in choice_events if event["type"] == "tool_request")
        self.assertEqual(request["payload"]["action"], "file.open")
        self.assertEqual(request["payload"]["args"]["path"], source_path)
        self.assertTrue(any("без повторного поиска" in event.get("payload", {}).get("message", "") for event in choice_events))

    def test_fast_path_confirmation_context_continues_with_original_path(self):
        runtime = AgentRuntimeServer()
        task_id = "fast-path-confirm"
        source_path = str(Path.home() / "Desktop" / "confirmed.txt")
        start_events = runtime.handle_message(ProtocolMessage(
            "start_task",
            "start-fast-confirm",
            task_id,
            {
                "user_command": "открой найденный файл",
                "initial_context": {
                    "kind": "confirmation",
                    "reason": "Подтвердите открытие.",
                    "confirmation": {"action": "open", "path": source_path},
                },
            },
        ))
        self.assertTrue(any(event["type"] == "plan_draft" for event in start_events))

        continue_events = runtime.handle_message(ProtocolMessage(
            "task_action", "continue-fast-confirm", task_id, {"action": "continue"},
        ))
        request = next(event for event in continue_events if event["type"] == "tool_request")
        self.assertEqual(request["payload"]["action"], "file.open")
        self.assertEqual(request["payload"]["args"]["path"], source_path)

    def test_generic_ask_user_choice_resumes_plan(self):
        runtime = AgentRuntimeServer()
        task_id = "generic-choice"
        plan = [
            {
                "id": "choose",
                "title": "Choose",
                "action": "ask_user",
                "policy": "observe",
                "args": {"question": "Choose", "choices": ["One", "Two"]},
                "depends_on": [],
                "enabled": True,
            },
            {
                "id": "report",
                "title": "Report",
                "action": "report",
                "policy": "observe",
                "args": {"message": "done"},
                "depends_on": ["choose"],
                "enabled": True,
            },
        ]
        runtime.tasks[task_id] = {
            "task_id": task_id,
            "kind": "generic_plan",
            "user_command": "choose",
            "state": {"phase": "planning", "plan": plan, "dependency_errors": []},
            "plan": plan,
            "next_step_index": 0,
            "observations": [],
        }
        prompt_events = runtime.handle_task_action(ProtocolMessage(
            "task_action", "continue-choice", task_id, {"action": "continue"},
        ))
        self.assertTrue(any(event["type"] == "needs_input" for event in prompt_events))
        final_events = runtime.handle_task_action(ProtocolMessage(
            "task_action", "answer-choice", task_id, {"action": "user_choice", "index": 1, "choice": "Two"},
        ))
        self.assertTrue(any(event["type"] == "final_report" for event in final_events))
        final_state = next(event["payload"]["state"] for event in final_events if event["type"] == "final_report")
        self.assertEqual(final_state["observations"][-1]["choice"], "Two")

    def test_generic_file_open_recovers_from_missing_path(self):
        original = server_module.run_desktop_task
        bad_path = r"C:\Users\Public\Desktop\проверка"
        good_path = str(Path.home() / "Desktop" / "проверка")

        def fake_run_desktop_task(user_command, task_id=None):
            return {
                "task_id": task_id or "task",
                "user_command": user_command,
                "phase": "planning",
                "plan": [
                    {
                        "id": "open_folder",
                        "title": "Open folder",
                        "action": "file.open",
                        "policy": "low_risk",
                        "args": {"path": bad_path},
                        "depends_on": [],
                    },
                    {
                        "id": "report",
                        "title": "Report",
                        "action": "report",
                        "policy": "observe",
                        "args": {"message": "done"},
                        "depends_on": ["open_folder"],
                    },
                ],
            }

        server_module.run_desktop_task = fake_run_desktop_task
        try:
            runtime = AgentRuntimeServer()
            task_id = "recover-task"
            runtime.handle_message(parse_message(json.dumps({
                "type": "start_task",
                "id": "start-recover",
                "task_id": task_id,
                "payload": {"user_command": "open folder"},
            })))

            first_request = runtime.handle_message(parse_message(json.dumps({
                "type": "task_action",
                "id": "continue-recover",
                "task_id": task_id,
                "payload": {"action": "continue"},
            })))
            self.assertEqual(first_request[-1]["payload"]["action"], "file.open")
            self.assertEqual(first_request[-1]["payload"]["args"]["path"], bad_path)

            recovery_search = runtime.handle_message(parse_message(json.dumps({
                "type": "tool_result",
                "id": "open-failed",
                "task_id": task_id,
                "payload": {
                    "request_id": f"{task_id}:open_folder",
                    "result": {"ok": False, "error": "path does not exist", "path": bad_path},
                },
            })))
            self.assertEqual(recovery_search[-1]["payload"]["action"], "file.search")
            self.assertEqual(recovery_search[-1]["payload"]["args"]["query"], "проверка")
            self.assertEqual(recovery_search[-1]["payload"]["args"]["location"], "desktop")

            recovery_open = runtime.handle_message(parse_message(json.dumps({
                "type": "tool_result",
                "id": "search-ok",
                "task_id": task_id,
                "payload": {
                    "request_id": f"{task_id}:open_folder:recover_search",
                    "result": {
                        "ok": True,
                        "results": [{"type": "directory", "name": "проверка", "path": good_path}],
                    },
                },
            })))
            self.assertEqual(recovery_open[-1]["payload"]["action"], "file.open")
            self.assertEqual(recovery_open[-1]["payload"]["args"]["path"], good_path)

            final_events = runtime.handle_message(parse_message(json.dumps({
                "type": "tool_result",
                "id": "recover-open-ok",
                "task_id": task_id,
                "payload": {
                    "request_id": f"{task_id}:open_folder:recover_open",
                    "result": {"ok": True, "target": {"path": good_path}},
                },
            })))
            self.assertTrue(any(event["type"] == "final_report" for event in final_events))
        finally:
            server_module.run_desktop_task = original

    def test_create_text_file_recovers_from_missing_parent_path(self):
        original = server_module.run_desktop_task
        bad_path = r"C:\Users\Public\Desktop\проверка\new_file.txt"
        good_folder = str(Path.home() / "Desktop" / "проверка")
        good_path = str(Path(good_folder) / "new_file.txt")

        def fake_run_desktop_task(user_command, task_id=None):
            return {
                "task_id": task_id or "task",
                "user_command": user_command,
                "phase": "planning",
                "plan": [
                    {
                        "id": "create_file",
                        "title": "Create text file",
                        "action": "file.create_text_file",
                        "policy": "requires_confirmation",
                        "args": {"path": bad_path, "content": ""},
                        "depends_on": [],
                    },
                    {
                        "id": "report",
                        "title": "Report",
                        "action": "report",
                        "policy": "observe",
                        "args": {"message": "done"},
                        "depends_on": ["create_file"],
                    },
                ],
            }

        server_module.run_desktop_task = fake_run_desktop_task
        try:
            runtime = AgentRuntimeServer()
            task_id = "recover-create-file"
            runtime.handle_message(parse_message(json.dumps({
                "type": "start_task",
                "id": "start-create",
                "task_id": task_id,
                "payload": {"user_command": "create file"},
            })))

            first_request = runtime.handle_message(parse_message(json.dumps({
                "type": "task_action",
                "id": "continue-create",
                "task_id": task_id,
                "payload": {"action": "continue"},
            })))
            self.assertEqual(first_request[-1]["payload"]["action"], "file.create_text_file")

            recovery_search = runtime.handle_message(parse_message(json.dumps({
                "type": "tool_result",
                "id": "create-failed",
                "task_id": task_id,
                "payload": {
                    "request_id": f"{task_id}:create_file",
                    "result": {"ok": False, "error": "parent path does not exist", "path": bad_path},
                },
            })))
            self.assertEqual(recovery_search[-1]["payload"]["action"], "file.search")
            self.assertEqual(recovery_search[-1]["payload"]["args"]["query"], "проверка")

            recovery_create = runtime.handle_message(parse_message(json.dumps({
                "type": "tool_result",
                "id": "search-folder-ok",
                "task_id": task_id,
                "payload": {
                    "request_id": f"{task_id}:create_file:recover_search",
                    "result": {
                        "ok": True,
                        "results": [{"type": "directory", "name": "проверка", "path": good_folder}],
                    },
                },
            })))
            self.assertEqual(recovery_create[-1]["payload"]["action"], "file.create_text_file")
            self.assertEqual(recovery_create[-1]["payload"]["args"]["path"], good_path)
        finally:
            server_module.run_desktop_task = original


if __name__ == "__main__":
    unittest.main()
