# VPN Probe Fifteen-Minute Cadence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schedule each future cross-node external VPN probe approximately every 15 minutes while keeping both production timers disabled until owner acceptance.

**Architecture:** Change only `OnUnitActiveSec` in the shared systemd template. A static regression test protects the schedule. Deploy the same verified unit to DE and NL with backups, reload systemd, and read back the effective schedule and disabled state.

**Tech Stack:** systemd timer unit, Python `unittest`, Ubuntu 24.04.

**Spec:** `docs/superpowers/specs/2026-09-23-vpn-probe-15-minute-cadence-design.md`

## Global Constraints

- Keep `OnBootSec=2min`, `RandomizedDelaySec=30s`, `AccuracySec=15s`, `Persistent=false`, and the service binding unchanged.
- Do not enable or start either timer, run probe services, install credentials, restart VPN listeners, or broaden repair authority.
- The four-proof gate and owner confirmation remain the only later timer-enable path.

---

### Task 1: Source schedule and regression

**Files:**
- Modify: `deploy/vpn/jarvis-vpn-probe@.timer`
- Create: `host-agent/tests/test_probe_timer_unit.py`
- Modify: `docs/VPN_RESILIENCE_RUNBOOK.md`

**Interfaces:**
- Consumes: systemd timer directives in the deployed unit template.
- Produces: `OnUnitActiveSec=15min` with all other directives unchanged.

- [x] **Step 1: Write failing static test**

```python
from pathlib import Path
import unittest

UNIT = Path(__file__).resolve().parents[2] / "deploy" / "vpn" / "jarvis-vpn-probe@.timer"

class ProbeTimerUnitTests(unittest.TestCase):
    def test_safe_fifteen_minute_cadence(self):
        lines = set(UNIT.read_text(encoding="utf-8").splitlines())
        for directive in ("OnBootSec=2min", "OnUnitActiveSec=15min",
                          "RandomizedDelaySec=30s", "AccuracySec=15s",
                          "Persistent=false", "Unit=jarvis-vpn-probe@%i.service"):
            self.assertIn(directive, lines)
```

- [x] **Step 2: Verify the new test fails on the three-minute source**

```powershell
python -m unittest discover -s host-agent/tests -p test_probe_timer_unit.py
```

- [x] **Step 3: Change the single timer directive**

```ini
OnUnitActiveSec=15min
```

- [x] **Step 4: Run static and adjacent Host Agent tests**

```powershell
python -m unittest discover -s host-agent/tests -p test_probe_timer_unit.py
```

On Linux, also run `PYTHONPATH=host-agent python3 -m unittest discover -s host-agent/tests`.

- [x] **Step 5: Document source behavior and commit**

State that this is an approximate 15-minute interval with the existing jitter and two-minute first check after reboot, and that both production timers remain disabled. Then run `git diff --check` and commit the unit, test, runbook, and plan.

### Task 2: Deploy disabled units and verify

**Files:**
- Modify: DE `/etc/systemd/system/jarvis-vpn-probe@.timer`
- Modify: NL `/etc/systemd/system/jarvis-vpn-probe@.timer`
- Modify: `docs/updates/2026-09-23-vpn-probe-gate-and-monitor-rollout.md`
- Modify: `AGENTS.md`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: verified source timer from Task 1 and existing disabled systemd units.
- Produces: the same verified `15min` effective unit on both nodes, still disabled/inactive.

- [ ] **Step 1: Check both live timer states and exact old unit paths**

```sh
ssh jarvis-vps 'systemctl is-enabled jarvis-vpn-probe@nl.timer; systemctl is-active jarvis-vpn-probe@nl.timer; systemctl show -p FragmentPath -p OnUnitActiveUSec jarvis-vpn-probe@nl.timer'
ssh jarvis-vps-new 'systemctl is-enabled jarvis-vpn-probe@de.timer; systemctl is-active jarvis-vpn-probe@de.timer; systemctl show -p FragmentPath -p OnUnitActiveUSec jarvis-vpn-probe@de.timer'
```

- [ ] **Step 2: Back up and install the verified unit on each node**

```sh
ssh jarvis-vps 'sudo install -m 0644 /etc/systemd/system/jarvis-vpn-probe@.timer /etc/systemd/system/jarvis-vpn-probe@.timer.pre-15min-20260923'
ssh jarvis-vps-new 'sudo install -m 0644 /etc/systemd/system/jarvis-vpn-probe@.timer /etc/systemd/system/jarvis-vpn-probe@.timer.pre-15min-20260923'
scp deploy/vpn/jarvis-vpn-probe@.timer jarvis-vps:/home/deploy/apps/jarvis/deploy/vpn/jarvis-vpn-probe@.timer
scp deploy/vpn/jarvis-vpn-probe@.timer jarvis-vps-new:/home/deploy/apps/jarvis/deploy/vpn/jarvis-vpn-probe@.timer
ssh jarvis-vps 'sudo install -m 0644 /home/deploy/apps/jarvis/deploy/vpn/jarvis-vpn-probe@.timer /etc/systemd/system/jarvis-vpn-probe@.timer && sudo systemd-analyze verify /etc/systemd/system/jarvis-vpn-probe@.timer && sudo systemctl daemon-reload'
ssh jarvis-vps-new 'sudo install -m 0644 /home/deploy/apps/jarvis/deploy/vpn/jarvis-vpn-probe@.timer /etc/systemd/system/jarvis-vpn-probe@.timer && sudo systemd-analyze verify /etc/systemd/system/jarvis-vpn-probe@.timer && sudo systemctl daemon-reload'
```

- [ ] **Step 3: Read back both effective intervals and disabled states**

```sh
ssh jarvis-vps 'systemctl show -p OnUnitActiveUSec jarvis-vpn-probe@nl.timer; systemctl is-enabled jarvis-vpn-probe@nl.timer; systemctl is-active jarvis-vpn-probe@nl.timer; sha256sum /etc/systemd/system/jarvis-vpn-probe@.timer'
ssh jarvis-vps-new 'systemctl show -p OnUnitActiveUSec jarvis-vpn-probe@de.timer; systemctl is-enabled jarvis-vpn-probe@de.timer; systemctl is-active jarvis-vpn-probe@de.timer; sha256sum /etc/systemd/system/jarvis-vpn-probe@.timer'
```

- [ ] **Step 4: Update rollout status and commit documentation**

Record observed DE/NL properties, unchanged disabled/inactive states, backup locations, and that no live one-shot acceptance or timer activation occurred. Run `git diff --check` before committing documentation.
