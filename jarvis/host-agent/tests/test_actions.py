import unittest
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from jarvis_host_agent.actions import execute, _run, MAX_OUTPUT_BYTES
from jarvis_host_agent.config import HostAgentConfig, ManagedService


class ActionsTests(unittest.TestCase):
    @patch('jarvis_host_agent.actions._run')
    def test_discovery_exposes_names_and_states_without_commands_or_labels(self, run):
        run.side_effect = [
            {'state': 'succeeded', 'data': {'output': '{"name":"extra-container","state":"running","secret":"hidden"}\n'}},
            {'state': 'succeeded', 'data': {'output': '[{"unit":"xray.service","active":"active","description":"hidden"}]'}},
        ]
        result = execute(None, 'inventory.snapshot', {})
        self.assertEqual(len(result['data']['items']), 2)
        self.assertNotIn('hidden', str(result))
        self.assertTrue(all(set(item) == {'name', 'type', 'state'} for item in result['data']['items']))

    def test_command_output_is_bounded_while_both_streams_are_drained(self):
        result = _run([sys.executable, '-c', "import sys;sys.stderr.write('error\\n');sys.stderr.flush();sys.stdout.write('x'*200000)"])
        self.assertEqual(result['state'], 'succeeded')
        self.assertTrue(result['data']['output'].startswith('error'))
        self.assertEqual(len(result['data']['output']), MAX_OUTPUT_BYTES)

    def test_command_timeout_is_unknown_not_success(self):
        result = _run([sys.executable, '-c', 'import time;time.sleep(10)'], timeout=0.1)
        self.assertEqual(result['state'], 'unknown')

    def setUp(self):
        self.config = HostAgentConfig(
            Path("/unused/auth"),
            Path("/unused/state"),
            {
                "jarvis-server": ManagedService("jarvis-server", "docker", "jarvis-family-server-1", frozenset()),
                "telegram-parser": ManagedService("telegram-parser", "systemd", "tg-parser.service", frozenset()),
            },
        )

    @patch("jarvis_host_agent.actions.read_probe_result")
    def test_external_probe_snapshot_is_read_only_and_target_scoped(self, read_result):
        read_result.return_value = {"version": 1, "targetNode": "nl", "checks": {}}
        response = execute(self.config, "vpn.external_probe.snapshot", {"targetNode": "nl"})
        self.assertEqual(response["state"], "succeeded")
        self.assertEqual(response["data"]["targetNode"], "nl")
        read_result.assert_called_once_with("nl")

    @patch("jarvis_host_agent.actions.install_probe_credential")
    def test_external_probe_credential_install_returns_only_closed_metadata(self, install):
        config = SimpleNamespace(node_code="nl", probe_target=object(), probe_credential_dir=Path("/unused"))
        install.return_value = {"targetNode": "de", "protocol": "vless", "installedAt": "2026-09-16T12:00:00Z"}
        response = execute(config, "vpn.external_probe.credential.install", {
            "targetNode": "de", "protocol": "vless", "credential": "vless://synthetic",
        })
        self.assertEqual(response["state"], "succeeded")
        self.assertEqual(response["data"]["targetNode"], "de")
        self.assertNotIn("credential", str(response))
        install.assert_called_once()

    @patch("jarvis_host_agent.actions.read_probe_result")
    @patch("jarvis_host_agent.actions._run")
    def test_external_probe_run_starts_only_opposite_fixed_instance(self, run, read_result):
        config = SimpleNamespace(node_code="nl", probe_target=SimpleNamespace(node_code="de"))
        run.return_value = {"state": "succeeded", "data": {"output": ""}}
        read_result.return_value = {"targetNode": "de", "checks": {}}
        with patch("jarvis_host_agent.actions.probe_credential_readiness", return_value="ready") as readiness:
            response = execute(config, "vpn.external_probe.run", {"targetNode": "de", "protocol": "vless"})
        self.assertEqual(response["state"], "succeeded")
        self.assertEqual(response["data"]["targetNode"], "de")
        readiness.assert_called_once_with(config, target_node="de", protocol="vless")
        run.assert_called_once_with(["/usr/bin/systemctl", "start", "jarvis-vpn-probe@de.service"], timeout=75)

    @patch("jarvis_host_agent.actions._run")
    def test_missing_probe_credential_fails_before_systemd_start(self, run):
        config = SimpleNamespace(node_code="de", probe_target=SimpleNamespace(node_code="nl"))
        with patch("jarvis_host_agent.actions.probe_credential_readiness", return_value="not_installed"):
            response = execute(config, "vpn.external_probe.run", {"targetNode": "nl", "protocol": "vless"})
        self.assertEqual(response, {"state": "failed", "errorCode": "VPN_PROBE_CREDENTIAL_NOT_INSTALLED"})
        run.assert_not_called()

    @patch("jarvis_host_agent.actions._run")
    def test_external_probe_monitor_lifecycle_never_targets_vpn_services(self, run):
        config = SimpleNamespace(node_code="de", probe_target=SimpleNamespace(node_code="nl"))
        run.side_effect = [
            {"state": "succeeded", "data": {"output": ""}},
            {"state": "succeeded", "data": {"output": "enabled\n"}},
        ]
        enabled = execute(config, "vpn.external_probe.monitor.enable", {"targetNode": "nl"})
        self.assertEqual(enabled["state"], "succeeded")
        self.assertEqual(run.call_args_list[0].args[0], ["/usr/bin/systemctl", "enable", "--now", "jarvis-vpn-probe@nl.timer"])
        self.assertFalse(any("xray" in str(call) or "hysteria-server" in str(call) for call in run.call_args_list))

    @patch("jarvis_host_agent.actions._run")
    def test_services_snapshot_returns_only_normalized_allowlisted_state(self, run):
        def result(arguments, timeout=15):
            if arguments[0] == "/usr/bin/docker":
                return {"state": "succeeded", "data": {"output": '{"Status":"running","Health":{"Status":"healthy"}}\n'}}
            return {"state": "succeeded", "data": {"output": "ActiveState=active\nSubState=running\nResult=success\nExecMainStatus=0\n"}}

        run.side_effect = result
        response = execute(self.config, "services.snapshot", {})
        self.assertEqual(response["state"], "succeeded")
        self.assertEqual(response["data"]["services"][0]["healthState"], "healthy")
        self.assertEqual(response["data"]["services"][1]["id"], "telegram-parser")
        self.assertNotIn("output", response["data"])

    @patch("jarvis_host_agent.actions.probe_outbound_https")
    @patch("jarvis_host_agent.actions.probe_dns")
    @patch("jarvis_host_agent.actions._run")
    @patch("jarvis_host_agent.actions.XrayVpnManager.health_snapshot")
    @patch("jarvis_host_agent.actions.HysteriaVpnManager.health_snapshot")
    @patch("jarvis_host_agent.actions._host_health")
    def test_vpn_health_snapshot_returns_structured_status_without_secrets(
        self, host_health, hy2_snapshot, xray_snapshot, run, dns_probe, outbound_probe
    ):
        host_health.return_value = "healthy"
        hy2_snapshot.return_value = {
            "service": "healthy",
            "config": "healthy",
            "listener": "healthy",
            "auth": "healthy",
            "authEndpoint": "healthy",
            "authCredentialProbe": "healthy",
            "protocolProbe": "unknown",
        }
        xray_snapshot.return_value = {"service": "healthy", "config": "healthy", "listener": "healthy", "protocolProbe": "unknown"}
        run.return_value = {"state": "succeeded", "data": {"output": "LISTEN 0 128 127.0.0.1:3211 0.0.0.0:*\n"}}
        dns_probe.return_value = "healthy"
        outbound_probe.return_value = "healthy"

        response = execute(self.config, "vpn.health.snapshot", {})
        self.assertEqual(response["state"], "succeeded")
        diagnosis = response["data"]["diagnosis"]
        raw_snapshot = {key: value for key, value in response["data"].items() if key != "diagnosis"}
        self.assertEqual(raw_snapshot, {
            "host": "healthy",
            "network": {
                "dns": "healthy",
                "outbound": "healthy",
            },
            "xray": {
                "service": "healthy",
                "config": "healthy",
                "listener": "healthy",
                "protocolProbe": "unknown",
            },
            "hysteria2": {
                "service": "healthy",
                "config": "healthy",
                "listener": "healthy",
                "auth": "healthy",
                "authEndpoint": "healthy",
                "authCredentialProbe": "healthy",
                "protocolProbe": "unknown",
            },
        })
        self.assertEqual(diagnosis["state"], "healthy")
        self.assertIsNone(diagnosis["primary"])
        self.assertEqual([item["code"] for item in diagnosis["secondarySignals"]], [
            "XRAY_PROTOCOL_UNVERIFIED", "HYSTERIA2_PROTOCOL_UNVERIFIED",
        ])
        # Check no secret substrings appear anywhere in the result
        response_str = str(response)
        self.assertNotIn("password", response_str)
        self.assertNotIn("privateKey", response_str)
        self.assertNotIn("vless://", response_str)
        self.assertNotIn("hy2://", response_str)

    @patch("jarvis_host_agent.actions._run")
    def test_observed_service_with_empty_actions_cannot_be_changed(self, run):
        response = execute(self.config, "service.restart", {"serviceId": "jarvis-server"})
        self.assertEqual(response, {"state": "failed", "errorCode": "SERVICE_ACTION_UNDECLARED"})
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
