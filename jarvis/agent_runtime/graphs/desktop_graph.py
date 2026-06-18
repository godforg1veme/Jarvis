"""Desktop Agent graph skeleton.

This module exposes a deterministic rules-first planner now and is structured so
the implementation can swap in compiled LangGraph nodes as the graph grows.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

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


def _classify(state: DesktopAgentState) -> DesktopAgentState:
    next_state = dict(state)
    next_state["phase"] = "classifying"
    return next_state


def _plan_with_rules(state: DesktopAgentState) -> DesktopAgentState:
    command = state.get("user_command", "")
    plan: list[dict[str, Any]]
    phase = "planning"

    if _is_png_move_demo(command):
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


def _finalize(state: DesktopAgentState) -> DesktopAgentState:
    next_state = dict(state)
    if state.get("phase") != "needs_input":
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


def run_desktop_task(user_command: str, task_id: str | None = None) -> DesktopAgentState:
    state = make_initial_state(user_command, task_id)
    graph = build_graph()
    if graph is not None:
        return graph.invoke(state)

    state = _classify(state)
    state = _plan_with_rules(state)
    return _finalize(state)
