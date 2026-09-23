from pathlib import Path
import unittest


UNIT = Path(__file__).resolve().parents[2] / "deploy" / "vpn" / "jarvis-vpn-probe@.timer"


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
