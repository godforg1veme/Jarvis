"""Desktop Agent state schema.

The runtime keeps this schema intentionally plain so the stdio protocol can
serialize it without custom encoders.
"""

from __future__ import annotations

from typing import Any, Literal, TypedDict


AgentPhase = Literal[
    "created",
    "classifying",
    "observing",
    "planning",
    "needs_input",
    "needs_confirmation",
    "executing",
    "finalized",
    "failed",
]


class DesktopAgentState(TypedDict, total=False):
    task_id: str
    user_command: str
    phase: AgentPhase
    messages: list[dict[str, Any]]
    observations: list[dict[str, Any]]
    candidates: list[dict[str, Any]]
    plan: list[dict[str, Any]]
    disabled_steps: list[str]
    dependency_errors: list[dict[str, Any]]
    pending_confirmation: dict[str, Any] | None
    executed_steps: list[dict[str, Any]]
    errors: list[dict[str, Any]]
    llm_provider: str | None
    limits: dict[str, Any]
    audit_refs: list[dict[str, Any]]
