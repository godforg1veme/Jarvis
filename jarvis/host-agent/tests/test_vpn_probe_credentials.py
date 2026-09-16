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
        probe_target=SimpleNamespace(node_code=target, vless_host="203.0.113.10", hysteria_host="vpn.example.test"),
        probe_credential_dir=root,
    )


class ProbeCredentialStoreTests(unittest.TestCase):
    def test_installs_only_opposite_node_validated_credential_with_root_only_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = install_probe_credential(config_for(root), target_node="de", protocol="vless", credential=VLESS_DE)
            path = root / "probe-de-vless.uri"
            self.assertEqual(result["targetNode"], "de")
            self.assertEqual(result["protocol"], "vless")
            if os.name != "nt":
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            else:
                self.assertTrue(path.is_file())
            self.assertNotIn("vless://", str(result))

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
