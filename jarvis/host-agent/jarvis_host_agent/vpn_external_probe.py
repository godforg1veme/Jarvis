"""Closed client-probe contracts. This module never logs or serializes URI inputs."""

from __future__ import annotations

import ipaddress
import json
import os
import re
import stat
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlsplit


class ProbeConfigError(ValueError):
    def __init__(self) -> None:
        super().__init__("VPN_EXTERNAL_PROBE_INVALID")


CHECK_NAMES = frozenset({"vless_tcp_443", "vless_tcp_8443", "hysteria2_udp_443", "hysteria2_udp_hop"})
FAILURE_CODES = frozenset({
    "NOT_CONFIGURED", "RUNNER_UNAVAILABLE", "CHECK_UNAVAILABLE", "EGRESS_UNAVAILABLE",
    "PROXY_CONNECT_FAILURE", "EXIT_MISMATCH", "HTTP_FAILURE",
})
_DOMAIN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$", re.ASCII)
_PUBLIC_KEY = re.compile(r"^[A-Za-z0-9_-]{43,44}$", re.ASCII)
_SHORT_ID = re.compile(r"^[a-fA-F0-9]{2,16}$", re.ASCII)
_CLIENT_ID = re.compile(r"^vpn-[a-f0-9]{12}$", re.ASCII)


def _host(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 253:
        raise ProbeConfigError()
    try:
        ipaddress.ip_address(value)
    except ValueError:
        if not _DOMAIN.fullmatch(value) or ".." in value or "." not in value:
            raise ProbeConfigError() from None
    return value.lower()


def _uri(uri: str, scheme: str, expected_host: str, keys: frozenset[str]):
    if not isinstance(uri, str) or len(uri) > 2048 or any(ord(ch) < 32 or ord(ch) == 127 for ch in uri):
        raise ProbeConfigError()
    try:
        parts = urlsplit(uri)
        pairs = parse_qsl(parts.query, keep_blank_values=True, strict_parsing=True, max_num_fields=16)
        fields = dict(pairs)
        port = parts.port
        host = _host(parts.hostname or "")
        if parts.scheme != scheme or host != _host(expected_host) or len(pairs) != len(fields):
            raise ProbeConfigError()
        if frozenset(fields) != keys or not parts.fragment or port is None:
            raise ProbeConfigError()
        return parts, fields, host, port
    except (ValueError, UnicodeError):
        raise ProbeConfigError() from None


def parse_vless_uri(uri: str, *, expected_host: str) -> dict:
    keys = frozenset({"encryption", "flow", "security", "headerType", "sni", "fp", "pbk", "sid", "type", "xtls"})
    parts, fields, host, port = _uri(uri, "vless", expected_host, keys)
    try:
        client_id = str(uuid.UUID(parts.username or ""))
    except (ValueError, AttributeError):
        raise ProbeConfigError() from None
    if parts.password or port not in {443, 8443} or parts.path not in {"", "/"}:
        raise ProbeConfigError()
    required = {"encryption": "none", "flow": "xtls-rprx-vision", "security": "reality", "headerType": "none",
                "fp": "chrome", "type": "tcp", "xtls": "2"}
    if any(fields[key] != value for key, value in required.items()):
        raise ProbeConfigError()
    if not _PUBLIC_KEY.fullmatch(fields["pbk"]) or not _SHORT_ID.fullmatch(fields["sid"]) or len(fields["sid"]) % 2:
        raise ProbeConfigError()
    return {"host": host, "port": port, "id": client_id, "sni": _host(fields["sni"]),
            "publicKey": fields["pbk"], "shortId": fields["sid"].lower()}


def parse_hysteria_uri(uri: str, *, expected_host: str) -> dict:
    parts, fields, host, port = _uri(uri, "hy2", expected_host,
                                     frozenset({"obfs", "obfs-password", "sni"}))
    user = unquote(parts.username or "")
    password = unquote(parts.password or "")
    obfs_password = fields["obfs-password"]
    if port != 443 or parts.path not in {"", "/"} or fields["obfs"] != "salamander":
        raise ProbeConfigError()
    if not _CLIENT_ID.fullmatch(user) or not 8 <= len(password) <= 128 or not 8 <= len(obfs_password) <= 128:
        raise ProbeConfigError()
    if any(ord(ch) < 33 or ord(ch) > 126 for ch in password + obfs_password):
        raise ProbeConfigError()
    sni = _host(fields["sni"])
    if sni != host:
        raise ProbeConfigError()
    return {"host": host, "port": port, "auth": f"{user}:{password}", "sni": sni,
            "obfsPassword": obfs_password}


def _local_port(value: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 1024 <= value <= 65535:
        raise ProbeConfigError()
    return value


def build_xray_client_config(parsed: dict, local_port: int) -> dict:
    port = _local_port(local_port)
    return {"log": {"loglevel": "none"},
            "inbounds": [{"listen": "127.0.0.1", "port": port, "protocol": "socks", "settings": {"udp": False}}],
            "outbounds": [{"protocol": "vless", "settings": {"vnext": [{"address": parsed["host"],
                "port": parsed["port"], "users": [{"id": parsed["id"], "encryption": "none", "flow": "xtls-rprx-vision"}]}]},
                "streamSettings": {"network": "raw", "security": "reality", "realitySettings": {
                    "fingerprint": "chrome", "serverName": parsed["sni"], "publicKey": parsed["publicKey"],
                    "shortId": parsed["shortId"]}}}]}


def build_hysteria_client_config(parsed: dict, local_port: int) -> dict:
    port = _local_port(local_port)
    return {"server": f'{parsed["host"]}:{parsed["port"]}', "auth": parsed["auth"],
            "tls": {"sni": parsed["sni"]},
            "obfs": {"type": "salamander", "salamander": {"password": parsed["obfsPassword"]}},
            "socks5": {"listen": f"127.0.0.1:{port}", "disableUDP": True}}


def validate_probe_result(value: object, expected_target: str, now: datetime) -> dict:
    if expected_target not in {"de", "nl"} or not isinstance(value, dict):
        raise ProbeConfigError()
    try:
        size = len(json.dumps(value))
    except (TypeError, ValueError):
        raise ProbeConfigError() from None
    if size > 4096 or set(value) != {"version", "targetNode", "sampledAt", "checks"}:
        raise ProbeConfigError()
    if type(value["version"]) is not int or value["version"] != 1 or value["targetNode"] != expected_target:
        raise ProbeConfigError()
    try:
        sampled = datetime.fromisoformat(value["sampledAt"].replace("Z", "+00:00"))
    except (ValueError, AttributeError, TypeError):
        raise ProbeConfigError() from None
    if sampled.tzinfo is None or sampled < now - timedelta(minutes=5) or sampled > now + timedelta(seconds=30):
        raise ProbeConfigError()
    checks = value["checks"]
    if not isinstance(checks, dict) or set(checks) != CHECK_NAMES:
        raise ProbeConfigError()
    for item in checks.values():
        if not isinstance(item, dict) or set(item) != {"status", "failureCode"}:
            raise ProbeConfigError()
        status, code = item["status"], item["failureCode"]
        if not isinstance(status, str) or status not in {"healthy", "failed", "unknown"}:
            raise ProbeConfigError()
        if code is not None and (not isinstance(code, str) or code not in FAILURE_CODES):
            raise ProbeConfigError()
        if (status == "healthy") != (code is None):
            raise ProbeConfigError()
    return {"version": 1, "targetNode": expected_target, "sampledAt": sampled.astimezone(timezone.utc).isoformat(),
            "checks": {name: dict(checks[name]) for name in sorted(CHECK_NAMES)}}


def read_probe_result(target: str, *, root: Path = Path("/var/lib/jarvis-vpn-probe"),
                      now: datetime | None = None) -> dict:
    if target not in {"de", "nl"}:
        raise ProbeConfigError()
    moment = now or datetime.now(timezone.utc)
    try:
        descriptor = os.open(root / f"{target}.json", os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > 4096:
                raise ProbeConfigError()
            raw = handle.read(4097)
            if len(raw) > 4096:
                raise ProbeConfigError()
        return validate_probe_result(json.loads(raw), target, moment)
    except (OSError, ValueError, UnicodeError, TypeError):
        checks = {name: {"status": "unknown", "failureCode": "RUNNER_UNAVAILABLE"}
                  for name in sorted(CHECK_NAMES)}
        return {"version": 1, "targetNode": target, "sampledAt": moment.isoformat(), "checks": checks}
