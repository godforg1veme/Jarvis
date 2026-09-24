# VPN external-probe gate and monitor activation rollout

Date: 2026-09-23

The integrated Jarvis Server source at `f7af2a7` was built in an isolated
stage and deployed to DE without changing the Xray or Hysteria2 services,
Host Agent units, probe credentials, or systemd timers. The prior server image
was retained as `jarvis-family-server:rollback-before-f7af2a7` for rollback.
The nine source files differing from the prior running image were also copied
to the canonical VPS build directory after confirming each canonical file
matched that prior image. Their previous versions are retained under
`.backups/vpn-release-f7af2a7-yuCFqo`; all nine canonical hashes then matched
the new running container. No `.env` or secret file was copied.

## Verified

- Local server regression: 544/544 tests passed, including confirmed one-shot
  probe proofs, latest-proof database gating, sequential two-node activation,
  one first-side compensation, and unknown-outcome behavior.
- Production preflight and public smoke passed before and after the server
  switch. The new container reached Docker health `healthy`; its image ID
  matched the isolated candidate build, and its probe-workflow file hash
  matched the staged source.
- Production playbook flags before the switch allowed only
  `restart_xray`, `restart_hysteria2`, and synthetic
  `supervisor_acceptance_noop`; both restore playbooks were disabled. The
  existing synthetic no-op has one succeeded owner-acceptance record. No real
  repair run or probe action was present in the production database.
- After the switch, Xray and Hysteria2 remained active on DE and NL. Both
  cross-node probe timers remained `disabled/inactive`.
- The deployed repository method `hasVerifiedProbeBindings()` returned
  `false` against production PostgreSQL, as expected with no accepted
  dedicated test-device bindings. No timer enable was attempted.
- A bounded error-level log count for the new server's first five minutes was
  zero. This does not prove live Telegram delivery or VPN repair acceptance.

## Not yet accepted at this rollout snapshot

At this rollout snapshot, no dedicated test credential had yet been installed.
The later NL-to-DE VLESS install/recheck state is recorded in
[`2026-09-23-vpn-probe-credential-recheck-rollout.md`](2026-09-23-vpn-probe-credential-recheck-rollout.md).
The four owner-confirmed
one-shot checks, actual timer activation, Happ phone traffic and split-routing
checks, and the first real owner-confirmed restart remain unverified. A healthy
server container does not establish any of these outcomes or a 99.9% service
level. The NL Hysteria certificate-renewal hostname remains separate work.

If a monitor activation returns unknown, inspect both timer states and the
original Host Agent request outcomes before any new owner-confirmed action;
never retry an uncertain enable under a new request ID merely because its
connection failed.

## Fifteen-minute schedule update

After the owner's separate approval, the shared probe timer was changed from
`OnUnitActiveSec=3min` to `15min`. `OnBootSec=2min`, 30-second randomized
delay, 15-second accuracy, `Persistent=false`, and the service binding were
left unchanged. The new static test failed against the old source, passed
after the change, and the 108-test Host Agent suite passed under root (two
root-only temporary-file tests cannot pass as unprivileged `deploy`).

The exact same unit hash (`e9ff8e88ee760219cba01eabe43c60109ea0e1d66bd133a9daf91a51aa18ef08`)
was installed on DE and NL. `systemd-analyze verify` and `daemon-reload`
passed on both. Effective systemd properties reported `OnUnitActiveUSec=15min`,
`OnBootUSec=2min`, 30-second jitter and 15-second accuracy. Both instance
timers remained `disabled/inactive`; Xray and Hysteria2 remained active on both
nodes. The previous installed unit was retained at
`/etc/systemd/system/jarvis-vpn-probe@.timer.pre-15min-20260923` on each node.
Production preflight, public smoke, and server container health passed after
the unit update. No probe service ran, credential was installed, or timer was
enabled as part of this rollout.
