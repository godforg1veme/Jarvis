"""Public-only Hysteria2 port-pool contracts for bounded hopping checks."""

from __future__ import annotations

import uuid
from typing import TypedDict


PORT_MIN = 20_000
PORT_MAX = 50_000
MIN_PORTS = 4
MAX_PORTS = 12
MIN_HOP_INTERVAL_SECONDS = 5
MAX_HOP_INTERVAL_SECONDS = 45


class PortPoolError(ValueError):
    """Raised without including an untrusted pool value in the error text."""

    def __init__(self) -> None:
        super().__init__("HYSTERIA_PORT_POOL_INVALID")


class PortPool(TypedDict):
    version: int
    nodeCode: str
    generation: str
    ports: list[int]
    hopIntervalSeconds: int


def _local_port(value: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 1024 <= value <= 65535:
        raise PortPoolError()
    return value


def _canonical_uuid(value: object) -> str:
    if not isinstance(value, str):
        raise PortPoolError()
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError):
        raise PortPoolError() from None
    if str(parsed) != value.lower():
        raise PortPoolError()
    return str(parsed)


def validate_port_pool(value: object, *, expected_node: str) -> PortPool:
    """Validate a pool with no host, URI, credential, or routing metadata."""
    if expected_node not in {"de", "nl"} or not isinstance(value, dict):
        raise PortPoolError()
    expected_keys = {"version", "nodeCode", "generation", "ports", "hopIntervalSeconds"}
    if set(value) != expected_keys or value.get("version") != 1 or value.get("nodeCode") != expected_node:
        raise PortPoolError()
    ports = value.get("ports")
    hop_interval = value.get("hopIntervalSeconds")
    if not isinstance(ports, list) or not MIN_PORTS <= len(ports) <= MAX_PORTS:
        raise PortPoolError()
    if any(not isinstance(port, int) or isinstance(port, bool) or not PORT_MIN <= port <= PORT_MAX for port in ports):
        raise PortPoolError()
    if ports != sorted(set(ports)):
        raise PortPoolError()
    if not isinstance(hop_interval, int) or isinstance(hop_interval, bool) or not MIN_HOP_INTERVAL_SECONDS <= hop_interval <= MAX_HOP_INTERVAL_SECONDS:
        raise PortPoolError()
    return {
        "version": 1,
        "nodeCode": expected_node,
        "generation": _canonical_uuid(value.get("generation")),
        "ports": list(ports),
        "hopIntervalSeconds": hop_interval,
    }


def build_hysteria_hop_client_config(parsed: dict, local_port: int, pool: PortPool) -> dict:
    """Construct a native Hysteria client config; callers retain it only in a private temp file."""
    verified = validate_port_pool(pool, expected_node=pool.get("nodeCode", ""))
    port = _local_port(local_port)
    try:
        host = parsed["host"]
        auth = parsed["auth"]
        sni = parsed["sni"]
        obfs_password = parsed["obfsPassword"]
    except (KeyError, TypeError):
        raise PortPoolError() from None
    return {
        "server": f'{host}:{",".join(str(item) for item in verified["ports"])}',
        "auth": auth,
        "tls": {"sni": sni},
        "obfs": {"type": "salamander", "salamander": {"password": obfs_password}},
        "transport": {"udp": {"hopInterval": f'{verified["hopIntervalSeconds"]}s'}},
        "socks5": {"listen": f"127.0.0.1:{port}", "disableUDP": True},
    }
