import os
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from jarvis_host_agent.vpn_probe_credentials import (
    ProbeCredentialError,
    _atomic_root_file,
    install_probe_credential,
    install_probe_environment,
    probe_credential_readiness,
)


VLESS_DE = (
    "vless://123e4567-e89b-42d3-a456-426614174000@203.0.113.10:8443"
    "?encryption=none&flow=xtls-rprx-vision&security=reality&headerType=none"
    "&sni=example.test&fp=chrome&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "&sid=0123456789abcdef&type=tcp&xtls=2#SyntheticProbe"
)
HYSTERIA_DE = (
    "hy2://vpn-0123456789ab:synthetic-password@vpn.example.test:443/"
    "?obfs=salamander&obfs-password=synthetic-obfs&sni=vpn.example.test#SyntheticProbe"
)


def config_for(root: Path, node_code: str = "nl"):
    target = "de" if node_code == "nl" else "nl"
    return SimpleNamespace(
        node_code=node_code,
        probe_target=SimpleNamespace(
            node_code=target,
            vless_host="203.0.113.10",
            hysteria_host="vpn.example.test",
            expected_exit_ip="198.51.100.24",
        ),
        probe_credential_dir=root,
    )


class ProbeCredentialStoreTests(unittest.TestCase):
    @unittest.skipIf(os.name == "nt", "root-only metadata is verified on Linux")
    def test_readiness_requires_requested_key_and_complete_private_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "credentials"
            config = config_for(root)
            install_probe_environment(config, target_node="de")
            self.assertEqual(probe_credential_readiness(config, target_node="de", protocol="vless"), "not_installed")
            install_probe_credential(config, target_node="de", protocol="vless", credential=VLESS_DE)
            self.assertEqual(probe_credential_readiness(config, target_node="de", protocol="vless"), "ready")
            self.assertEqual(probe_credential_readiness(config, target_node="de", protocol="hysteria2"), "not_installed")
            (root / "probe-de.env").unlink()
            self.assertEqual(probe_credential_readiness(config, target_node="de", protocol="vless"), "configuration_invalid")

    @unittest.skipIf(os.name == "nt", "root-only metadata is verified on Linux")
    def test_readiness_refuses_unsafe_metadata_without_reading_credential(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "credentials"
            config = config_for(root)
            install_probe_credential(config, target_node="de", protocol="vless", credential=VLESS_DE)
            requested = root / "probe-de-vless.uri"
            requested.chmod(0o644)
            self.assertEqual(probe_credential_readiness(config, target_node="de", protocol="vless"), "configuration_invalid")
            requested.chmod(0o600)
            root.chmod(0o755)
            self.assertEqual(probe_credential_readiness(config, target_node="de", protocol="vless"), "configuration_invalid")

    def test_installs_only_opposite_node_validated_credential_with_root_only_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = install_probe_credential(config_for(root), target_node="de", protocol="vless", credential=VLESS_DE)
            path = root / "probe-de-vless.uri"
            placeholder = root / "probe-de-hysteria2.uri"
            self.assertEqual(result["targetNode"], "de")
            self.assertEqual(result["protocol"], "vless")
            self.assertTrue(placeholder.is_file())
            self.assertEqual(placeholder.read_bytes(), b"")
            if os.name != "nt":
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                self.assertEqual(stat.S_IMODE(placeholder.stat().st_mode), 0o600)
            else:
                self.assertTrue(path.is_file())
            self.assertNotIn("vless://", str(result))

    def test_installs_hysteria_ip_endpoint_with_distinct_tls_name(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = config_for(root)
            config.probe_target.hysteria_host = "203.0.113.10"
            credential = HYSTERIA_DE.replace("@vpn.example.test:443", "@203.0.113.10:443")
            result = install_probe_credential(config, target_node="de", protocol="hysteria2", credential=credential)
            self.assertEqual(result["protocol"], "hysteria2")
            self.assertEqual((root / "probe-de-hysteria2.uri").read_text(encoding="utf-8"), credential)
            self.assertNotIn("hy2://", str(result))

    def test_creating_missing_counterpart_preserves_existing_regular_credential(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            counterpart = root / "probe-de-hysteria2.uri"
            counterpart.write_text(HYSTERIA_DE, encoding="utf-8")
            if os.name != "nt":
                counterpart.chmod(0o600)
            install_probe_credential(config_for(root), target_node="de", protocol="vless", credential=VLESS_DE)
            self.assertEqual(counterpart.read_text(encoding="utf-8"), HYSTERIA_DE)

    def test_refuses_symlink_counterpart(self):
        if os.name == "nt":
            self.skipTest("symlink creation permissions vary on Windows")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "outside"
            target.write_text("synthetic", encoding="utf-8")
            (root / "probe-de-hysteria2.uri").symlink_to(target)
            with self.assertRaises(ProbeCredentialError):
                install_probe_credential(config_for(root), target_node="de", protocol="vless", credential=VLESS_DE)

    def test_installs_public_probe_environment_without_uri_or_credential(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            install_probe_environment(config_for(root), target_node="de")
            content = (root / "probe-de.env").read_text(encoding="utf-8")
            self.assertIn("VPN_PROBE_HYSTERIA_HOP_POOL=", content)
            self.assertIn('"hopIntervalSeconds":30', content)
            self.assertIn("VPN_PROBE_VLESS_HOST=203.0.113.10", content)
            self.assertIn("VPN_PROBE_EXPECTED_EXIT_IP=198.51.100.24", content)
            self.assertNotIn("VPN_PROBE_EXPECTED_EXIT_IP=203.0.113.10", content)
            self.assertNotIn("vless://", content)
            self.assertNotIn("synthetic-password", content)

    def test_rejects_invalid_expected_exit_ip_without_writing_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = config_for(root)
            config.probe_target.expected_exit_ip = "203.0.113.10\nUNSAFE=value"
            with self.assertRaises(ProbeCredentialError):
                install_probe_environment(config, target_node="de")
            self.assertFalse((root / "probe-de.env").exists())

    def test_rejects_same_node_mismatched_host_and_symlink_without_echoing_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ProbeCredentialError) as same_node:
                install_probe_credential(config_for(root, "de"), target_node="de", protocol="vless", credential=VLESS_DE)
            with self.assertRaises(ProbeCredentialError) as mismatched_host:
                install_probe_credential(config_for(root), target_node="de", protocol="vless", credential=VLESS_DE.replace("203.0.113.10", "198.51.100.7"))
            target = root / "probe-de-hysteria2.uri"
            target.write_text("synthetic", encoding="utf-8")
            real_lstat = os.lstat
            with patch("jarvis_host_agent.vpn_probe_credentials.os.lstat", side_effect=lambda path: (
                SimpleNamespace(st_mode=stat.S_IFLNK) if Path(path) == target else real_lstat(path)
            )):
                with self.assertRaises(ProbeCredentialError) as hostile_path:
                    _atomic_root_file(target, "synthetic")
            for caught in (same_node, mismatched_host, hostile_path):
                self.assertNotIn("vless://", str(caught.exception))
                self.assertNotIn("synthetic-password", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
