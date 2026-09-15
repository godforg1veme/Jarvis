import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from jarvis_host_agent.vpn_manager import VpnManagerError, XrayVpnManager, validate_state, xray_config


PRIVATE_KEY = "A" * 43
PUBLIC_KEY = "B" * 43


def base_state():
    return {
        "version": 1,
        "address": "203.0.113.10",
        "port": 443,
        "serverName": "example.com",
        "privateKey": PRIVATE_KEY,
        "publicKey": PUBLIC_KEY,
        "clients": [],
    }


class VpnManagerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.state_path = root / "state.json"
        self.config_path = root / "config.json"
        self.state_path.write_text(json.dumps(base_state()), encoding="utf-8")
        self.calls = []

        def run(args, timeout=15):
            self.calls.append((args, timeout))
            if args[:2] == ["/usr/bin/systemctl", "is-active"]:
                return {"state": "succeeded", "data": {"output": "active\n"}}
            if args[:2] == ["/usr/bin/ss", "-lnt"]:
                return {"state": "succeeded", "data": {"output": "LISTEN 0 4096 *:443 *:*\nLISTEN 0 4096 *:8443 *:*\n"}}
            return {"state": "succeeded", "data": {"output": "Configuration OK\n"}}

        self.manager = XrayVpnManager(run, self.state_path, self.config_path, "/xray", "xray.service")

    def tearDown(self):
        self.temp.cleanup()

    def test_generated_config_contains_only_validated_clients_and_matching_reality_sni(self):
        state = base_state()
        state["clients"].append({
            "id": "vpn-0123456789ab", "label": "Phone", "uuid": "12345678-1234-4234-8234-123456789abc",
            "shortId": "0123456789abcdef", "createdAt": "2026-09-12T00:00:00Z",
        })
        config = xray_config(state)
        inbound = config["inbounds"][0]
        self.assertEqual(inbound["streamSettings"]["realitySettings"]["target"], "example.com:443")
        self.assertEqual(inbound["streamSettings"]["realitySettings"]["serverNames"], ["example.com"])
        self.assertEqual(inbound["settings"]["clients"][0]["email"], "vpn-0123456789ab")
        self.assertNotIn("publicKey", json.dumps(config))

    def test_alternative_port_keeps_primary_listener_and_is_preferred_by_happ(self):
        state = base_state()
        state["alternativePort"] = 8443
        state["clients"].append({
            "id": "vpn-0123456789ab", "label": "Phone", "uuid": "12345678-1234-4234-8234-123456789abc",
            "shortId": "0123456789abcdef", "createdAt": "2026-09-12T00:00:00Z",
        })
        config = xray_config(state)
        self.assertEqual([item["port"] for item in config["inbounds"]], [443, 8443])
        uri = self.manager.share_uri(validate_state(state), state["clients"][0])
        self.assertIn("@203.0.113.10:8443?", uri)
        self.assertIn("headerType=none", uri)
        self.assertIn("xtls=2", uri)
        self.assertNotIn("fragment=", uri)

    def test_alternative_port_must_be_distinct_and_bounded(self):
        for invalid in (443, 0, 65536, "8443"):
            state = base_state()
            state["alternativePort"] = invalid
            with self.assertRaises(VpnManagerError):
                validate_state(state)

    def test_issue_returns_happ_uri_but_public_listing_contains_no_credential(self):
        result = self.manager.issue("My Phone")
        self.assertRegex(result["client"]["id"], r"^vpn-[a-f0-9]{12}$")
        self.assertIn("vless://", result["shareUri"])
        self.assertIn("security=reality", result["shareUri"])
        self.assertNotIn("uuid", json.dumps(self.manager.clients()))
        self.assertNotIn("shortId", json.dumps(self.manager.clients()))

    def test_revoke_removes_only_selected_client(self):
        first = self.manager.issue("Phone")["client"]["id"]
        second = self.manager.issue("Laptop")["client"]["id"]
        self.manager.revoke(first)
        self.assertEqual([client["id"] for client in self.manager.clients()], [second])

    def test_rotation_preserves_opaque_id_and_changes_uri(self):
        issued = self.manager.issue("Phone")
        rotated = self.manager.rotate(issued["client"]["id"])
        self.assertEqual(rotated["client"]["id"], issued["client"]["id"])
        self.assertNotEqual(rotated["shareUri"], issued["shareUri"])

    def test_invalid_state_and_label_fail_closed(self):
        broken = base_state()
        broken["serverName"] = "example.com:"
        with self.assertRaises(VpnManagerError):
            validate_state(broken)
        with self.assertRaises(VpnManagerError):
            self.manager.issue("../../root")

    def test_failed_restart_restores_previous_state_and_config(self):
        original_state = self.state_path.read_bytes()
        self.config_path.write_text("old-config", encoding="utf-8")
        original_config = self.config_path.read_bytes()

        def fail_restart(args, timeout=15):
            if args[:2] == ["/usr/bin/systemctl", "restart"]:
                return {"state": "failed", "errorCode": "COMMAND_FAILED"}
            return {"state": "succeeded", "data": {"output": "Configuration OK\n"}}

        self.manager.run = fail_restart
        with self.assertRaises(VpnManagerError) as error:
            self.manager.issue("Phone")
        self.assertEqual(error.exception.code, "VPN_RESTART_FAILED")
        self.assertEqual(self.state_path.read_bytes(), original_state)
        self.assertEqual(self.config_path.read_bytes(), original_config)

    def test_status_is_bounded_and_contains_no_keys(self):
        status = self.manager.status()
        self.assertEqual(status, {"serviceState": "active", "configValid": True, "listenerReady": True, "clientCount": 0})
        self.assertNotIn(PRIVATE_KEY, json.dumps(status))

    def test_health_snapshot_is_structured_and_secret_free(self):
        snapshot = self.manager.health_snapshot()
        self.assertEqual(snapshot, {"service": "healthy", "config": "healthy", "listener": "healthy"})
        self.assertNotIn(PRIVATE_KEY, json.dumps(snapshot))


if __name__ == "__main__":
    unittest.main()
