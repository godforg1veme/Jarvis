# VPN Supervisor host-bound callback routing

Date: 2026-09-24

## Incident

A controlled NL Xray failure produced a valid Supervisor proposal. The
`details` button showed its shared database record, but `allow` was sent to the
DE `VpnSupervisorService`. DE correctly found a healthy DE snapshot and
rejected the stale/revised incident check. No Host Agent restart was sent.
NL Xray was restored manually; Hysteria2 remained healthy.

## Source fix

The new generic callback router checks owner and private-chat scope, loads the
run by its existing UUID, then matches the persisted `host_id` to exactly one
configured Supervisor service. It handles `details`, `reject`, and `allow`
through that service. The service independently verifies that the run belongs
to its host before returning details or changing state. Unknown, missing, or
ambiguous routes fail closed. The Telegram callback grammar and visible
confirmation flow are unchanged.

## Deployment and acceptance

- Router, Supervisor, and Telegram tests passed; the full server suite passed
  587/587 tests, the Telegram architecture/Supervisor focused gate passed
  112/112, and the production candidate-image test passed 78/78. Deployment
  preflight, Compose health, and public readiness/liveness smoke checks passed.
- The deployed candidate image was
  `sha256:c95cc41d1b4fdcd17a14c881d498ae029a11b912ba2de28ac2570b6caf5afccb`;
  the exact previous image is retained as
  `jarvis-family-server:rollback-before-supervisor-route-20260924-01`.
- After preflighting both nodes, the operator armed a unique seven-minute NL
  Xray restore watchdog and stopped only NL Xray. The owner approved the fresh
  NL proposal once. Its durable action completed `vpn.restart` with
  `POSTCHECK_PASSED`; the target and opposite VPN stacks passed postchecks.
  The watchdog was canceled before expiry and confirmed inactive; it did not
  perform the repair. The earlier stale proposal was not counted as acceptance
  and did not dispatch a restart.
- NL Xray and Hysteria2 and DE Xray and Hysteria2 were all active afterward;
  open VPN incidents were zero and public readiness returned HTTP 200.
  Scheduled post-repair probes passed all four checks
  (`hysteria2_udp_443`, `hysteria2_udp_hop`, `vless_tcp_443`,
  `vless_tcp_8443`) from NL toward DE at 13:53:25 UTC and DE toward NL at
  13:54:35 UTC on 2026-09-24.

This accepts the tested, narrowly scoped owner-approved restart path. It does
not prove automatic recovery, repair of other incident classes, unattended
certificate renewal, or 99.9% availability. Restore playbooks remain disabled.

## Monitoring and alert boundary

The two owner-enabled systemd runners test NL→DE and DE→NL at approximately
15-minute cadence for VLESS and Hysteria2. Their snapshots expose four checks
per target: VLESS TCP 443/8443 and Hysteria2 UDP fixed-443/hopping. These
external results are shown in `/vpn_health` and inform subscription priority;
they are not wired into Operations' Telegram incident notifier. A failing
external route therefore does not currently guarantee a proactive Telegram
alert.

Operations separately polls each node's local health snapshot (30-second
default). Three consecutive matching primary diagnoses open an incident and
notify the owner. The only real repair actions are matching owner-approved
restarts for `XRAY_SERVICE_FAILURE` and `HYSTERIA2_SERVICE_FAILURE`, subject to
the healthy-host/network, valid-config, healthy-opposite-stack, no-failed-probe
preconditions. Configuration, listener, host/network, Hysteria2 auth,
multi-stack, unknown, and external-probe failures remain diagnostic only.

Only the NL Xray service-failure case above has passed a live outage/repair
drill. The other three node/service combinations are covered by source policy
and simulated tests, not by separate production outage exercises.
