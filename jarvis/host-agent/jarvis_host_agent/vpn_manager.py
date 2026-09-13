"""Root-owned Xray VPN lifecycle with a closed, validated state model."""

from __future__ import annotations

import copy
import ipaddress
import json
import os
import re
import secrets
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote


DEFAULT_STATE_PATH = Path("/etc/jarvis-vpn/state.json")
DEFAULT_CONFIG_PATH = Path("/etc/xray/config.json")
DEFAULT_XRAY_BIN = "/usr/local/bin/xray"
DEFAULT_SERVICE = "xray.service"
MAX_CLIENTS = 50
CLIENT_ID_RE = re.compile(r"^vpn-[a-f0-9]{12}$")
LABEL_RE = re.compile(r"^[A-Za-zА-Яа-яЁё0-9_. -]{1,40}$")
KEY_RE = re.compile(r"^[A-Za-z0-9_-]{40,64}$")
SHORT_ID_RE = re.compile(r"^[a-f0-9]{16}$")
HOST_RE = re.compile(r"^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")


class VpnManagerError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _valid_host(value: Any) -> bool:
    if not isinstance(value, str) or not value or len(value) > 253:
        return False
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return bool(HOST_RE.fullmatch(value))


def validate_label(value: Any) -> str:
    if not isinstance(value, str):
        raise VpnManagerError("VPN_LABEL_INVALID")
    label = value.strip()
    if not LABEL_RE.fullmatch(label) or ".." in label:
        raise VpnManagerError("VPN_LABEL_INVALID")
    return label


def validate_client_id(value: Any) -> str:
    if not isinstance(value, str) or not CLIENT_ID_RE.fullmatch(value):
        raise VpnManagerError("VPN_CLIENT_ID_INVALID")
    return value


def validate_state(value: Any) -> dict[str, Any]:
    required_keys = {"version", "address", "port", "serverName", "privateKey", "publicKey", "clients"}
    allowed_keys = required_keys | {"alternativePort"}
    if not isinstance(value, dict) or not required_keys.issubset(value) or not set(value).issubset(allowed_keys):
        raise VpnManagerError("VPN_STATE_INVALID")
    if value["version"] != 1 or not _valid_host(value["address"]):
        raise VpnManagerError("VPN_STATE_INVALID")
    if type(value["port"]) is not int or not 1 <= value["port"] <= 65535:
        raise VpnManagerError("VPN_STATE_INVALID")
    alternative_port = value.get("alternativePort")
    if alternative_port is not None and (
        type(alternative_port) is not int or not 1 <= alternative_port <= 65535 or alternative_port == value["port"]
    ):
        raise VpnManagerError("VPN_STATE_INVALID")
    if not _valid_host(value["serverName"]):
        raise VpnManagerError("VPN_STATE_INVALID")
    if not KEY_RE.fullmatch(str(value["privateKey"])) or not KEY_RE.fullmatch(str(value["publicKey"])):
        raise VpnManagerError("VPN_STATE_INVALID")
    clients = value["clients"]
    if not isinstance(clients, list) or len(clients) > MAX_CLIENTS:
        raise VpnManagerError("VPN_STATE_INVALID")
    seen_ids: set[str] = set()
    seen_uuids: set[str] = set()
    seen_short_ids: set[str] = set()
    normalized_clients = []
    for client in clients:
        if not isinstance(client, dict) or set(client) != {"id", "label", "uuid", "shortId", "createdAt"}:
            raise VpnManagerError("VPN_STATE_INVALID")
        client_id = validate_client_id(client["id"])
        label = validate_label(client["label"])
        try:
            client_uuid = str(uuid.UUID(str(client["uuid"])))
        except (ValueError, AttributeError) as exc:
            raise VpnManagerError("VPN_STATE_INVALID") from exc
        short_id = str(client["shortId"])
        if not SHORT_ID_RE.fullmatch(short_id) or not isinstance(client["createdAt"], str) or len(client["createdAt"]) > 40:
            raise VpnManagerError("VPN_STATE_INVALID")
        if client_id in seen_ids or client_uuid in seen_uuids or short_id in seen_short_ids:
            raise VpnManagerError("VPN_STATE_INVALID")
        seen_ids.add(client_id)
        seen_uuids.add(client_uuid)
        seen_short_ids.add(short_id)
        normalized_clients.append({**client, "id": client_id, "label": label, "uuid": client_uuid, "shortId": short_id})
    return {**value, "clients": normalized_clients}


def xray_config(state: dict[str, Any]) -> dict[str, Any]:
    state = validate_state(state)
    ports = [state["port"]] + ([state["alternativePort"]] if state.get("alternativePort") else [])
    inbounds = []
    for port in ports:
        inbounds.append({
            "tag": f"vless-reality-{port}",
            "listen": "0.0.0.0",
            "port": port,
            "protocol": "vless",
            "settings": {
                "clients": [{"id": client["uuid"], "email": client["id"], "flow": "xtls-rprx-vision"} for client in state["clients"]],
                "decryption": "none",
            },
            "streamSettings": {
                "network": "raw",
                "security": "reality",
                "realitySettings": {
                    "show": False,
                    "target": f'{state["serverName"]}:443',
                    "xver": 0,
                    "serverNames": [state["serverName"]],
                    "privateKey": state["privateKey"],
                    "shortIds": [client["shortId"] for client in state["clients"]],
                },
            },
            "sniffing": {"enabled": True, "destOverride": ["http", "tls", "quic"], "routeOnly": True},
        })
    return {
        "log": {"loglevel": "warning", "access": "none", "dnsLog": False},
        "stats": {},
        "policy": {"levels": {"0": {"statsUserUplink": True, "statsUserDownlink": True}}},
        "inbounds": inbounds,
        "outbounds": [
            {"tag": "direct", "protocol": "freedom"},
            {"tag": "blocked", "protocol": "blackhole"},
        ],
        "routing": {
            "domainStrategy": "IPIfNonMatch",
            "rules": [
                {"type": "field", "ip": ["geoip:private"], "outboundTag": "blocked"},
                {"type": "field", "protocol": ["bittorrent"], "outboundTag": "blocked"},
            ],
        },
    }


class XrayVpnManager:
    def __init__(
        self,
        run: Callable[..., dict[str, Any]],
        state_path: Path = DEFAULT_STATE_PATH,
        config_path: Path = DEFAULT_CONFIG_PATH,
        xray_bin: str = DEFAULT_XRAY_BIN,
        service: str = DEFAULT_SERVICE,
    ) -> None:
        self.run = run
        self.state_path = Path(state_path)
        self.config_path = Path(config_path)
        self.xray_bin = xray_bin
        self.service = service

    def _read_state(self) -> dict[str, Any]:
        try:
            return validate_state(json.loads(self.state_path.read_text(encoding="utf-8")))
        except VpnManagerError:
            raise
        except (OSError, json.JSONDecodeError) as exc:
            raise VpnManagerError("VPN_STATE_UNAVAILABLE") from exc

    @staticmethod
    def _write_atomic(path: Path, value: bytes, mode: int = 0o600, group_from_parent: bool = False) -> None:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(value)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, mode)
            if group_from_parent and os.name != "nt" and os.geteuid() == 0:
                os.chown(temporary, 0, path.parent.stat().st_gid)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def _apply(self, state: dict[str, Any]) -> None:
        state = validate_state(state)
        previous_state = self.state_path.read_bytes() if self.state_path.exists() else None
        previous_config = self.config_path.read_bytes() if self.config_path.exists() else None
        state_bytes = (json.dumps(state, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        config_bytes = (json.dumps(xray_config(state), ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        try:
            self._write_atomic(self.state_path, state_bytes)
            self._write_atomic(self.config_path, config_bytes, mode=0o640, group_from_parent=True)
            checked = self.run([self.xray_bin, "run", "-test", "-c", str(self.config_path)], timeout=30)
            if checked.get("state") != "succeeded":
                raise VpnManagerError("VPN_CONFIG_REJECTED")
            restarted = self.run(["/usr/bin/systemctl", "restart", self.service], timeout=45)
            if restarted.get("state") != "succeeded":
                raise VpnManagerError("VPN_RESTART_FAILED")
            active = self.run(["/usr/bin/systemctl", "is-active", self.service], timeout=15)
            if active.get("state") != "succeeded" or active.get("data", {}).get("output", "").strip() != "active":
                raise VpnManagerError("VPN_HEALTH_FAILED")
        except (OSError, VpnManagerError) as exc:
            try:
                if previous_state is None:
                    self.state_path.unlink(missing_ok=True)
                else:
                    self._write_atomic(self.state_path, previous_state)
                if previous_config is None:
                    self.config_path.unlink(missing_ok=True)
                else:
                    self._write_atomic(self.config_path, previous_config, mode=0o640, group_from_parent=True)
                if previous_config is not None:
                    self.run(["/usr/bin/systemctl", "restart", self.service], timeout=45)
            except OSError:
                raise VpnManagerError("VPN_ROLLBACK_FAILED") from exc
            if isinstance(exc, VpnManagerError):
                raise
            raise VpnManagerError("VPN_WRITE_FAILED") from exc

    @staticmethod
    def _public_client(client: dict[str, Any]) -> dict[str, Any]:
        return {"id": client["id"], "label": client["label"], "createdAt": client["createdAt"]}

    @staticmethod
    def _new_client(label: str) -> dict[str, Any]:
        return {
            "id": f"vpn-{secrets.token_hex(6)}",
            "label": validate_label(label),
            "uuid": str(uuid.uuid4()),
            "shortId": secrets.token_hex(8),
            "createdAt": utc_now(),
        }

    @staticmethod
    def _find(state: dict[str, Any], client_id: str) -> dict[str, Any]:
        client_id = validate_client_id(client_id)
        client = next((item for item in state["clients"] if item["id"] == client_id), None)
        if not client:
            raise VpnManagerError("VPN_CLIENT_NOT_FOUND")
        return client

    @staticmethod
    def share_uri(state: dict[str, Any], client: dict[str, Any]) -> str:
        port = state.get("alternativePort") or state["port"]
        fragment = quote("1-10,5-20,tlshello", safe="")
        query = (
            "encryption=none&flow=xtls-rprx-vision&security=reality&headerType=none"
            f'&sni={quote(state["serverName"], safe="")}&fp=chrome'
            f'&pbk={quote(state["publicKey"], safe="")}&sid={client["shortId"]}&type=tcp'
            f'&xtls=2&fragment={fragment}'
        )
        return f'vless://{client["uuid"]}@{state["address"]}:{port}?{query}#{quote(client["label"], safe="")}'

    def status(self) -> dict[str, Any]:
        try:
            state = self._read_state()
            checked = self.run([self.xray_bin, "run", "-test", "-c", str(self.config_path)], timeout=30)
            active = self.run(["/usr/bin/systemctl", "is-active", self.service], timeout=15)
            ports = [state["port"]] + ([state["alternativePort"]] if state.get("alternativePort") else [])
            listener = self.run(["/usr/bin/ss", "-lnt"], timeout=15)
            listener_output = listener.get("data", {}).get("output", "")
            return {
                "serviceState": "active" if active.get("state") == "succeeded" and active.get("data", {}).get("output", "").strip() == "active" else "unavailable",
                "configValid": checked.get("state") == "succeeded",
                "listenerReady": listener.get("state") == "succeeded" and all(f':{port}' in listener_output for port in ports),
                "clientCount": len(state["clients"]),
            }
        except VpnManagerError:
            return {"serviceState": "unavailable", "configValid": False, "listenerReady": False, "clientCount": 0}

    def clients(self) -> list[dict[str, Any]]:
        return [self._public_client(client) for client in self._read_state()["clients"]]

    def issue(self, label: str) -> dict[str, Any]:
        state = self._read_state()
        if len(state["clients"]) >= MAX_CLIENTS:
            raise VpnManagerError("VPN_CLIENT_LIMIT")
        label = validate_label(label)
        if any(client["label"].casefold() == label.casefold() for client in state["clients"]):
            raise VpnManagerError("VPN_CLIENT_LABEL_EXISTS")
        client = self._new_client(label)
        updated = copy.deepcopy(state)
        updated["clients"].append(client)
        self._apply(updated)
        return {"client": self._public_client(client), "shareUri": self.share_uri(updated, client)}

    def revoke(self, client_id: str) -> dict[str, Any]:
        state = self._read_state()
        client = self._find(state, client_id)
        updated = copy.deepcopy(state)
        updated["clients"] = [item for item in updated["clients"] if item["id"] != client["id"]]
        self._apply(updated)
        return {"client": self._public_client(client)}

    def rotate(self, client_id: str) -> dict[str, Any]:
        state = self._read_state()
        current = self._find(state, client_id)
        replacement = self._new_client(current["label"])
        replacement["id"] = current["id"]
        updated = copy.deepcopy(state)
        updated["clients"] = [replacement if item["id"] == current["id"] else item for item in updated["clients"]]
        self._apply(updated)
        return {"client": self._public_client(replacement), "shareUri": self.share_uri(updated, replacement)}

    def export(self, client_id: str) -> dict[str, Any]:
        state = self._read_state()
        client = self._find(state, client_id)
        return {"client": self._public_client(client), "shareUri": self.share_uri(state, client)}

    def restart(self) -> dict[str, Any]:
        state = self._read_state()
        checked = self.run([self.xray_bin, "run", "-test", "-c", str(self.config_path)], timeout=30)
        if checked.get("state") != "succeeded":
            raise VpnManagerError("VPN_CONFIG_REJECTED")
        restarted = self.run(["/usr/bin/systemctl", "restart", self.service], timeout=45)
        if restarted.get("state") != "succeeded":
            raise VpnManagerError("VPN_RESTART_FAILED")
        return {"clientCount": len(state["clients"])}

    def execute(self, operation: str, arguments: dict[str, Any]) -> dict[str, Any]:
        try:
            if operation == "vpn.status":
                data = self.status()
            elif operation == "vpn.clients.list":
                data = {"clients": self.clients()}
            elif operation == "vpn.client.issue":
                data = self.issue(arguments["label"])
            elif operation == "vpn.client.revoke":
                data = self.revoke(arguments["clientId"])
            elif operation == "vpn.client.rotate":
                data = self.rotate(arguments["clientId"])
            elif operation == "vpn.client.export":
                data = self.export(arguments["clientId"])
            elif operation == "vpn.restart":
                data = self.restart()
            else:
                raise VpnManagerError("VPN_OPERATION_UNSUPPORTED")
            return {"state": "succeeded", "data": data}
        except VpnManagerError as exc:
            return {"state": "failed", "errorCode": exc.code}
