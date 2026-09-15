import unittest
import sys
from pathlib import Path
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

    @patch("jarvis_host_agent.actions._run")
    @patch("jarvis_host_agent.actions.XrayVpnManager.health_snapshot")
    @patch("jarvis_host_agent.actions.HysteriaVpnManager.health_snapshot")
    @patch("jarvis_host_agent.actions._host_health")
    def test_vpn_health_snapshot_returns_structured_status_without_secrets(self, host_health, hy2_snapshot, xray_snapshot, run):
        host_health.return_value = "healthy"
        xray_snapshot.return_value = {"service": "healthy", "config": "healthy", "listener": "healthy"}
        hy2_snapshot.return_value = {"service": "healthy", "config": "healthy", "listener": "healthy", "auth": "healthy"}
        run.return_value = {"state": "succeeded", "data": {"output": "LISTEN 0 128 127.0.0.1:3211 0.0.0.0:*\n"}}

        response = execute(self.config, "vpn.health.snapshot", {})
        self.assertEqual(response["state"], "succeeded")
        self.assertEqual(response["data"], {
            "host": "healthy",
            "xray": {
                "service": "healthy",
                "config": "healthy",
                "listener": "healthy",
            },
            "hysteria2": {
                "service": "healthy",
                "config": "healthy",
                "listener": "healthy",
                "auth": "healthy",
            },
        })
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
