"""Desktop Agent graph skeleton.

This module exposes a deterministic rules-first planner now and is structured so
the implementation can swap in compiled LangGraph nodes as the graph grows.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any
from typing import Callable

from agent_runtime.llm.agent_provider import AgentLlmUnavailable, invoke_strict_json
from agent_runtime.schemas.desktop_state import DesktopAgentState

try:
    from langgraph.graph import END, START, StateGraph
except Exception:  # pragma: no cover - exercised when deps are not installed
    END = START = StateGraph = None


DEFAULT_LIMITS = {
    "max_tool_actions": 10,
    "max_batch_items": 20,
    "stop_on_first_error": True,
}

ACTION_POLICIES = {
    "file.search": "observe",
    "file.list_directory": "observe",
    "app.resolve": "observe",
    "window.list": "observe",
    "file.open": "low_risk",
    "file.reveal": "low_risk",
    "window.focus": "low_risk",
    "window.restore": "low_risk",
    "file.create_folder": "requires_confirmation",
    "file.create_text_file": "requires_confirmation",
    "file.rename": "requires_confirmation",
    "file.move": "requires_confirmation",
    "file.copy": "requires_confirmation",
    "file.delete": "requires_confirmation",
    "app.close": "requires_confirmation",
    "window.close": "requires_confirmation",
    "window.move": "requires_confirmation",
    "window.resize": "requires_confirmation",
    "window.layout": "requires_confirmation",
    "file.move_batch": "requires_strong_confirmation",
    "file.copy_batch": "requires_strong_confirmation",
    "file.rename_batch": "requires_strong_confirmation",
    "file.delete_batch": "requires_strong_confirmation",
    "ask_user": "observe",
    "report": "observe",
}

ALLOWED_ACTIONS = set(ACTION_POLICIES)

LLM_SYSTEM_PROMPT = """You are the Jarvis Desktop Agent planner for a Windows desktop assistant.
Return only one JSON object with this shape:
{"plan":[{"id":"short_id","title":"human title","action":"report","policy":"observe","args":{},"depends_on":[]}]}

Allowed actions:
- observe: file.search, file.list_directory, app.resolve, window.list
- low risk: file.open, file.reveal, window.focus, window.restore
- confirmed: file.create_folder, file.create_text_file, file.rename, file.move, file.copy, file.delete, app.close, window.close, window.move, window.resize, window.layout
- strong confirmation: file.move_batch, file.copy_batch, file.rename_batch, file.delete_batch
- internal: ask_user, report

Rules:
- User commands may be in Russian or English. Understand Russian commands directly; do not ask for rephrasing just because the command is Russian.
- Do not invent tools or actions outside the allowed action list.
- If the user asks for something unsupported, create a report step explaining what is missing.
- Bluetooth control and Yandex Music playback/track control are unsupported unless a future tool is added; report that limitation explicitly.
- Do not use app.launch; this runtime cannot safely launch arbitrary LLM-selected apps yet.
- Do not include shell, PowerShell, registry, Bluetooth, browser automation, music-player control, or network actions.
- To create a text file, use file.create_text_file with a concrete .txt path; never use file.create_folder for .txt files.
- Keep the plan at 5 steps or fewer.
- Every mutating action must include concrete args and the matching confirmation policy.
- Prefer a final report step for limitations or completion notes.
"""


def make_initial_state(user_command: str, task_id: str | None = None) -> DesktopAgentState:
    return {
        "task_id": task_id or f"task-{uuid.uuid4().hex[:12]}",
        "user_command": user_command,
        "phase": "created",
        "messages": [],
        "observations": [],
        "candidates": [],
        "plan": [],
        "disabled_steps": [],
        "dependency_errors": [],
        "pending_confirmation": None,
        "executed_steps": [],
        "errors": [],
        "llm_provider": None,
        "limits": dict(DEFAULT_LIMITS),
        "audit_refs": [],
    }


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "").lower().replace("ё", "е")).strip()


def _is_png_move_demo(command: str) -> bool:
    text = _normalize(command)
    return (
        ("png" in text or ".png" in text)
        and ("рабоч" in text or "desktop" in text)
        and ("перемест" in text or "move" in text)
        and ("images" in text or "изображ" in text)
    )


def _desktop_folder_to_open(command: str) -> str:
    text = _normalize(command)
    text = re.sub(r"^(джарвис|jarvis|агент|agent)\s+", "", text).strip()

    patterns = [
        r"^(?:открой|открыть|покажи|показать)\s+(?:папку|папка|директорию|директория|folder|directory)\s+(.+?)\s+(?:на\s+рабочем\s+столе|рабочем\s+столе|desktop|on\s+desktop)$",
        r"^(?:open|show)\s+(?:folder|directory)\s+(.+?)\s+(?:on\s+desktop|desktop)$",
    ]

    for pattern in patterns:
        match = re.search(pattern, text)
        if not match:
            continue
        folder = match.group(1).strip().strip("\"'«»")
        folder = re.sub(r"\s+", " ", folder).strip()
        if folder and not any(sep in folder for sep in ("/", "\\")):
            return folder

    return ""


def _desktop_folder_text_file_request(command: str) -> tuple[str, str]:
    folder = _desktop_folder_to_open(command)
    text = _normalize(command)
    wants_text_file = (
        ("создай" in text or "создать" in text or "create" in text)
        and ("текстов" in text or ".txt" in text or "text file" in text)
    )
    if not folder and wants_text_file:
        folder_match = re.search(
            r"(?:открой|открыть|покажи|показать|open|show)\s+(?:папку|папка|директорию|директория|folder|directory)\s+(.+?)\s+(?:на\s+рабочем\s+столе|рабочем\s+столе|desktop|on\s+desktop)\b",
            text,
        )
        if folder_match:
            folder = folder_match.group(1).strip().strip("\"'«»")
            folder = re.sub(r"\s+", " ", folder).strip()
    if not folder or not wants_text_file:
        return "", ""

    file_match = re.search(r"([\wа-яА-ЯёЁ -]+?\.txt)\b", str(command or ""), re.IGNORECASE)
    file_name = "new_file.txt"
    if file_match:
        file_name = Path(file_match.group(1).strip().strip("\"'«»")).name
    return folder, file_name


def _classify(state: DesktopAgentState) -> DesktopAgentState:
    next_state = dict(state)
    next_state["phase"] = "classifying"
    return next_state


def _plan_with_rules(state: DesktopAgentState) -> DesktopAgentState:
    command = state.get("user_command", "")
    plan: list[dict[str, Any]]
    phase = "planning"
    desktop_folder_for_text_file, text_file_name = _desktop_folder_text_file_request(command)
    desktop_folder = _desktop_folder_to_open(command)

    if desktop_folder_for_text_file:
        folder_path = Path.home() / "Desktop" / desktop_folder_for_text_file
        file_path = str(folder_path / text_file_name)
        plan = [
            {
                "id": "find_folder",
                "title": f"Найти папку {desktop_folder_for_text_file} на рабочем столе",
                "action": "file.open",
                "policy": "low_risk",
                "args": {"path": str(folder_path)},
                "depends_on": [],
            },
            {
                "id": "create_text_file",
                "title": "Создать текстовый файл в папке",
                "action": "file.create_text_file",
                "policy": "requires_confirmation",
                "args": {"path": file_path, "content": ""},
                "depends_on": ["find_folder"],
            },
            {
                "id": "report",
                "title": "Показать отчет",
                "action": "report",
                "policy": "observe",
                "args": {"message": f"Файл создан: {file_path}"},
                "depends_on": ["create_text_file"],
            },
        ]
    elif desktop_folder:
        target_path = str(Path.home() / "Desktop" / desktop_folder)
        plan = [
            {
                "id": "open_desktop_folder",
                "title": f"Открыть папку {desktop_folder} на рабочем столе",
                "action": "file.open",
                "policy": "low_risk",
                "args": {"path": target_path},
                "depends_on": [],
            },
            {
                "id": "report",
                "title": "Показать отчет",
                "action": "report",
                "policy": "observe",
                "args": {"message": f"Открыта папка: {target_path}"},
                "depends_on": ["open_desktop_folder"],
            },
        ]
    elif _is_png_move_demo(command):
        phase = "needs_input"
        plan = [
            {
                "id": "find_png_desktop",
                "title": "Найти PNG на рабочем столе",
                "action": "file.search",
                "policy": "observe",
                "args": {"query": "*.png", "location": "desktop", "limit": 20},
                "depends_on": [],
            },
            {
                "id": "choose_images_destination",
                "title": "Уточнить папку Images",
                "action": "ask_user",
                "policy": "observe",
                "args": {
                    "question": "Куда создать или где искать папку Images?",
                    "choices": ["Создать на рабочем столе", "Выбрать папку", "Ввести путь"],
                },
                "depends_on": ["find_png_desktop"],
            },
            {
                "id": "move_png_batch",
                "title": "Переместить найденные PNG",
                "action": "file.move_batch",
                "policy": "requires_strong_confirmation",
                "args": {"limit": 20},
                "depends_on": ["choose_images_destination"],
            },
            {
                "id": "report",
                "title": "Показать отчет",
                "action": "report",
                "policy": "observe",
                "args": {},
                "depends_on": ["move_png_batch"],
            },
        ]
    else:
        plan = [
            {
                "id": "analyze_command",
                "title": "Проанализировать команду",
                "action": "agent.analyze",
                "policy": "observe",
                "args": {"command": command},
                "depends_on": [],
            },
            {
                "id": "need_agent_llm",
                "title": "Нужен agent LLM для точного плана",
                "action": "agent.llm_plan",
                "policy": "observe",
                "args": {},
                "depends_on": ["analyze_command"],
            },
        ]

    next_state = dict(state)
    next_state["phase"] = phase
    next_state["plan"] = plan
    return next_state


def _safe_step_id(value: Any, index: int) -> str:
    raw = re.sub(r"[^a-zA-Z0-9_.:-]+", "_", str(value or "").strip()).strip("_")
    return raw or f"step_{index + 1}"


def _coerce_depends_on(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item or "").strip()]


def _report_step(message: str, index: int = 0) -> dict[str, Any]:
    return {
        "id": f"report_{index + 1}",
        "title": "Report",
        "action": "report",
        "policy": "observe",
        "args": {"message": message},
        "depends_on": [],
    }


def _known_unsupported_message(command: str) -> str:
    text = _normalize(command)
    wants_bluetooth = "bluetooth" in text or "\u0431\u043b\u044e\u0442\u0443\u0437" in text
    wants_yandex_music = (
        "yandex music" in text
        or "yandex" in text
        or "\u044f\u043d\u0434\u0435\u043a\u0441" in text
        or "\u043c\u0443\u0437\u044b\u043a" in text
    )

    missing: list[str] = []
    if wants_bluetooth:
        missing.append("Bluetooth control tool")
    if wants_yandex_music:
        missing.append("Yandex Music playback control tool")

    if not missing:
        return ""
    return "Cannot complete this yet. Missing: " + ", ".join(missing) + "."


def _normalize_llm_plan(raw_plan: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    warnings: list[dict[str, Any]] = []
    if not isinstance(raw_plan, list):
        return [_report_step("Gemini did not return a usable plan.")], [{"message": "plan must be an array"}]

    normalized: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for index, raw_step in enumerate(raw_plan[:5]):
        if not isinstance(raw_step, dict):
            warnings.append({"message": f"plan step #{index + 1} is not an object"})
            continue

        action = str(raw_step.get("action") or "").strip()
        args = raw_step.get("args")
        if not isinstance(args, dict):
            args = {}
        if action == "file.create_folder" and str(args.get("path") or "").lower().endswith(".txt"):
            warnings.append({"message": "corrected file.create_folder .txt step to file.create_text_file"})
            action = "file.create_text_file"
        if action not in ALLOWED_ACTIONS:
            warnings.append({"message": f"unsupported action from Gemini: {action or 'missing'}"})
            normalized.append(_report_step(f"Unsupported planned action was ignored: {action or 'missing'}.", index))
            continue

        step_id = _safe_step_id(raw_step.get("id") or action, index)
        if step_id in used_ids:
            step_id = f"{step_id}_{index + 1}"
        used_ids.add(step_id)

        policy = str(raw_step.get("policy") or ACTION_POLICIES[action]).strip()
        expected_policy = ACTION_POLICIES[action]
        if policy != expected_policy:
            warnings.append({
                "stepId": step_id,
                "message": f"policy corrected from {policy or 'missing'} to {expected_policy}",
            })
            policy = expected_policy

        normalized.append({
            "id": step_id,
            "title": str(raw_step.get("title") or action),
            "action": action,
            "policy": policy,
            "args": args,
            "depends_on": _coerce_depends_on(raw_step.get("depends_on") or raw_step.get("dependsOn")),
        })

    if len(raw_plan) > 5:
        warnings.append({"message": "plan was truncated to 5 steps"})

    if not normalized:
        normalized = [_report_step("Gemini returned an empty plan.")]
    return normalized, warnings


def _build_llm_messages(command: str) -> list[Any]:
    try:
        from langchain_core.messages import HumanMessage, SystemMessage

        return [
            SystemMessage(content=LLM_SYSTEM_PROMPT),
            HumanMessage(content=f"User command: {command}"),
        ]
    except Exception:
        return [
            {"role": "system", "content": LLM_SYSTEM_PROMPT},
            {"role": "user", "content": f"User command: {command}"},
        ]


def _plan_with_llm(
    state: DesktopAgentState,
    llm_invoker: Callable[..., dict[str, Any]] | None = None,
) -> DesktopAgentState:
    command = str(state.get("user_command") or "")
    invoker = llm_invoker or invoke_strict_json
    next_state = dict(state)
    next_state["phase"] = "planning"

    try:
        payload = invoker(_build_llm_messages(command))
        plan, warnings = _normalize_llm_plan(payload.get("plan") if isinstance(payload, dict) else None)
        unsupported_message = _known_unsupported_message(command)
        if unsupported_message:
            warnings.append({"message": "known unsupported capability guard replaced Gemini plan"})
            plan = [_report_step(unsupported_message)]
        next_state["plan"] = plan
        next_state["llm_provider"] = "gemini"
        next_state["dependency_errors"] = warnings
    except AgentLlmUnavailable as exc:
        next_state["phase"] = "failed"
        next_state["errors"] = [{"message": str(exc)}]
        next_state["plan"] = [_report_step(f"Gemini is unavailable: {exc}")]
    except Exception as exc:
        next_state["phase"] = "failed"
        next_state["errors"] = [{"message": f"Gemini planning failed: {exc}"}]
        next_state["plan"] = [_report_step(f"Gemini planning failed: {exc}")]

    return next_state


def _finalize(state: DesktopAgentState) -> DesktopAgentState:
    next_state = dict(state)
    if state.get("phase") not in {"needs_input", "planning", "failed"}:
        next_state["phase"] = "finalized"
    return next_state


def build_graph():
    if StateGraph is None:
        return None

    builder = StateGraph(DesktopAgentState)
    builder.add_node("classify", _classify)
    builder.add_node("plan", _plan_with_rules)
    builder.add_node("finalize", _finalize)
    builder.add_edge(START, "classify")
    builder.add_edge("classify", "plan")
    builder.add_edge("plan", "finalize")
    builder.add_edge("finalize", END)
    return builder.compile()


def run_desktop_task(
    user_command: str,
    task_id: str | None = None,
    *,
    llm_invoker: Callable[..., dict[str, Any]] | None = None,
) -> DesktopAgentState:
    state = make_initial_state(user_command, task_id)
    graph = build_graph()
    if graph is not None and _is_png_move_demo(user_command):
        return graph.invoke(state)

    state = _classify(state)
    if _is_png_move_demo(user_command) or _desktop_folder_to_open(user_command) or _desktop_folder_text_file_request(user_command)[0]:
        state = _plan_with_rules(state)
    else:
        state = _plan_with_llm(state, llm_invoker)
    return _finalize(state)
