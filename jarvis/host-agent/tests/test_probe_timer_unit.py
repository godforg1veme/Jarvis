from pathlib import Path
import unittest


UNIT = Path(__file__).resolve().parents[2] / "deploy" / "vpn" / "jarvis-vpn-probe@.timer"
SERVICE = UNIT.with_name("jarvis-vpn-probe@.service")


class ProbeTimerUnitTests(unittest.TestCase):
    def test_safe_fifteen_minute_cadence(self):
        lines = set(UNIT.read_text(encoding="utf-8").splitlines())
        for directive in (
            "OnBootSec=2min",
            "OnUnitActiveSec=15min",
            "RandomizedDelaySec=30s",
            "AccuracySec=15s",
            "Persistent=false",
            "Unit=jarvis-vpn-probe@%i.service",
        ):
            self.assertIn(directive, lines)

    def test_service_uses_host_agent_credential_directory_and_keeps_isolation(self):
        lines = set(SERVICE.read_text(encoding="utf-8").splitlines())
        for directive in (
            "DynamicUser=yes",
            "EnvironmentFile=/etc/jarvis-vpn/probes/probe-%i.env",
            "LoadCredential=vless.uri:/etc/jarvis-vpn/probes/probe-%i-vless.uri",
            "LoadCredential=hysteria2.uri:/etc/jarvis-vpn/probes/probe-%i-hysteria2.uri",
            "NoNewPrivileges=yes",
            "PrivateTmp=yes",
            "ProtectHome=yes",
            "ProtectSystem=strict",
            "RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX",
            "UMask=0077",
        ):
            self.assertIn(directive, lines)
