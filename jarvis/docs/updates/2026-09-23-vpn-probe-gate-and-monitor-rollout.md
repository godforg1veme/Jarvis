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

## Not yet accepted

No dedicated test credential has been installed. The four owner-confirmed
one-shot checks, actual timer activation, Happ phone traffic and split-routing
checks, and the first real owner-confirmed restart remain unverified. A healthy
server container does not establish any of these outcomes or a 99.9% service
level. The NL Hysteria certificate-renewal hostname remains separate work.

If a monitor activation returns unknown, inspect both timer states and the
original Host Agent request outcomes before any new owner-confirmed action;
never retry an uncertain enable under a new request ID merely because its
connection failed.
