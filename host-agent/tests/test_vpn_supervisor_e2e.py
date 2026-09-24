import unittest
from unittest.mock import patch

from jarvis_host_agent.actions import _vpn_health_snapshot


XRAY_HEALTHY = {"service": "healthy", "config": "healthy", "listener": "healthy", "protocolProbe": "unknown"}
HYSTERIA_HEALTHY = {
    "service": "healthy",
    "config": "healthy",
    "listener": "healthy",
    "auth": "healthy",
    "authEndpoint": "healthy",
    "authCredentialProbe": "healthy",
    "protocolProbe": "unknown",
}


class VpnSupervisorEndToEndTests(unittest.TestCase):
    def snapshot(self, xray=None, hysteria2=None, dns="healthy", outbound="healthy", host="healthy"):
        read_commands = []

        def read_only_run(args, timeout=15):
            read_commands.append(tuple(args))
            self.assertIn(args[0], {"/usr/bin/ss", "/usr/bin/systemctl"})
            return {"state": "succeeded", "data": {"output": ""}}

        with (
            patch("jarvis_host_agent.actions._host_health", return_value=host),
            patch("jarvis_host_agent.actions.XrayVpnManager.health_snapshot", return_value=xray or dict(XRAY_HEALTHY)),
            patch("jarvis_host_agent.actions.HysteriaVpnManager.health_snapshot", return_value=hysteria2 or dict(HYSTERIA_HEALTHY)),
        ):
            result = _vpn_health_snapshot(read_only_run, lambda: dns, lambda: outbound)
        self.assertTrue(read_commands)
        return result

    def test_simulated_failures_produce_expected_safe_diagnoses(self):
        cases = (
            ({"dns": "unavailable"}, "HOST_DNS_FAILURE"),
            ({"outbound": "unavailable"}, "HOST_OUTBOUND_FAILURE"),
            ({"xray": {**XRAY_HEALTHY, "service": "unavailable", "listener": "unavailable"}}, "XRAY_SERVICE_FAILURE"),
            ({"xray": {**XRAY_HEALTHY, "config": "unavailable", "service": "unavailable", "listener": "unavailable"}}, "XRAY_CONFIG_FAILURE"),
            ({"hysteria2": {**HYSTERIA_HEALTHY, "service": "unavailable", "listener": "unavailable"}}, "HYSTERIA2_SERVICE_FAILURE"),
            ({"hysteria2": {**HYSTERIA_HEALTHY, "auth": "unavailable", "authEndpoint": "unavailable", "authCredentialProbe": "unavailable"}}, "HYSTERIA2_AUTH_ENDPOINT_FAILURE"),
            ({
                "xray": {**XRAY_HEALTHY, "service": "unavailable", "listener": "unavailable"},
                "hysteria2": {**HYSTERIA_HEALTHY, "service": "unavailable", "listener": "unavailable"},
            }, "VPN_MULTI_STACK_FAILURE"),
        )
        for arguments, code in cases:
            with self.subTest(code=code):
                result = self.snapshot(**arguments)
                self.assertEqual(result["diagnosis"]["primary"]["code"], code)
                self.assertNotIn("repair", result["diagnosis"])
                self.assertNotIn("action", result["diagnosis"])

    def test_healthy_snapshot_stays_non_mutating_and_protocol_unknown_is_informational(self):
        result = self.snapshot()
        self.assertEqual(result["diagnosis"]["state"], "healthy")
        self.assertIsNone(result["diagnosis"]["primary"])
        self.assertTrue(all(item["severity"] == "info" for item in result["diagnosis"]["secondarySignals"]))


if __name__ == "__main__":
    unittest.main()
