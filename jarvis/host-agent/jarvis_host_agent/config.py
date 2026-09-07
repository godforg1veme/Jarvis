"""Trusted Host Agent configuration loaded from a root-managed JSON file."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .protocol import ProtocolError, SERVICE_ID_RE


@dataclass(frozen=True)
class ManagedService:
    service_id: str
    source_type: str
    target: str
    actions: frozenset[str]


@dataclass(frozen=True)
class HostAgentConfig:
    authenticator_path: Path
    state_dir: Path
    managed_services: dict[str, ManagedService]


def load_config(path: str | Path) -> HostAgentConfig:
    try:
        raw: Any = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ProtocolError("Host Agent config is unavailable") from exc
    if not isinstance(raw, dict) or set(raw) != {"authenticatorPath", "stateDir", "managedServices"}:
        raise ProtocolError("Host Agent config is invalid")
    services: dict[str, ManagedService] = {}
    rows = raw["managedServices"]
    if not isinstance(rows, list) or len(rows) > 50:
        raise ProtocolError("managedServices is invalid")
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"id", "type", "target", "actions"}:
            raise ProtocolError("managed service is invalid")
        service_id, source_type, target, actions = row["id"], row["type"], row["target"], row["actions"]
        if not isinstance(service_id, str) or not SERVICE_ID_RE.fullmatch(service_id):
            raise ProtocolError("managed service id is invalid")
        if source_type not in {"systemd", "docker"}:
            raise ProtocolError("managed service type is invalid")
        if not isinstance(target, str) or not 1 <= len(target) <= 160:
            raise ProtocolError("managed service target is invalid")
        if source_type == "systemd" and (not target.endswith(".service") or not all(character.isalnum() or character in "@_.-" for character in target)):
            raise ProtocolError("managed systemd target is invalid")
        if source_type == "docker" and not all(character.isalnum() or character in "_.-" for character in target):
            raise ProtocolError("managed Docker target is invalid")
        # An empty allow-list means the service is observable but cannot be
        # changed. This is the default for production services.
        if not isinstance(actions, list) or set(actions) - {"start", "stop", "restart"}:
            raise ProtocolError("managed service actions are invalid")
        if service_id in services:
            raise ProtocolError("managed service id is duplicated")
        services[service_id] = ManagedService(service_id, source_type, target, frozenset(actions))
    return HostAgentConfig(Path(raw["authenticatorPath"]), Path(raw["stateDir"]), services)
