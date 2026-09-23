import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from jarvis_host_agent import vpn_external_probe_runner as runner

VLESS = (
    "vless://123e4567-e89b-42d3-a456-426614174000@203.0.113.10:8443"
    "?encryption=none&flow=xtls-rprx-vision&security=reality&headerType=none"
    "&sni=example.test&fp=chrome&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "&sid=0123456789abcdef&type=tcp&xtls=2#Probe"
)
HYSTERIA = (
    "hy2://vpn-0123456789ab:synthetic-password@vpn.example.test:443/"
    "?obfs=salamander&obfs-password=synthetic-obfs&sni=vpn.example.test#Probe"
)
HOP_POOL = {
    "version": 1,
    "nodeCode": "nl",
    "generation": "123e4567-e89b-42d3-a456-426614174000",
    "ports": [20011, 22229, 26549, 30013],
    "hopIntervalSeconds": 5,
}


class ProbeRunnerTests(unittest.TestCase):
    def test_proxy_curl_cannot_be_bypassed_by_no_proxy_environment(self):
        completed = type("Completed", (), {"returncode": 0, "stdout": b"203.0.113.10"})()
        with patch.object(runner.subprocess, "run", return_value=completed) as run:
            self.assertEqual(runner._curl_ip(18080), "203.0.113.10")
        command = run.call_args.args[0]
        self.assertEqual(command[command.index("--noproxy") + 1], "")
        self.assertIn("--socks5-hostname", command)
        self.assertEqual(command[command.index("--max-time") + 1], "12")

    def _run(self):
        return runner.run_checks(target="nl", credential_dir=Path("/not-used"),
                                 vless_host="203.0.113.10", hysteria_host="vpn.example.test",
                                 expected_exit_ip="198.51.100.24", xray_bin="/usr/local/bin/xray",
                                 hysteria_bin="/usr/local/bin/hysteria")

    def test_runs_fixed_and_hopping_client_probes_and_returns_only_closed_status(self):
        calls = []

        def credential(_directory, name):
            return VLESS if name == "vless.uri" else HYSTERIA

        def client(config, argv, expected_ip, **kwargs):
            calls.append((config, argv, expected_ip, kwargs))
            return {"status": "healthy", "failureCode": None}

        with patch.object(runner, "_read_credential", side_effect=credential), \
             patch.object(runner, "_curl_ip", return_value="198.51.100.7"), \
             patch.object(runner, "_read_hop_pool", return_value=HOP_POOL), \
             patch.object(runner, "_free_port", side_effect=[18080, 18081, 18082, 18083]), \
             patch.object(runner, "_run_client", side_effect=client):
            result = self._run()
        self.assertEqual(len(calls), 4)
        self.assertEqual({call[2] for call in calls}, {"198.51.100.24"})
        self.assertEqual(calls[0][0]["outbounds"][0]["settings"]["vnext"][0]["port"], 443)
        self.assertEqual(calls[1][0]["outbounds"][0]["settings"]["vnext"][0]["port"], 8443)
        self.assertEqual(calls[2][1][-1], "--config")
        self.assertEqual(calls[3][0]["server"], "vpn.example.test:20011,22229,26549,30013")
        self.assertEqual(calls[3][0]["transport"]["udp"]["hopInterval"], "5s")
        self.assertEqual(calls[3][3], {"hop_interval_seconds": 5})
        self.assertEqual(set(result["checks"]), {"vless_tcp_443", "vless_tcp_8443", "hysteria2_udp_443", "hysteria2_udp_hop"})
        self.assertEqual({item["status"] for item in result["checks"].values()}, {"healthy"})
        self.assertNotIn("synthetic-password", json.dumps(result))
        self.assertNotIn("vless://", json.dumps(result))

    def test_hop_check_requires_two_proxy_requests_separated_by_pool_interval(self):
        class FakeProcess:
            def poll(self):
                return None

            def terminate(self):
                pass

            def wait(self, timeout):
                return 0

        config = {"socks5": {"listen": "127.0.0.1:18080"}}
        with patch.object(runner.subprocess, "Popen", return_value=FakeProcess()), \
             patch.object(runner, "_wait_for_proxy", return_value=True), \
             patch.object(runner, "_curl_ip", side_effect=["198.51.100.24", "198.51.100.24"]), \
             patch.object(runner, "_sleep_for_hop") as sleep:
            result = runner._run_client(config, ["/usr/local/bin/hysteria", "client"], "198.51.100.24", hop_interval_seconds=5)
        self.assertEqual(result, {"status": "healthy", "failureCode": None})
        sleep.assert_called_once_with(5)

    def test_client_rejects_endpoint_address_when_expected_egress_is_different(self):
        class FakeProcess:
            def poll(self):
                return None

            def terminate(self):
                pass

            def wait(self, timeout):
                return 0

        config = {"inbounds": [{"port": 18080}]}
        with patch.object(runner.subprocess, "Popen", return_value=FakeProcess()), \
             patch.object(runner, "_wait_for_proxy", return_value=True), \
             patch.object(runner, "_curl_ip", return_value="203.0.113.10"):
            result = runner._run_client(
                config,
                ["/usr/local/bin/xray", "run", "-c"],
                "198.51.100.24",
            )
        self.assertEqual(result, {"status": "failed", "failureCode": "EXIT_MISMATCH"})

    def test_hop_check_fails_when_second_proxy_request_fails(self):
        class FakeProcess:
            def poll(self):
                return None

            def terminate(self):
                pass

            def wait(self, timeout):
                return 0

        config = {"socks5": {"listen": "127.0.0.1:18080"}}
        with patch.object(runner.subprocess, "Popen", return_value=FakeProcess()), \
             patch.object(runner, "_wait_for_proxy", return_value=True), \
             patch.object(runner, "_curl_ip", side_effect=["203.0.113.10", None]), \
             patch.object(runner, "_sleep_for_hop"):
            result = runner._run_client(config, ["/usr/local/bin/hysteria", "client"], "203.0.113.10", hop_interval_seconds=5)
        self.assertEqual(result, {"status": "unknown", "failureCode": "CHECK_UNAVAILABLE"})

    def test_missing_credentials_and_egress_outage_are_unknown_without_child_process(self):
        with patch.object(runner, "_read_credential", return_value=None), \
             patch.object(runner, "_curl_ip", return_value=None), \
             patch.object(runner, "_run_client") as child:
            result = self._run()
        child.assert_not_called()
        self.assertEqual({item["status"] for item in result["checks"].values()}, {"unknown"})

    def test_invalid_credential_is_unknown_and_does_not_start_client(self):
        with patch.object(runner, "_read_credential", side_effect=lambda _, name: VLESS.replace("security=reality", "security=none") if name == "vless.uri" else None), \
             patch.object(runner, "_curl_ip", return_value="198.51.100.7"), \
             patch.object(runner, "_run_client") as child:
            result = self._run()
        child.assert_not_called()
        self.assertEqual(result["checks"]["vless_tcp_443"]["status"], "unknown")

    def test_result_file_is_atomic_and_has_no_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "result.json"
            value = {"version": 1, "targetNode": "nl", "sampledAt": "2026-09-16T12:00:00+00:00", "checks": {}}
            runner._write_result(path, value)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), value)
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_client_process_is_terminated_and_private_config_removed(self):
        class FakeProcess:
            terminated = False

            def poll(self):
                return None

            def terminate(self):
                self.terminated = True

            def wait(self, timeout):
                return 0

        process = FakeProcess()
        paths = []

        def spawn(argv, **_kwargs):
            paths.append(Path(argv[-1]))
            self.assertTrue(paths[-1].exists())
            return process

        config = {"inbounds": [{"port": 18080}], "outbounds": []}
        with patch.object(runner.subprocess, "Popen", side_effect=spawn), \
             patch.object(runner, "_wait_for_proxy", return_value=True), \
             patch.object(runner, "_curl_ip", return_value=None):
            result = runner._run_client(config, ["/usr/local/bin/xray", "run", "-c"], "203.0.113.10")
        self.assertEqual(result, {"status": "unknown", "failureCode": "CHECK_UNAVAILABLE"})
        self.assertTrue(process.terminated)
        self.assertFalse(paths[0].exists())


if __name__ == "__main__":
    unittest.main()
