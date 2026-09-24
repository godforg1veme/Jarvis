import unittest
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from jarvis_host_agent.vpn_external_probe import (
    ProbeConfigError,
    build_hysteria_client_config,
    build_xray_client_config,
    parse_hysteria_uri,
    parse_vless_uri,
    validate_probe_result,
    read_probe_result,
)


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


class ExternalProbeContractTests(unittest.TestCase):
    def test_vless_config_is_loopback_only_and_strict_reality(self):
        parsed = parse_vless_uri(VLESS, expected_host="203.0.113.10")
        config = build_xray_client_config(parsed, 18080)
        self.assertEqual(config["inbounds"][0]["listen"], "127.0.0.1")
        self.assertEqual(config["outbounds"][0]["streamSettings"]["security"], "reality")
        self.assertEqual(config["outbounds"][0]["settings"]["vnext"][0]["port"], 8443)
        self.assertEqual(config["outbounds"][0]["streamSettings"]["realitySettings"]["serverName"], "example.test")

    def test_vless_rejects_duplicate_or_missing_security_fields_without_echoing_uri(self):
        for bad in (VLESS.replace("&sid=", "&sid=00&sid="), VLESS.replace("security=reality", "security=none"),
                    VLESS.replace("&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", ""), VLESS + "\nBearer secret"):
            with self.subTest(case=len(bad)):
                with self.assertRaises(ProbeConfigError) as caught:
                    parse_vless_uri(bad, expected_host="203.0.113.10")
                self.assertNotIn("vless://", str(caught.exception))
                self.assertNotIn("Bearer", str(caught.exception))

    def test_hysteria_config_uses_strict_tls_and_salamander(self):
        parsed = parse_hysteria_uri(HYSTERIA, expected_host="vpn.example.test")
        config = build_hysteria_client_config(parsed, 18081)
        self.assertEqual(config["socks5"]["listen"], "127.0.0.1:18081")
        self.assertEqual(config["tls"]["sni"], "vpn.example.test")
        self.assertNotIn("insecure", config["tls"])
        self.assertEqual(config["obfs"]["type"], "salamander")
        self.assertEqual(config["auth"], "vpn-0123456789ab:synthetic-password")

    def test_hysteria_ip_endpoint_uses_distinct_certificate_name(self):
        uri = HYSTERIA.replace("@vpn.example.test:443", "@203.0.113.10:443")
        parsed = parse_hysteria_uri(uri, expected_host="203.0.113.10")
        config = build_hysteria_client_config(parsed, 18081)
        self.assertEqual(config["server"], "203.0.113.10:443")
        self.assertEqual(config["tls"], {"sni": "vpn.example.test"})
        with self.assertRaises(ProbeConfigError):
            parse_hysteria_uri(uri, expected_host="198.51.100.7")

    def test_hysteria_rejects_missing_auth_obfs_and_duplicate_query(self):
        for bad in (HYSTERIA.replace("synthetic-password", ""), HYSTERIA.replace("obfs=salamander", "obfs=none"),
                    HYSTERIA.replace("&sni=", "&obfs=salamander&sni=")):
            with self.subTest(case=len(bad)):
                with self.assertRaises(ProbeConfigError):
                    parse_hysteria_uri(bad, expected_host="vpn.example.test")

    def test_uris_are_bound_to_the_declared_target_host(self):
        with self.assertRaises(ProbeConfigError):
            parse_vless_uri(VLESS, expected_host="198.51.100.7")
        with self.assertRaises(ProbeConfigError):
            parse_hysteria_uri(HYSTERIA, expected_host="other.example.test")

    def test_result_is_closed_target_bound_and_fresh(self):
        now = datetime(2026, 9, 16, 12, 0, tzinfo=timezone.utc)
        result = {"version": 1, "targetNode": "nl", "sampledAt": "2026-09-16T11:59:00Z", "checks": {
            "vless_tcp_443": {"status": "healthy", "failureCode": None},
            "vless_tcp_8443": {"status": "unknown", "failureCode": "NOT_CONFIGURED"},
            "hysteria2_udp_443": {"status": "healthy", "failureCode": None},
            "hysteria2_udp_hop": {"status": "healthy", "failureCode": None},
        }}
        self.assertEqual(validate_probe_result(result, "nl", now)["targetNode"], "nl")
        for bad in ({**result, "targetNode": "de"}, {**result, "secret": "synthetic"},
                    {**result, "sampledAt": "2026-09-16T11:40:00Z"},
                    {**result, "version": True},
                    {**result, "checks": {**result["checks"], "vless_tcp_443": {"status": "failed", "failureCode": []}}},
                    {**result, "checks": {**result["checks"], "hysteria2_udp_hop": {"status": "healthy", "failureCode": "hy2://must-not-appear"}}}):
            with self.assertRaises(ProbeConfigError):
                validate_probe_result(bad, "nl", now)

    def test_read_only_result_reader_returns_unknown_for_missing_or_hostile_file(self):
        now = datetime(2026, 9, 16, 12, 0, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            missing = read_probe_result("de", root=root, now=now)
            self.assertEqual(missing["checks"]["vless_tcp_443"],
                             {"status": "unknown", "failureCode": "RUNNER_UNAVAILABLE"})
            (root / "de.json").write_text(json.dumps({"secret": "must-not-leak"}), encoding="utf-8")
            invalid = read_probe_result("de", root=root, now=now)
            self.assertNotIn("must-not-leak", json.dumps(invalid))
            self.assertEqual(invalid["checks"]["hysteria2_udp_443"]["status"], "unknown")
            self.assertEqual(set(invalid["checks"]), {"vless_tcp_443", "vless_tcp_8443", "hysteria2_udp_443", "hysteria2_udp_hop"})


if __name__ == "__main__":
    unittest.main()
