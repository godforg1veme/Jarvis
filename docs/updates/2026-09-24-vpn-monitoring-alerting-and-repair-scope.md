# VPN monitoring, alerting, and owner-confirmed repair scope

Date: 2026-09-24

## What is monitored

Both production cross-node systemd timers are enabled at an approximately
15-minute cadence. The Netherlands runner checks Germany, and the Germany
runner checks the Netherlands. Four separately installed owner-confirmed test
bindings cover the protocol/direction pairs:

| Runner → target | Protocol |
| --- | --- |
| NL → DE | VLESS |
| NL → DE | Hysteria2 |
| DE → NL | VLESS |
| DE → NL | Hysteria2 |

Each target snapshot reports four statuses: VLESS TCP 443, VLESS TCP 8443,
Hysteria2 UDP fixed port 443, and the Hysteria2 UDP hopping route. All four
owner-approved bindings have fresh successful one-shot proofs, and both timers
have completed healthy scheduled runs after activation and after the live NL
Xray repair drill.

## What sends an alert

Operations independently polls each node's local Host Agent `vpn.health.snapshot`
at `JARVIS_OPERATIONS_POLL_INTERVAL_MS` (default 30 seconds). Its VPN incident
adapter opens an incident only after three consecutive observations of the
same primary diagnosis. Opening the incident sends an owner Telegram alert.
Examples include host/network failures, local Xray or Hysteria2 service/config/
listener state, Hysteria2 auth, multi-stack failure, and unknown/invalid
diagnosis. A single Operations incident notification is not repeated on every
poll.

The scheduled cross-node probe results do **not** currently feed that incident
adapter/notifier. A failed timer probe therefore does not currently guarantee
a proactive Telegram alert for that specific direction. `/vpn_health` displays
the external results. When a subscription is generated, an explicitly failed
VLESS TCP 8443 or Hysteria2 hopping check can lower that node's priority;
unknown or missing data is not treated as a failed check. Client-side failover
is separate and depends on the client/profile.

## What can restart

The Supervisor can propose only these two service-restart playbooks on either
node:

| Incident code | Fixed action |
| --- | --- |
| `XRAY_SERVICE_FAILURE` | Restart only that node's Xray service |
| `HYSTERIA2_SERVICE_FAILURE` | Restart only that node's Hysteria2 service |

Before a proposal is shown, the deterministic policy and bounded planner must
agree on a high-confidence matching service failure with no unresolved checks.
Host, DNS, and outbound connectivity must be healthy; the affected stack's
configuration must validate; the other stack must be healthy; protocol probes
must not be failed; Hysteria2 auth checks must also be safe for either restart.
The server rechecks the diagnosis and health immediately before dispatch.

The proposal is **not** an automatic restart. The owner must confirm it in the
originating private Telegram chat within ten minutes. Only the selected service
is restarted. A fresh post-action snapshot must show both stacks healthy. An
uncertain action is reconciled by the same request ID and never blindly
replayed; failure does not trigger a second restart or automatic config
rollback. Known-good restore playbooks remain disabled.

Configuration, listener, DNS/outbound, host, Hysteria2 auth, multi-stack,
invalid/unknown, and external path-probe failures are diagnostics/alerts only;
they do not authorize a restart, credential rotation, or configuration
restore.

## Live acceptance boundary

The first controlled NL Xray failure exposed a button-routing defect: its
owner's approval was sent to the DE Supervisor and safely canceled without a
restart. After host-bound routing was deployed, the owner-approved NL Xray
failure drill completed `vpn.restart` with `POSTCHECK_PASSED`; both VPN stacks
on both VPS nodes were active and cross-node checks passed afterward. This is
the only live production service-failure restart exercised so far. DE Xray,
DE Hysteria2, and NL Hysteria2 have source and simulated-test coverage but have
not each had a separate live outage test.

The dual-name NL DNS-01 certificate setup is provisioned, but unattended
renewal has not yet been observed. Neither scheduled probes nor this single
repair drill establish 99.9% availability.
