"""Root-owned Hysteria2 lifecycle isolated from the Xray VPN runtime."""

from __future__ import annotations

import asyncio
import copy
import hmac
import ipaddress
import json
import os
import re
import secrets
import tempfile
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

from .vpn_manager import CLIENT_ID_RE, MAX_CLIENTS, VpnManagerError, utc_now, validate_client_id, validate_label


DEFAULT_STATE_PATH = Path("/etc/jarvis-vpn/hysteria2-state.json")
DEFAULT_CONFIG_PATH = Path("/etc/hysteria/config.yaml")
DEFAULT_HYSTERIA_BIN = "/usr/local/bin/hysteria"
DEFAULT_SERVICE = "hysteria-server.service"
DEFAULT_AUTH_PORT = 3211
DEFAULT_AUTH_HOST = "127.0.0.1"
DEFAULT_AUTH_URL = f"http://{DEFAULT_AUTH_HOST}:{DEFAULT_AUTH_PORT}/vpn/hysteria2/auth"
HOST_RE = re.compile(r"^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")
EMAIL_RE = re.compile(r"^[^\s@]{1,64}@[^\s@]{1,190}$")
SECRET_RE = re.compile(r"^[A-Za-z0-9_-]{32,96}$")


def _valid_ip(value: Any) -> bool:
    try:
        return isinstance(value, str) and ipaddress.ip_address(value).version == 4
    except ValueError:
        return False


def _valid_host(value: Any) -> bool:
    return isinstance(value, str) and bool(HOST_RE.fullmatch(value))


def validate_hysteria_state(value: Any) -> dict[str, Any]:
    required = {"version", "address", "port", "serverName", "acmeEmail", "obfsPassword", "clients"}
    if not isinstance(value, dict) or set(value) != required or value.get("version") != 1:
        raise VpnManagerError("VPN_HYSTERIA_STATE_INVALID")
    if not _valid_ip(value.get("address")) or type(value.get("port")) is not int or not 1 <= value["port"] <= 65535:
        raise VpnManagerError("VPN_HYSTERIA_STATE_INVALID")
    if not _valid_host(value.get("serverName")) or not EMAIL_RE.fullmatch(str(value.get("acmeEmail", ""))):
        raise VpnManagerError("VPN_HYSTERIA_STATE_INVALID")
    if not SECRET_RE.fullmatch(str(value.get("obfsPassword", ""))):
        raise VpnManagerError("VPN_HYSTERIA_STATE_INVALID")
    clients = value.get("clients")
    if not isinstance(clients, list) or len(clients) > MAX_CLIENTS:
        raise VpnManagerError("VPN_HYSTERIA_STATE_INVALID")
    seen_ids: set[str] = set()
    seen_labels: set[str] = set()
    normalized = []
    for client in clients:
        if not isinstance(client, dict) or set(client) != {"id", "label", "password", "createdAt"}:
            raise VpnManagerError("VPN_HYSTERIA_STATE_INVALID")
        client_id = validate_client_id(client.get("id"))
        label = validate_label(client.get("label"))
        password = str(client.get("password", ""))
        created_at = client.get("createdAt")
        if not SECRET_RE.fullmatch(password) or not isinstance(created_at, str) or len(created_at) > 40:
            raise VpnManagerError("VPN_HYSTERIA_STATE_INVALID")
        if client_id in seen_ids or label.casefold() in seen_labels:
            raise VpnManagerError("VPN_HYSTERIA_STATE_INVALID")
        seen_ids.add(client_id)
        seen_labels.add(label.casefold())
        normalized.append({"id": client_id, "label": label, "password": password, "createdAt": created_at})
    return {**value, "clients": normalized}


def hysteria_config(state: dict[str, Any], auth_url: str = DEFAULT_AUTH_URL) -> dict[str, Any]:
    state = validate_hysteria_state(state)
    return {
        "listen": f'{state["address"]}:{state["port"]}',
        "acme": {
            "domains": [state["serverName"]],
            "email": state["acmeEmail"],
            "ca": "letsencrypt",
            "listenHost": state["address"],
            "type": "http",
            "http": {"altPort": 80},
            "dir": "/var/lib/hysteria/acme",
        },
        "auth": {"type": "http", "http": {"url": auth_url}},
        "obfs": {"type": "salamander", "salamander": {"password": state["obfsPassword"]}},
        "disableUDP": False,
        "speedTest": False,
        "masquerade": {"type": "proxy", "proxy": {"url": "https://www.cloudflare.com/", "rewriteHost": True}},
    }


def verify_client_auth(state_or_path: dict[str, Any] | Path, auth_str: str) -> tuple[bool, str]:
    if not isinstance(auth_str, str) or ":" not in auth_str:
        return False, ""
    client_id, client_pass = auth_str.split(":", 1)
    if not client_id or not client_pass:
        return False, ""
    if isinstance(state_or_path, Path):
        try:
            state = json.loads(state_or_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return False, ""
    else:
        state = state_or_path
    if not isinstance(state, dict):
        return False, ""
    for client in state.get("clients", []):
        if (
            isinstance(client, dict)
            and hmac.compare_digest(str(client.get("id", "")), client_id)
            and hmac.compare_digest(str(client.get("password", "")), client_pass)
        ):
            return True, client["id"]
    return False, ""


async def _write_http_response(writer: asyncio.StreamWriter, status: int, body: bytes) -> None:
    status_text = {200: "OK", 400: "Bad Request", 405: "Method Not Allowed", 500: "Internal Server Error"}.get(status, "OK")
    response = (
        f"HTTP/1.1 {status} {status_text}\r\n"
        f"Content-Type: application/json\r\n"
        f"Content-Length: {len(body)}\r\n"
        f"Connection: close\r\n"
        f"\r\n"
    ).encode("latin1") + body
    writer.write(response)
    await writer.drain()


async def handle_hysteria_auth(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, state_path: Path = DEFAULT_STATE_PATH) -> None:
    try:
        line = await asyncio.wait_for(reader.readline(), timeout=5)
        if not line:
            return
        parts = line.decode("latin1", errors="replace").split()
        if len(parts) < 2 or parts[0] != "POST":
            await _write_http_response(writer, 405, b'{"ok":false}')
            return

        content_length = 0
        while True:
            header_line = await asyncio.wait_for(reader.readline(), timeout=5)
            if not header_line or header_line in (b"\r\n", b"\n"):
                break
            header_text = header_line.decode("latin1", errors="replace")
            if ":" in header_text:
                name, val = header_text.split(":", 1)
                if name.strip().lower() == "content-length":
                    try:
                        content_length = int(val.strip())
                    except ValueError:
                        content_length = 0

        if content_length > 4096:
            await _write_http_response(writer, 400, b'{"ok":false}')
            return

        body = await asyncio.wait_for(reader.readexactly(content_length), timeout=5) if content_length > 0 else b""
        payload = json.loads(body.decode("utf-8")) if body else {}
        auth_val = payload.get("auth", "")
        ok, client_id = verify_client_auth(state_path, auth_val)
        if ok:
            resp_body = json.dumps({"ok": True, "id": client_id}).encode("utf-8")
        else:
            resp_body = b'{"ok":false}'
        await _write_http_response(writer, 200, resp_body)
    except Exception:
        try:
            await _write_http_response(writer, 500, b'{"ok":false}')
        except Exception:
            pass
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


class HysteriaVpnManager:
    def __init__(
        self,
        run: Callable[..., dict[str, Any]],
        state_path: Path = DEFAULT_STATE_PATH,
        config_path: Path = DEFAULT_CONFIG_PATH,
        hysteria_bin: str = DEFAULT_HYSTERIA_BIN,
        service: str = DEFAULT_SERVICE,
        auth_url: str = DEFAULT_AUTH_URL,
    ) -> None:
        self.run = run
        self.state_path = Path(state_path)
        self.config_path = Path(config_path)
        self.hysteria_bin = hysteria_bin
        self.service = service
        self.auth_url = auth_url

    def _read_state(self) -> dict[str, Any]:
        try:
            return validate_hysteria_state(json.loads(self.state_path.read_text(encoding="utf-8")))
        except VpnManagerError:
            raise
        except (OSError, json.JSONDecodeError) as exc:
            raise VpnManagerError("VPN_HYSTERIA_STATE_UNAVAILABLE") from exc

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

    def _config_valid(self, state: dict[str, Any] | None = None) -> bool:
        try:
            expected = hysteria_config(state or self._read_state(), self.auth_url)
            actual = json.loads(self.config_path.read_text(encoding="utf-8"))
            return actual == expected
        except (OSError, json.JSONDecodeError, VpnManagerError):
            return False

    def _apply(self, state: dict[str, Any]) -> None:
        state = validate_hysteria_state(state)
        previous_state = self.state_path.read_bytes() if self.state_path.exists() else None
        previous_config = self.config_path.read_bytes() if self.config_path.exists() else None
        state_bytes = (json.dumps(state, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        config_bytes = (json.dumps(hysteria_config(state, self.auth_url), ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        restarted_service = False
        try:
            self._write_atomic(self.state_path, state_bytes)
            if not self._config_valid(state):
                self._write_atomic(self.config_path, config_bytes, mode=0o640, group_from_parent=True)
                if not self._config_valid(state):
                    raise VpnManagerError("VPN_HYSTERIA_CONFIG_REJECTED")
                restarted = self.run(["/usr/bin/systemctl", "restart", self.service], timeout=45)
                if restarted.get("state") != "succeeded":
                    raise VpnManagerError("VPN_HYSTERIA_RESTART_FAILED")
                active = self.run(["/usr/bin/systemctl", "is-active", self.service], timeout=15)
                if active.get("state") != "succeeded" or active.get("data", {}).get("output", "").strip() != "active":
                    raise VpnManagerError("VPN_HYSTERIA_HEALTH_FAILED")
                restarted_service = True
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
                if previous_config is not None and restarted_service:
                    self.run(["/usr/bin/systemctl", "restart", self.service], timeout=45)
            except OSError:
                raise VpnManagerError("VPN_HYSTERIA_ROLLBACK_FAILED") from exc
            if isinstance(exc, VpnManagerError):
                raise
            raise VpnManagerError("VPN_HYSTERIA_WRITE_FAILED") from exc

    @staticmethod
    def _public_client(client: dict[str, Any]) -> dict[str, Any]:
        return {"id": client["id"], "label": client["label"], "createdAt": client["createdAt"]}

    @staticmethod
    def _new_client(label: str) -> dict[str, Any]:
        return {"id": f"vpn-{secrets.token_hex(6)}", "label": validate_label(label), "password": secrets.token_urlsafe(32), "createdAt": utc_now()}

    @staticmethod
    def _find(state: dict[str, Any], client_id: str) -> dict[str, Any]:
        client_id = validate_client_id(client_id)
        client = next((item for item in state["clients"] if item["id"] == client_id), None)
        if not client:
            raise VpnManagerError("VPN_CLIENT_NOT_FOUND")
        return client

    @staticmethod
    def share_uri(state: dict[str, Any], client: dict[str, Any]) -> str:
        state = validate_hysteria_state(state)
        query = f'obfs=salamander&obfs-password={quote(state["obfsPassword"], safe="")}&sni={quote(state["serverName"], safe="")}'
        auth = f'{quote(client["id"], safe="")}:{quote(client["password"], safe="")}'
        return f'hy2://{auth}@{state["serverName"]}:{state["port"]}/?{query}#{quote(client["label"], safe="")}'

    def status(self) -> dict[str, Any]:
        try:
            state = self._read_state()
            active = self.run(["/usr/bin/systemctl", "is-active", self.service], timeout=15)
            listener = self.run(["/usr/bin/ss", "-lun"], timeout=15)
            listener_output = listener.get("data", {}).get("output", "")
            return {
                "serviceState": "active" if active.get("state") == "succeeded" and active.get("data", {}).get("output", "").strip() == "active" else "unavailable",
                "configValid": self._config_valid(state),
                "listenerReady": listener.get("state") == "succeeded" and f'{state["address"]}:{state["port"]}' in listener_output,
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
        if not self._config_valid(state):
            raise VpnManagerError("VPN_HYSTERIA_CONFIG_REJECTED")
        if self.run(["/usr/bin/systemctl", "restart", self.service], timeout=45).get("state") != "succeeded":
            raise VpnManagerError("VPN_HYSTERIA_RESTART_FAILED")
        return {"clientCount": len(state["clients"])}

    def execute(self, operation: str, arguments: dict[str, Any]) -> dict[str, Any]:
        try:
            action = operation.removeprefix("vpn.hysteria2.")
            if action == "status":
                data = self.status()
            elif action == "clients.list":
                data = {"clients": self.clients()}
            elif action == "client.issue":
                data = self.issue(arguments["label"])
            elif action == "client.revoke":
                data = self.revoke(arguments["clientId"])
            elif action == "client.rotate":
                data = self.rotate(arguments["clientId"])
            elif action == "client.export":
                data = self.export(arguments["clientId"])
            elif action == "restart":
                data = self.restart()
            else:
                raise VpnManagerError("VPN_OPERATION_UNSUPPORTED")
            return {"state": "succeeded", "data": data}
        except VpnManagerError as exc:
            return {"state": "failed", "errorCode": exc.code}
