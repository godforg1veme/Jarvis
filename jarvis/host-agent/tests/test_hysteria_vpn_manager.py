import json
import tempfile
import unittest
from pathlib import Path

from jarvis_host_agent.hysteria_vpn_manager import HysteriaVpnManager, hysteria_config, validate_hysteria_state
from jarvis_host_agent.vpn_manager import VpnManagerError


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

    def test_config_is_bound_to_second_ip_and_contains_userpass_without_logs(self):
        state = base_state()
        state["clients"] = [{"id": "vpn-0123456789ab", "label": "iPhone", "password": "P" * 40, "createdAt": "2026-09-13T00:00:00Z"}]
        config = hysteria_config(state)
        self.assertEqual(config["listen"], "203.0.113.11:443")
        self.assertEqual(config["acme"]["domains"], ["vpn.example.com"])
        self.assertEqual(config["auth"]["userpass"]["vpn-0123456789ab"], "P" * 40)
        self.assertEqual(config["obfs"]["type"], "salamander")
        self.assertNotIn("log", config)

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


if __name__ == "__main__":
    unittest.main()
