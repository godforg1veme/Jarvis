import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from jarvis_host_agent.config import load_config
from jarvis_host_agent.protocol import ProtocolError


class ConfigTests(unittest.TestCase):
    def test_loads_probe_target_after_reading_managed_services(self):
        config = {
            "authenticatorPath": "/etc/jarvis-host-agent/authenticator",
            "stateDir": "/var/lib/jarvis-host-agent",
            "managedServices": [{"id": "xray", "type": "systemd", "target": "xray.service", "actions": []}],
            "nodeCode": "de",
            "probeTarget": {
                "nodeCode": "nl",
                "vlessHost": "203.0.113.10",
                "hysteriaHost": "vpn-nl.example.test",
                "expectedExitIp": "198.51.100.24",
            },
            "probeCredentialDir": "/etc/jarvis-vpn/probes",
        }
        with TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps(config), encoding="utf-8")
            loaded = load_config(path)
        self.assertEqual(loaded.node_code, "de")
        self.assertEqual(loaded.probe_target.node_code, "nl")
        self.assertEqual(loaded.probe_target.vless_host, "203.0.113.10")
        self.assertEqual(loaded.probe_target.expected_exit_ip, "198.51.100.24")
        self.assertEqual(loaded.managed_services["xray"].target, "xray.service")

    def test_rejects_missing_or_invalid_expected_exit_ip(self):
        config = {
            "authenticatorPath": "/etc/jarvis-host-agent/authenticator",
            "stateDir": "/var/lib/jarvis-host-agent",
            "managedServices": [],
            "nodeCode": "de",
            "probeTarget": {
                "nodeCode": "nl",
                "vlessHost": "203.0.113.10",
                "hysteriaHost": "vpn-nl.example.test",
                "expectedExitIp": "198.51.100.24",
            },
            "probeCredentialDir": "/etc/jarvis-vpn/probes",
        }
        invalid_values = ("vpn-nl.example.test", "", "999.999.999.999", None)
        for value in invalid_values:
            with self.subTest(value=value):
                candidate = json.loads(json.dumps(config))
                candidate["probeTarget"]["expectedExitIp"] = value
                with TemporaryDirectory() as directory:
                    path = Path(directory) / "config.json"
                    path.write_text(json.dumps(candidate), encoding="utf-8")
                    with self.assertRaisesRegex(ProtocolError, "probe target is invalid"):
                        load_config(path)

        candidate = json.loads(json.dumps(config))
        candidate["probeTarget"].pop("expectedExitIp")
        with TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps(candidate), encoding="utf-8")
            with self.assertRaisesRegex(ProtocolError, "probe target is invalid"):
                load_config(path)

    def test_rejects_unknown_probe_target_field(self):
        config = {
            "authenticatorPath": "/etc/jarvis-host-agent/authenticator",
            "stateDir": "/var/lib/jarvis-host-agent",
            "managedServices": [],
            "nodeCode": "de",
            "probeTarget": {
                "nodeCode": "nl",
                "vlessHost": "203.0.113.10",
                "hysteriaHost": "vpn-nl.example.test",
                "expectedExitIp": "198.51.100.24",
                "unexpected": "ignored-must-not-be-accepted",
            },
            "probeCredentialDir": "/etc/jarvis-vpn/probes",
        }
        with TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps(config), encoding="utf-8")
            with self.assertRaisesRegex(ProtocolError, "probe target is invalid"):
                load_config(path)
