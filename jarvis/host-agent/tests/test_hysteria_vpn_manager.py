import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from jarvis_host_agent.hysteria_vpn_manager import (
    DEFAULT_AUTH_PATH,
    DEFAULT_AUTH_URL,
    HysteriaVpnManager,
    handle_hysteria_auth,
    hysteria_config,
    validate_hysteria_state,
    verify_client_auth,
)
from jarvis_host_agent.vpn_manager import VpnManagerError


class MockStreamWriter:
    def __init__(self):
        self.output = bytearray()
        self.closed = False

    def write(self, data: bytes) -> None:
        self.output.extend(data)

    async def drain(self) -> None:
        pass

    def close(self) -> None:
        self.closed = True

    async def wait_closed(self) -> None:
        pass


def base_state():
    return {
        "version": 1,
        "address": "203.0.113.11",
        "port": 443,
        "serverName": "vpn.example.com",
        "acmeEmail": "admin@example.com",
        "obfsPassword": "O" * 40,
        "clients": [],
    }


class HysteriaVpnManagerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.state_path = root / "state.json"
        self.config_path = root / "config.yaml"
        self.state_path.write_text(json.dumps(base_state()), encoding="utf-8")
        self.config_path.write_text(json.dumps(hysteria_config(base_state())), encoding="utf-8")
        self.calls = []

        def run(args, timeout=15):
            self.calls.append((args, timeout))
            if args[:2] == ["/usr/bin/systemctl", "is-active"]:
                return {"state": "succeeded", "data": {"output": "active\n"}}
            if args[:2] == ["/usr/bin/ss", "-lun"]:
                return {"state": "succeeded", "data": {"output": "UNCONN 0 0 203.0.113.11:443 0.0.0.0:*\n"}}
            return {"state": "succeeded", "data": {"output": "configuration OK\n"}}

        self.manager = HysteriaVpnManager(run, self.state_path, self.config_path, "/hysteria", "hysteria-server.service")

    def tearDown(self):
        self.temp.cleanup()

    def test_config_is_bound_to_second_ip_and_contains_http_auth_without_logs(self):
        state = base_state()
        state["clients"] = [{"id": "vpn-0123456789ab", "label": "iPhone", "password": "P" * 40, "createdAt": "2026-09-13T00:00:00Z"}]
        config = hysteria_config(state)
        self.assertEqual(config["listen"], "203.0.113.11:443")
        self.assertEqual(config["acme"]["domains"], ["vpn.example.com"])
        self.assertEqual(config["auth"]["type"], "http")
        self.assertEqual(config["auth"]["http"]["url"], DEFAULT_AUTH_URL)
        self.assertEqual(config["obfs"]["type"], "salamander")
        self.assertNotIn("log", config)

    def test_issue_does_not_restart_service_when_config_is_valid(self):
        result = self.manager.issue("iPhone")
        restart_calls = [call for call in self.calls if call[0][:2] == ["/usr/bin/systemctl", "restart"]]
        self.assertEqual(restart_calls, [])
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        self.assertEqual(len(state["clients"]), 1)
        client = state["clients"][0]
        ok, client_id = verify_client_auth(self.state_path, f'{client["id"]}:{client["password"]}')
        self.assertTrue(ok)
        self.assertEqual(client_id, client["id"])
        bad_ok, _ = verify_client_auth(self.state_path, f'{client["id"]}:wrong_password')
        self.assertFalse(bad_ok)

    def test_issue_returns_happ_uri_but_listing_has_no_secrets(self):
        result = self.manager.issue("iPhone")
        self.assertTrue(result["shareUri"].startswith("hy2://"))
        self.assertIn("obfs=salamander", result["shareUri"])
        self.assertIn("sni=vpn.example.com", result["shareUri"])
        listing = json.dumps(self.manager.clients())
        self.assertNotIn("password", listing)
        self.assertNotIn(base_state()["obfsPassword"], listing)

    def test_rotate_preserves_id_revoke_removes_only_selected_client(self):
        first = self.manager.issue("iPhone")
        second = self.manager.issue("iPad")
        rotated = self.manager.rotate(first["client"]["id"])
        self.assertEqual(rotated["client"]["id"], first["client"]["id"])
        self.assertNotEqual(rotated["shareUri"], first["shareUri"])
        self.manager.revoke(first["client"]["id"])
        self.assertEqual([item["id"] for item in self.manager.clients()], [second["client"]["id"]])

    def test_invalid_state_fails_closed(self):
        for key, value in (("address", "example.com"), ("serverName", "vpn.example.com:"), ("obfsPassword", "short")):
            state = base_state()
            state[key] = value
            with self.assertRaises(VpnManagerError):
                validate_hysteria_state(state)

    def test_failed_restart_restores_previous_state_and_config(self):
        original_state = self.state_path.read_bytes()
        self.config_path.write_text("old-config", encoding="utf-8")
        original_config = self.config_path.read_bytes()

        def fail_restart(args, timeout=15):
            if args[:2] == ["/usr/bin/systemctl", "restart"]:
                return {"state": "failed", "errorCode": "COMMAND_FAILED"}
            return {"state": "succeeded", "data": {"output": "configuration OK\n"}}

        self.manager.run = fail_restart
        with self.assertRaises(VpnManagerError) as error:
            self.manager.issue("iPhone")
        self.assertEqual(error.exception.code, "VPN_HYSTERIA_RESTART_FAILED")
        self.assertEqual(self.state_path.read_bytes(), original_state)
        self.assertEqual(self.config_path.read_bytes(), original_config)

    def test_status_uses_udp_listener_and_is_secret_free(self):
        status = self.manager.status()
        self.assertEqual(status, {"serviceState": "active", "configValid": True, "listenerReady": True, "clientCount": 0})
        self.assertNotIn(base_state()["obfsPassword"], json.dumps(status))

    def test_health_snapshot_is_structured_and_secret_free(self):
        snapshot = self.manager.health_snapshot(listener_tcp_output="LISTEN 0 128 127.0.0.1:3211 0.0.0.0:*\n")
        self.assertEqual(snapshot, {"service": "healthy", "config": "healthy", "listener": "healthy", "auth": "healthy"})
        self.assertNotIn(base_state()["obfsPassword"], json.dumps(snapshot))

    def _send_http_auth(self, request_bytes: bytes, state_path: Path | None = None) -> bytes:
        target_path = state_path or self.state_path

        async def _run():
            reader = asyncio.StreamReader()
            reader.feed_data(request_bytes)
            reader.feed_eof()
            writer = MockStreamWriter()
            await handle_hysteria_auth(reader, writer, state_path=target_path)
            return bytes(writer.output)

        return asyncio.run(_run())

    def test_http_auth_valid_credentials(self):
        self.manager.issue("iPhone")
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        client = state["clients"][0]
        body = json.dumps({"auth": f"{client['id']}:{client['password']}"}).encode("utf-8")
        req = (
            f"POST {DEFAULT_AUTH_PATH} HTTP/1.1\r\n"
            f"Host: 127.0.0.1\r\n"
            f"Content-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n\r\n"
        ).encode("latin1") + body
        resp = self._send_http_auth(req)
        self.assertIn(b"HTTP/1.1 200 OK", resp)
        self.assertIn(b'"ok": true', resp)
        self.assertIn(f'"{client["id"]}"'.encode("utf-8"), resp)

    def test_http_auth_invalid_credentials(self):
        self.manager.issue("iPhone")
        body = b'{"auth": "vpn-0123456789ab:wrong_password"}'
        req = (
            f"POST {DEFAULT_AUTH_PATH} HTTP/1.1\r\n"
            f"Host: 127.0.0.1\r\n"
            f"Content-Length: {len(body)}\r\n\r\n"
        ).encode("latin1") + body
        resp = self._send_http_auth(req)
        self.assertIn(b"HTTP/1.1 200 OK", resp)
        self.assertIn(b'{"ok":false}', resp)

    def test_http_auth_wrong_method(self):
        req = f"GET {DEFAULT_AUTH_PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".encode("latin1")
        resp = self._send_http_auth(req)
        self.assertIn(b"HTTP/1.1 405 Method Not Allowed", resp)
        self.assertIn(b'{"ok":false}', resp)

    def test_http_auth_wrong_path(self):
        req = b"POST /invalid/path HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\n\r\n"
        resp = self._send_http_auth(req)
        self.assertIn(b"HTTP/1.1 404 Not Found", resp)
        self.assertIn(b'{"ok":false}', resp)

    def test_http_auth_oversized_body(self):
        req = f"POST {DEFAULT_AUTH_PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 5000\r\n\r\n".encode("latin1")
        resp = self._send_http_auth(req)
        self.assertIn(b"HTTP/1.1 400 Bad Request", resp)
        self.assertIn(b'{"ok":false}', resp)

    def test_http_auth_invalid_content_length(self):
        for invalid in ("-1", "not_a_number"):
            req = f"POST {DEFAULT_AUTH_PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: {invalid}\r\n\r\n".encode("latin1")
            resp = self._send_http_auth(req)
            self.assertIn(b"HTTP/1.1 400 Bad Request", resp)
            self.assertIn(b'{"ok":false}', resp)

    def test_http_auth_malformed_utf8(self):
        body = b"\xff\xfe\xfd\xfc"
        req = (
            f"POST {DEFAULT_AUTH_PATH} HTTP/1.1\r\n"
            f"Host: 127.0.0.1\r\n"
            f"Content-Length: {len(body)}\r\n\r\n"
        ).encode("latin1") + body
        resp = self._send_http_auth(req)
        self.assertIn(b"HTTP/1.1 400 Bad Request", resp)
        self.assertIn(b'{"ok":false}', resp)

    def test_http_auth_malformed_json(self):
        body = b'{"auth": "unterminated'
        req = (
            f"POST {DEFAULT_AUTH_PATH} HTTP/1.1\r\n"
            f"Host: 127.0.0.1\r\n"
            f"Content-Length: {len(body)}\r\n\r\n"
        ).encode("latin1") + body
        resp = self._send_http_auth(req)
        self.assertIn(b"HTTP/1.1 400 Bad Request", resp)
        self.assertIn(b'{"ok":false}', resp)

    def test_http_auth_non_object_json(self):
        body = b'["auth", "vpn-1:pwd"]'
        req = (
            f"POST {DEFAULT_AUTH_PATH} HTTP/1.1\r\n"
            f"Host: 127.0.0.1\r\n"
            f"Content-Length: {len(body)}\r\n\r\n"
        ).encode("latin1") + body
        resp = self._send_http_auth(req)
        self.assertIn(b"HTTP/1.1 400 Bad Request", resp)
        self.assertIn(b'{"ok":false}', resp)

    def test_http_auth_tcp_integration_smoke(self):
        self.manager.issue("iPhone")
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        client = state["clients"][0]
        body = json.dumps({"auth": f"{client['id']}:{client['password']}"}).encode("utf-8")

        async def _run():
            server = await asyncio.start_server(
                lambda r, w: handle_hysteria_auth(r, w, state_path=self.state_path),
                host="127.0.0.1",
                port=0,
            )
            port = server.sockets[0].getsockname()[1]
            async with server:
                reader, writer = await asyncio.open_connection("127.0.0.1", port)
                req = (
                    f"POST {DEFAULT_AUTH_PATH} HTTP/1.1\r\n"
                    f"Host: 127.0.0.1\r\n"
                    f"Content-Length: {len(body)}\r\n\r\n"
                ).encode("latin1") + body
                writer.write(req)
                await writer.drain()
                resp = await reader.read(4096)
                writer.close()
                await writer.wait_closed()
                return resp

        resp = asyncio.run(_run())
        self.assertIn(b"HTTP/1.1 200 OK", resp)
        self.assertIn(b'"ok": true', resp)
        self.assertIn(f'"{client["id"]}"'.encode("utf-8"), resp)


if __name__ == "__main__":
    unittest.main()
