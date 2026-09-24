# Fifteen-minute external VPN probe cadence

Date: 2026-09-23

## Status and scope

The owner requested approximately one external VPN check every 15 minutes and
approved changing the currently deployed three-minute timers on 2026-09-23.
This change concerns only the `jarvis-vpn-probe@.timer` schedule on DE and NL.
It does not enable either timer, install test credentials, change probe logic,
alter VPN listeners, or authorize repair.

## Chosen behavior

Keep `OnBootSec=2min` so a previously enabled monitor can check soon after a
reboot. Change `OnUnitActiveSec=3min` to `15min`. Retain the existing
`RandomizedDelaySec=30s`, `AccuracySec=15s`, `Persistent=false`, and service
binding. The observed steady-state interval is therefore approximately 15
minutes, not a guarantee of exact wall-clock timing. Host/network status and
incident collection remain on their existing independent schedules.

Install the same unit file on DE and NL while both timers are disabled. Run
`systemd-analyze verify` and `systemctl daemon-reload`, then confirm the
effective `OnUnitActiveSec=15min` and `disabled/inactive` state on each host.
Do not run `enable --now`, `start`, or a probe service as part of this rollout.
If either host does not verify, leave both disabled, correct the mismatch, and
do not report the cadence change as fully deployed.

## Boundaries and verification

- The already deployed four-proof gate and private owner confirmation remain
  the only path to enabling the timers later.
- Add a source-level regression check for the timer interval and keep the
  existing Host Agent suite green.
- Verify source and installed unit hashes, effective systemd properties, and
  timer states on DE and NL. Record the rollout and the unchanged absence of
  accepted dedicated probe bindings.

## Alternatives considered

- Exact quarter-hour `OnCalendar` scheduling would synchronize both nodes and
  need a different missed-run policy. It is unnecessary for this monitor.
- Changing the internal Operations collector to 15 minutes would reduce
  host/service observability and does not solve the external client-probe
  cadence mismatch. Leave it unchanged.
