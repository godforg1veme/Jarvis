"""Closed, versioned Host Agent wire protocol.

The Host Agent never accepts command strings. This module validates only the
small operation manifest shared with the Fastify control plane.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Mapping

PROTOCOL_VERSION = 1
MAX_ENVELOPE_BYTES = 64 * 1024
MAX_ERROR_CODE_LENGTH = 80
REQUEST_ID_RE = re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", re.IGNORECASE)
SERVICE_ID_RE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
ERROR_CODE_RE = re.compile(r"^[A-Z0-9_]{1,80}$")

OPERATIONS = frozenset((
    "host.snapshot",
    "inventory.snapshot",
    "services.snapshot",
    "service.logs.read",
    "service.start",
    "service.stop",
    "service.restart",
    "backup.status",
    "backup.run",
    "parser.snapshot",
    "operation.status",
    "vpn.status",
    "vpn.clients.list",
    "vpn.client.issue",
    "vpn.client.revoke",
    "vpn.client.rotate",
    "vpn.client.export",
    "vpn.restart",
    "vpn.hysteria2.status",
    "vpn.hysteria2.clients.list",
    "vpn.hysteria2.client.issue",
    "vpn.hysteria2.client.revoke",
    "vpn.hysteria2.client.rotate",
    "vpn.hysteria2.client.export",
    "vpn.hysteria2.restart",
    "vpn.health.snapshot",
    "vpn.external_probe.snapshot",
    "vpn.external_probe.credential.install",
    "vpn.external_probe.run",
    "vpn.external_probe.monitor.enable",
    "vpn.external_probe.monitor.disable",
))

VPN_CLIENT_ID_RE = re.compile(r"^vpn-[a-f0-9]{12}$")
VPN_LABEL_RE = re.compile(r"^[A-Za-zА-Яа-яЁё0-9_. -]{1,40}$")


class ProtocolError(ValueError):
    """Raised for untrusted data outside the protocol contract."""


def _size(value: Any) -> int:
    try:
        return len(json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    except (TypeError, ValueError) as exc:
        raise ProtocolError("envelope is not JSON serializable") from exc


def _require_mapping(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ProtocolError(f"{name} must be an object")
    return value


def _iso_timestamp(value: Any, name: str) -> str:
    if not isinstance(value, str) or len(value) > 40:
        raise ProtocolError(f"{name} is invalid")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ProtocolError(f"{name} is invalid") from exc
    if parsed.tzinfo is None:
        raise ProtocolError(f"{name} must have an offset")
    return value


def _no_extra(value: Mapping[str, Any], allowed: set[str], name: str) -> None:
    if set(value) - allowed:
        raise ProtocolError(f"{name} contains unknown fields")


def _service_id(value: Any) -> str:
    if not isinstance(value, str) or not SERVICE_ID_RE.fullmatch(value):
        raise ProtocolError("serviceId is invalid")
    return value


def validate_arguments(operation: str, value: Any) -> dict[str, Any]:
    args = _require_mapping(value, "arguments")
    if operation in {"vpn.external_probe.snapshot", "vpn.external_probe.run", "vpn.external_probe.monitor.enable", "vpn.external_probe.monitor.disable"}:
        if operation == "vpn.external_probe.run" and "protocol" in args:
            _no_extra(args, {"targetNode", "protocol"}, "arguments")
            if args.get("protocol") not in {"vless", "hysteria2"}:
                raise ProtocolError("arguments.protocol is invalid")
            if args.get("targetNode") not in {"de", "nl"}:
                raise ProtocolError("arguments.targetNode is invalid")
            return {"targetNode": args["targetNode"], "protocol": args["protocol"]}
        _no_extra(args, {"targetNode"}, "arguments")
        if args.get("targetNode") not in {"de", "nl"}:
            raise ProtocolError("arguments.targetNode is invalid")
        return {"targetNode": args["targetNode"]}
    if operation == "vpn.external_probe.credential.install":
        _no_extra(args, {"targetNode", "protocol", "credential"}, "arguments")
        target = args.get("targetNode")
        protocol = args.get("protocol")
        credential = args.get("credential")
        if target not in {"de", "nl"} or protocol not in {"vless", "hysteria2"}:
            raise ProtocolError("probe credential arguments are invalid")
        if not isinstance(credential, str) or not 1 <= len(credential) <= 2048:
            raise ProtocolError("probe credential arguments are invalid")
        return {"targetNode": target, "protocol": protocol, "credential": credential}
    if operation in {"host.snapshot", "inventory.snapshot", "services.snapshot", "backup.status", "backup.run", "parser.snapshot", "vpn.status", "vpn.clients.list", "vpn.restart", "vpn.hysteria2.status", "vpn.hysteria2.clients.list", "vpn.hysteria2.restart", "vpn.health.snapshot"}:
        _no_extra(args, set(), "arguments")
        return {}
    if operation in {"service.start", "service.stop", "service.restart"}:
        _no_extra(args, {"serviceId"}, "arguments")
        return {"serviceId": _service_id(args.get("serviceId"))}
    if operation == "operation.status":
        _no_extra(args, {"requestId"}, "arguments")
        request_id = args.get("requestId")
        if not isinstance(request_id, str) or not REQUEST_ID_RE.fullmatch(request_id):
            raise ProtocolError("arguments.requestId is invalid")
        return {"requestId": request_id}
    if operation == "service.logs.read":
        _no_extra(args, {"serviceId", "after", "before", "maxLines"}, "arguments")
        normalized: dict[str, Any] = {"serviceId": _service_id(args.get("serviceId"))}
        for field in ("after", "before"):
            if field in args:
                normalized[field] = _iso_timestamp(args[field], f"arguments.{field}")
        max_lines = args.get("maxLines", 200)
        if not isinstance(max_lines, int) or isinstance(max_lines, bool) or not 1 <= max_lines <= 500:
            raise ProtocolError("arguments.maxLines is invalid")
        normalized["maxLines"] = max_lines
        return normalized
    if operation in {"vpn.client.issue", "vpn.hysteria2.client.issue"}:
        _no_extra(args, {"label"}, "arguments")
        label = args.get("label")
        if not isinstance(label, str):
            raise ProtocolError("arguments.label is invalid")
        label = label.strip()
        if not VPN_LABEL_RE.fullmatch(label) or ".." in label:
            raise ProtocolError("arguments.label is invalid")
        return {"label": label}
    if operation in {"vpn.client.revoke", "vpn.client.rotate", "vpn.client.export", "vpn.hysteria2.client.revoke", "vpn.hysteria2.client.rotate", "vpn.hysteria2.client.export"}:
        _no_extra(args, {"clientId"}, "arguments")
        client_id = args.get("clientId")
        if not isinstance(client_id, str) or not VPN_CLIENT_ID_RE.fullmatch(client_id):
            raise ProtocolError("arguments.clientId is invalid")
        return {"clientId": client_id}
    raise ProtocolError("operation is unsupported")


def validate_request(value: Any) -> dict[str, Any]:
    if _size(value) > MAX_ENVELOPE_BYTES:
        raise ProtocolError("envelope is too large")
    request = _require_mapping(value, "request")
    _no_extra(request, {"version", "requestId", "operation", "arguments", "sentAt"}, "request")
    if type(request.get("version")) is not int or request.get("version") != PROTOCOL_VERSION:
        raise ProtocolError("protocol version is unsupported")
    request_id = request.get("requestId")
    if not isinstance(request_id, str) or not REQUEST_ID_RE.fullmatch(request_id):
        raise ProtocolError("requestId is invalid")
    operation = request.get("operation")
    if operation not in OPERATIONS:
        raise ProtocolError("operation is unsupported")
    return {
        "version": PROTOCOL_VERSION,
        "requestId": request_id,
        "operation": operation,
        "arguments": validate_arguments(operation, request.get("arguments")),
        "sentAt": _iso_timestamp(request.get("sentAt"), "sentAt"),
    }


def validate_response(value: Any, request: Mapping[str, Any] | None = None) -> dict[str, Any]:
    if _size(value) > MAX_ENVELOPE_BYTES:
        raise ProtocolError("envelope is too large")
    response = _require_mapping(value, "response")
    _no_extra(response, {"version", "requestId", "operation", "receivedAt", "completedAt", "result"}, "response")
    if type(response.get("version")) is not int or response.get("version") != PROTOCOL_VERSION:
        raise ProtocolError("protocol version is unsupported")
    request_id = response.get("requestId")
    operation = response.get("operation")
    if not isinstance(request_id, str) or not REQUEST_ID_RE.fullmatch(request_id) or operation not in OPERATIONS:
        raise ProtocolError("response identifier is invalid")
    result = _require_mapping(response.get("result"), "result")
    _no_extra(result, {"state", "data", "errorCode"}, "result")
    state = result.get("state")
    if state not in {"succeeded", "failed", "unknown", "accepted"}:
        raise ProtocolError("result state is invalid")
    error_code = result.get("errorCode")
    if error_code is not None and (not isinstance(error_code, str) or not ERROR_CODE_RE.fullmatch(error_code)):
        raise ProtocolError("result errorCode is invalid")
    if state == "succeeded" and error_code is not None:
        raise ProtocolError("successful result cannot have errorCode")
    if state == "failed" and error_code is None:
        raise ProtocolError("failed result requires errorCode")
    if "data" in result and not isinstance(result["data"], Mapping):
        raise ProtocolError("result data must be an object")
    normalized = {
        "version": PROTOCOL_VERSION,
        "requestId": request_id,
        "operation": operation,
        "receivedAt": _iso_timestamp(response.get("receivedAt"), "receivedAt"),
        "completedAt": _iso_timestamp(response.get("completedAt"), "completedAt"),
        "result": {"state": state},
    }
    if "data" in result:
        normalized["result"]["data"] = dict(result["data"])
    if error_code is not None:
        normalized["result"]["errorCode"] = error_code
    if request and (request_id != request.get("requestId") or operation != request.get("operation")):
        raise ProtocolError("response does not match request")
    return normalized
