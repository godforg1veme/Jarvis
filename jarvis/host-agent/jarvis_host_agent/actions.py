"""Fixed Host Agent operations. No caller-provided executable, unit, or shell."""

from __future__ import annotations

import json
import os
import subprocess
import time
import threading
from pathlib import Path
from typing import Any

from .config import HostAgentConfig
from .backup_status import read_backup_status
from .host_metrics import extra_metrics
from .protocol import ProtocolError

MAX_OUTPUT_BYTES = 32 * 1024


def _run(args: list[str], timeout: int = 15) -> dict[str, Any]:
    captured = bytearray()
    process = None
    try:
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, shell=False)
        def drain():
            try:
                while True:
                    chunk = process.stdout.read(4096)
                    if not chunk:
                        break
                    if len(captured) < MAX_OUTPUT_BYTES:
                        captured.extend(chunk[:MAX_OUTPUT_BYTES - len(captured)])
            finally:
                process.stdout.close()
        reader = threading.Thread(target=drain, daemon=True)
        reader.start()
        returncode = process.wait(timeout=timeout)
        reader.join(timeout=1)
    except (OSError, subprocess.TimeoutExpired):
        if process is not None:
            process.kill()
            process.wait()
        return {"state": "unknown", "errorCode": "COMMAND_UNAVAILABLE"}
    output = bytes(captured).decode("utf-8", "replace")
    if returncode != 0:
        return {"state": "failed", "errorCode": "COMMAND_FAILED", "data": {"output": output}}
    return {"state": "succeeded", "data": {"output": output}}


def _service_action(config: HostAgentConfig, operation: str, arguments: dict[str, Any]) -> dict[str, Any]:
    service = config.managed_services.get(arguments["serviceId"])
    action = operation.rsplit(".", 1)[-1]
    if not service or action not in service.actions:
        return {"state": "failed", "errorCode": "SERVICE_ACTION_UNDECLARED"}
    if service.source_type == "systemd":
        return _run(["/usr/bin/systemctl", action, service.target], timeout=45)
    return _run(["/usr/bin/docker", action, service.target], timeout=45)


def _parse_properties(output: str) -> dict[str, str]:
    properties: dict[str, str] = {}
    for line in output.splitlines():
        key, separator, value = line.partition("=")
        if separator:
            properties[key] = value
    return properties


def _systemd_snapshot(service: Any) -> dict[str, Any]:
    result = _run(["/usr/bin/systemctl", "show", service.target, "--property=ActiveState,SubState,Result,ExecMainStatus", "--no-pager"], timeout=15)
    if result["state"] != "succeeded":
        return {"id": service.service_id, "sourceType": "systemd", "sourceState": "unavailable", "healthState": "unavailable", "detail": "unit unavailable"}
    properties = _parse_properties(result.get("data", {}).get("output", ""))
    active = properties.get("ActiveState", "unknown")
    source_state = active if active in {"active", "inactive", "failed"} else "unknown"
    if active == "active":
        health_state = "healthy"
    elif active in {"activating", "deactivating", "reloading"}:
        health_state = "degraded"
    else:
        health_state = "unavailable"
    return {"id": service.service_id, "sourceType": "systemd", "sourceState": source_state, "healthState": health_state, "detail": properties.get("SubState", "unknown")[:120]}


def _docker_snapshot(service: Any) -> dict[str, Any]:
    result = _run(["/usr/bin/docker", "inspect", "--format={{json .State}}", service.target], timeout=15)
    if result["state"] != "succeeded":
        return {"id": service.service_id, "sourceType": "docker", "sourceState": "unavailable", "healthState": "unavailable", "detail": "container unavailable"}
    try:
        state = json.loads(result.get("data", {}).get("output", ""))
    except (TypeError, json.JSONDecodeError):
        return {"id": service.service_id, "sourceType": "docker", "sourceState": "unknown", "healthState": "unknown", "detail": "invalid container state"}
    status = str(state.get("Status", "unknown"))
    health = str((state.get("Health") or {}).get("Status", ""))
    source_state = "active" if status == "running" else "failed" if status in {"dead", "exited"} else "inactive" if status in {"created", "paused", "restarting", "removing"} else "unknown"
    if status != "running":
        health_state = "unavailable"
    elif health in {"unhealthy", "starting"}:
        health_state = "degraded"
    else:
        health_state = "healthy"
    return {"id": service.service_id, "sourceType": "docker", "sourceState": source_state, "healthState": health_state, "detail": (health or status)[:120]}


def _service_snapshot(service: Any) -> dict[str, Any]:
    return _systemd_snapshot(service) if service.source_type == "systemd" else _docker_snapshot(service)


def execute(config: HostAgentConfig, operation: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if operation == 'inventory.snapshot':
        items = []
        unavailable = []
        docker = _run(['/usr/bin/docker', 'ps', '--all', '--format', '{"name":{{json .Names}},"state":{{json .State}}}'])
        units = _run(['/usr/bin/systemctl', 'list-units', '--type=service', '--all', '--output=json', '--no-pager', 'jarvis*', 'tg-*', 'xray*', 'docker*', 'postgresql*', 'cloudflared*'])
        for kind, response in [('docker', docker), ('systemd', units)]:
            try:
                if response['state'] != 'succeeded':
                    raise ValueError('unavailable')
                raw = response.get('data', {}).get('output', '')
                rows = [json.loads(line) for line in raw.splitlines() if line] if kind == 'docker' else json.loads(raw)
                for row in rows[:50]:
                    name = str(row.get('name') if kind == 'docker' else row.get('unit', ''))[:160]
                    state = str(row.get('state') if kind == 'docker' else row.get('active', 'unknown'))[:40]
                    items.append({'name': name, 'type': kind, 'state': state})
            except (ValueError, TypeError, AttributeError):
                unavailable.append(kind)
        return {'state': 'succeeded', 'data': {'items': items, 'unavailable': unavailable}}
    if operation in {"service.start", "service.stop", "service.restart"}:
        return _service_action(config, operation, arguments)
    if operation == "host.snapshot":
        try:
            loadavg = Path("/proc/loadavg").read_text(encoding="utf-8").split()[:3]
            memory = Path("/proc/meminfo").read_text(encoding="utf-8").splitlines()[:6]
            disk = os.statvfs("/")
            disk_used = 0.0 if disk.f_blocks == 0 else (1 - (disk.f_bavail / disk.f_blocks)) * 100
            inode_used = 0.0 if disk.f_files == 0 else (1 - (disk.f_favail / disk.f_files)) * 100
            return {"state": "succeeded", "data": {
                "loadavg": loadavg,
                "meminfo": memory,
                "uptimeSeconds": int(time.clock_gettime(time.CLOCK_BOOTTIME)),
                "diskUsedPercent": round(max(0.0, min(100.0, disk_used)), 2),
                "inodeUsedPercent": round(max(0.0, min(100.0, inode_used)), 2),
                "diskTotalBytes": disk.f_blocks * disk.f_frsize,
                "diskFreeBytes": disk.f_bavail * disk.f_frsize,
                **extra_metrics(),
            }}
        except OSError:
            return {"state": "failed", "errorCode": "HOST_SNAPSHOT_UNAVAILABLE"}
    if operation == "services.snapshot":
        return {"state": "succeeded", "data": {"services": [_service_snapshot(service) for service in config.managed_services.values()]}}
    if operation == "service.logs.read":
        service = config.managed_services.get(arguments["serviceId"])
        if not service:
            return {"state": "failed", "errorCode": "SERVICE_UNDECLARED"}
        if service.source_type == "systemd":
            args = ["/usr/bin/journalctl", "-u", service.target, "-n", str(arguments["maxLines"]), "--no-pager", "-o", "short-iso"]
            for key, flag in (("after", "--since"), ("before", "--until")):
                if key in arguments:
                    args.extend([flag, arguments[key]])
            return _run(args, timeout=15)
        args = ["/usr/bin/docker", "logs", "--timestamps", "--tail", str(arguments["maxLines"])]
        for key, flag in (("after", "--since"), ("before", "--until")):
            if key in arguments:
                args.extend([flag, arguments[key]])
        return _run(args + [service.target], timeout=15)
    if operation == "parser.snapshot":
        service = config.managed_services.get("telegram-parser")
        if not service or service.source_type != "systemd":
            return {"state": "failed", "errorCode": "PARSER_UNDECLARED"}
        return {"state": "succeeded", "data": _systemd_snapshot(service)}
    if operation == "backup.status":
        return read_backup_status()
    if operation == "backup.run":
        return {"state": "failed", "errorCode": "BACKUP_ACTION_DISABLED"}
    raise ProtocolError("operation is unsupported")
