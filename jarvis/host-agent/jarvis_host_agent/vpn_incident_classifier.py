"""Pure, deterministic VPN incident classification.

Only closed status values and evidence paths may enter the result. The module
performs no I/O and deliberately does not expose probe error text or state.
"""

from __future__ import annotations

from typing import Any, Mapping


STATUSES = frozenset(("healthy", "degraded", "unavailable", "unknown"))
FAILED_STATUSES = frozenset(("degraded", "unavailable"))

EVIDENCE_PATHS = frozenset((
    "host",
    "network.dns",
    "network.outbound",
    "xray.service",
    "xray.config",
    "xray.listener",
    "xray.protocolProbe",
    "hysteria2.service",
    "hysteria2.config",
    "hysteria2.listener",
    "hysteria2.auth",
    "hysteria2.authEndpoint",
    "hysteria2.authCredentialProbe",
    "hysteria2.protocolProbe",
))

NEXT_CHECKS = frozenset((
    "host_resources",
    "host_dns_probe",
    "host_outbound_probe",
    "xray_config_test",
    "xray_service_status",
    "xray_listener_probe",
    "hysteria2_config_test",
    "hysteria2_service_status",
    "hysteria2_listener_probe",
    "host_agent_status",
    "hysteria_auth_endpoint_probe",
    "hysteria_auth_credential_probe",
    "vpn_snapshot_repeat",
))

INCIDENTS = {
    "VPN_SNAPSHOT_INVALID": ("vpn.snapshot_invalid", "host", "warning", "low", "snapshot_contract", ("vpn_snapshot_repeat",)),
    "HOST_UNAVAILABLE": ("vpn.host_unavailable", "host", "critical", "high", "host_probe", ("host_resources",)),
    "HOST_DNS_FAILURE": ("vpn.host_dns_failure", "host", "error", "high", "host_dns", ("host_dns_probe",)),
    "HOST_OUTBOUND_FAILURE": ("vpn.host_outbound_failure", "host", "error", "high", "host_outbound", ("host_outbound_probe",)),
    "XRAY_CONFIG_FAILURE": ("vpn.xray.config_failure", "xray", "error", "high", "xray_config", ("xray_config_test",)),
    "XRAY_SERVICE_FAILURE": ("vpn.xray.service_failure", "xray", "error", "high", "xray_service", ("xray_service_status",)),
    "XRAY_LISTENER_FAILURE": ("vpn.xray.listener_failure", "xray", "error", "high", "xray_listener", ("xray_listener_probe",)),
    "HYSTERIA2_CONFIG_FAILURE": ("vpn.hysteria2.config_failure", "hysteria2", "error", "high", "hysteria2_config", ("hysteria2_config_test",)),
    "HYSTERIA2_SERVICE_FAILURE": ("vpn.hysteria2.service_failure", "hysteria2", "error", "high", "hysteria2_service", ("hysteria2_service_status",)),
    "HYSTERIA2_LISTENER_FAILURE": ("vpn.hysteria2.listener_failure", "hysteria2", "error", "high", "hysteria2_listener", ("hysteria2_listener_probe",)),
    "HYSTERIA2_AUTH_ENDPOINT_FAILURE": ("vpn.hysteria2.auth_endpoint_failure", "hysteria2", "error", "high", "host_agent_auth_dependency", ("host_agent_status", "hysteria_auth_endpoint_probe")),
    "HYSTERIA2_AUTH_CREDENTIAL_FAILURE": ("vpn.hysteria2.auth_credential_failure", "hysteria2", "error", "high", "hysteria_auth_credential", ("hysteria_auth_credential_probe",)),
    "VPN_MULTI_STACK_FAILURE": ("vpn.multi_stack_failure", "multi", "critical", "high", "multi_stack_local_failure", ("xray_service_status", "hysteria2_service_status")),
    "UNKNOWN_VPN_FAILURE": ("vpn.unknown_failure", "multi", "warning", "low", "insufficient_evidence", ("vpn_snapshot_repeat",)),
}


def _secondary_signals(snapshot: Mapping[str, Any] | None) -> list[dict[str, str]]:
    if not isinstance(snapshot, Mapping):
        return []
    signals: list[dict[str, str]] = []
    xray = snapshot.get("xray")
    hysteria2 = snapshot.get("hysteria2")
    if isinstance(xray, Mapping) and xray.get("protocolProbe") == "unknown":
        signals.append({"code": "XRAY_PROTOCOL_UNVERIFIED", "severity": "info"})
    if isinstance(hysteria2, Mapping) and hysteria2.get("protocolProbe") == "unknown":
        signals.append({"code": "HYSTERIA2_PROTOCOL_UNVERIFIED", "severity": "info"})
    return signals


def _evidence(snapshot: Mapping[str, Any], paths: tuple[str, ...]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for path in paths[:12]:
        if path not in EVIDENCE_PATHS:
            continue
        current: Any = snapshot
        for part in path.split("."):
            if not isinstance(current, Mapping) or part not in current:
                current = None
                break
            current = current[part]
        if current in STATUSES:
            result.append({"path": path, "status": current})
    return result


def _primary(code: str, snapshot: Mapping[str, Any], paths: tuple[str, ...]) -> dict[str, Any]:
    failure_kind, scope, severity, confidence, likely_cause, checks = INCIDENTS[code]
    return {
        "code": code,
        "failureKind": failure_kind,
        "severity": severity,
        "scope": scope,
        "confidence": confidence,
        "likelyCause": likely_cause,
        "evidence": _evidence(snapshot, paths),
        "safeNextChecks": list(checks),
    }


def _invalid(snapshot: Mapping[str, Any] | None = None) -> dict[str, Any]:
    safe_snapshot = snapshot if isinstance(snapshot, Mapping) else {}
    return {
        "version": 1,
        "state": "incident",
        "primary": _primary("VPN_SNAPSHOT_INVALID", safe_snapshot, ()),
        "secondarySignals": _secondary_signals(safe_snapshot),
    }


def _valid_snapshot(value: Any) -> bool:
    if not isinstance(value, Mapping) or set(value) != {"host", "network", "xray", "hysteria2"}:
        return False
    if value.get("host") not in STATUSES:
        return False
    expected = {
        "network": {"dns", "outbound"},
        "xray": {"service", "config", "listener", "protocolProbe"},
        "hysteria2": {"service", "config", "listener", "auth", "authEndpoint", "authCredentialProbe", "protocolProbe"},
    }
    for section, keys in expected.items():
        content = value.get(section)
        if not isinstance(content, Mapping) or set(content) != keys:
            return False
        if any(content.get(key) not in STATUSES for key in keys):
            return False
    return True


def _failed(status: str) -> bool:
    return status in FAILED_STATUSES


def _xray_failure(snapshot: Mapping[str, Any]) -> tuple[str, tuple[str, ...]] | None:
    xray = snapshot["xray"]
    context = ("xray.config", "xray.service", "xray.listener")
    if _failed(xray["config"]):
        return "XRAY_CONFIG_FAILURE", context
    if _failed(xray["service"]):
        return "XRAY_SERVICE_FAILURE", context
    if _failed(xray["listener"]):
        return "XRAY_LISTENER_FAILURE", context
    return None


def _hysteria2_failure(snapshot: Mapping[str, Any]) -> tuple[str, tuple[str, ...]] | None:
    hysteria2 = snapshot["hysteria2"]
    local = ("hysteria2.config", "hysteria2.service", "hysteria2.listener")
    auth = ("hysteria2.service", "hysteria2.listener", "hysteria2.auth", "hysteria2.authEndpoint", "hysteria2.authCredentialProbe")
    if _failed(hysteria2["config"]):
        return "HYSTERIA2_CONFIG_FAILURE", local
    if _failed(hysteria2["service"]):
        return "HYSTERIA2_SERVICE_FAILURE", local
    if _failed(hysteria2["authEndpoint"]):
        return "HYSTERIA2_AUTH_ENDPOINT_FAILURE", auth
    if _failed(hysteria2["authCredentialProbe"]):
        return "HYSTERIA2_AUTH_CREDENTIAL_FAILURE", auth
    if _failed(hysteria2["listener"]):
        return "HYSTERIA2_LISTENER_FAILURE", local
    if _failed(hysteria2["auth"]):
        return "UNKNOWN_VPN_FAILURE", auth
    return None


def classify_vpn_incident(snapshot: Any) -> dict[str, Any]:
    """Return one bounded primary diagnosis plus informational signals."""
    if not _valid_snapshot(snapshot):
        return _invalid(snapshot if isinstance(snapshot, Mapping) else None)

    signals = _secondary_signals(snapshot)
    if snapshot["host"] in FAILED_STATUSES:
        result = _primary("HOST_UNAVAILABLE", snapshot, ("host",))
        if snapshot["host"] == "degraded":
            result["severity"] = "warning"
            result["confidence"] = "medium"
        return {"version": 1, "state": "incident", "primary": result, "secondarySignals": signals}

    xray_failure = _xray_failure(snapshot)
    hysteria2_failure = _hysteria2_failure(snapshot)
    if xray_failure and hysteria2_failure:
        paths = tuple(dict.fromkeys(xray_failure[1] + hysteria2_failure[1]))
        result = _primary("VPN_MULTI_STACK_FAILURE", snapshot, paths)
        return {"version": 1, "state": "incident", "primary": result, "secondarySignals": signals}
    if xray_failure:
        result = _primary(xray_failure[0], snapshot, xray_failure[1])
        return {"version": 1, "state": "incident", "primary": result, "secondarySignals": signals}
    if hysteria2_failure:
        result = _primary(hysteria2_failure[0], snapshot, hysteria2_failure[1])
        return {"version": 1, "state": "incident", "primary": result, "secondarySignals": signals}

    if _failed(snapshot["network"]["dns"]):
        result = _primary("HOST_DNS_FAILURE", snapshot, ("network.dns", "network.outbound"))
        if snapshot["network"]["dns"] == "degraded":
            result["severity"] = "warning"
            result["confidence"] = "medium"
        return {"version": 1, "state": "incident", "primary": result, "secondarySignals": signals}
    if _failed(snapshot["network"]["outbound"]):
        result = _primary("HOST_OUTBOUND_FAILURE", snapshot, ("network.dns", "network.outbound"))
        if snapshot["network"]["outbound"] == "degraded":
            result["severity"] = "warning"
            result["confidence"] = "medium"
        return {"version": 1, "state": "incident", "primary": result, "secondarySignals": signals}

    required = (
        snapshot["host"], snapshot["network"]["dns"], snapshot["network"]["outbound"],
        snapshot["xray"]["service"], snapshot["xray"]["config"], snapshot["xray"]["listener"],
        snapshot["hysteria2"]["service"], snapshot["hysteria2"]["config"], snapshot["hysteria2"]["listener"],
        snapshot["hysteria2"]["auth"], snapshot["hysteria2"]["authEndpoint"],
    )
    credential = snapshot["hysteria2"]["authCredentialProbe"]
    protocol_failure = any(snapshot[section]["protocolProbe"] in FAILED_STATUSES for section in ("xray", "hysteria2"))
    if any(status == "unknown" for status in required) or credential not in {"healthy", "unknown"} or protocol_failure:
        result = _primary("UNKNOWN_VPN_FAILURE", snapshot, (
            "host", "network.dns", "network.outbound", "xray.service", "xray.config", "xray.listener",
            "hysteria2.service", "hysteria2.config", "hysteria2.listener", "hysteria2.auth",
            "hysteria2.authEndpoint", "hysteria2.authCredentialProbe",
        ))
        return {"version": 1, "state": "incident", "primary": result, "secondarySignals": signals}

    return {"version": 1, "state": "healthy", "primary": None, "secondarySignals": signals}


__all__ = ["classify_vpn_incident"]
