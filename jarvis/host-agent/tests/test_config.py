import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from jarvis_host_agent.config import load_config


class ConfigTests(unittest.TestCase):
    def test_loads_probe_target_after_reading_managed_services(self):
        config = {
            "authenticatorPath": "/etc/jarvis-host-agent/authenticator",
            "stateDir": "/var/lib/jarvis-host-agent",
            "managedServices": [{"id": "xray", "type": "systemd", "target": "xray.service", "actions": []}],
            "nodeCode": "de",
            "probeTarget": {"nodeCode": "nl", "vlessHost": "94.183.208.56", "hysteriaHost": "94.183.208.56"},
            "probeCredentialDir": "/etc/jarvis-vpn/probes",
        }
        with TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps(config), encoding="utf-8")
            loaded = load_config(path)
        self.assertEqual(loaded.node_code, "de")
        self.assertEqual(loaded.probe_target.node_code, "nl")
        self.assertEqual(loaded.probe_target.vless_host, "94.183.208.56")
        self.assertEqual(loaded.managed_services["xray"].target, "xray.service")
