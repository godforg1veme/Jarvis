# VPN probe expected-egress baseline design

Status: conversational design approved on 2026-09-23; awaiting written-spec
review before implementation.

## Problem and evidence

The owner-confirmed NL-to-DE VLESS recheck completed on 2026-09-23 at
20:30 UTC. The systemd runner exited successfully, but its bounded result was
`EXIT_MISMATCH` for VLESS TCP 443 and 8443. The existing install attempt remains
`unknown`; the recheck is a separate failed audit row. No key was changed, no
probe was repeated, and both timers remain disabled.

The current Host Agent configuration gives `vlessHost` two jobs: it is the
connection address for parsing/building the VLESS test, and
`vpn_probe_credentials._public_probe_environment` also copies it to
`VPN_PROBE_EXPECTED_EXIT_IP`. The runner then compares the public IP returned
through the proxy with that value. A read-only check found the target node's
direct egress differs from the configured VLESS connection address. Xray on
DE has a `freedom` default outbound without a `sendThrough` override or an
explicit `api.ipify.org` domain route. The runner intentionally does not persist
the observed IP, so the mismatch strongly implicates a conflated baseline but
does not itself prove that the tunneled connection used the intended egress.

## Goal

Represent a node's expected public egress independently from the endpoint used
to connect to its VLESS and Hysteria2 services. Keep the existing strict
end-to-end egress comparison, but compare against the correct, explicitly
configured node baseline. Preserve the closed result contract and all owner
confirmation, credential, and timer gates.

## Design

1. Add a required `expectedExitIp` field to the trusted `probeTarget` object in
   Host Agent configuration and `ProbeTarget`. Validate it as an IP literal
   with Python `ipaddress`; missing or invalid values make configuration
   invalid. Do not infer it from `vlessHost` or `hysteriaHost`.
2. Keep `vlessHost` and `hysteriaHost` exclusively as client connection
   endpoints. Generate `VPN_PROBE_EXPECTED_EXIT_IP` from `expectedExitIp`.
   Leave the runner's comparison behavior unchanged: both the fixed and hopping
   checks must return exactly the configured expected egress IP.
3. Keep probe results, Host Agent responses, logs, and Telegram output limited
   to the existing node/check/timestamp/closed-status/closed-failure-code
   schema. Never return or persist the actual observed IP or any credential.
4. Before production rollout, independently observe each node's direct egress
   more than once and verify its service outbound path is consistent with that
   address. If a node's egress is unstable or differs by protocol, stop and
   revise the model instead of guessing. Store only the confirmed egress IP in
   the root-managed Host Agent configuration.
5. During rollout, regenerate the root-only public probe environment file from
   the trusted config on each source node. This updates metadata only and must
   not read, replace, reinstall, or rotate any `.uri` credential. Back up the
   config and environment file first. Keep both timers disabled and restart
   Host Agent one node at a time.

## Alternatives considered

- **Several expected egress addresses per node:** accommodates intentional
  multi-egress routing, but widens the set of paths accepted as healthy. Defer
  unless real protocol/path inspection shows that one node has multiple
  legitimate egresses.
- **Remove egress identity checking:** would confirm only that an HTTP request
  succeeded through some tunnel. It could accept traffic exiting through the
  wrong node, so it is rejected.

The selected single explicit egress IP is fail-closed and minimal for the
currently deployed topology. A missing, invalid, or unknown baseline must not
produce a healthy result.

## Verification and rollout acceptance

- Config tests reject missing, invalid, and non-IP `expectedExitIp` values and
  allow an expected egress distinct from the service connection address.
- Credential-environment tests prove the generated value comes from
  `expectedExitIp`, while endpoint fields remain unchanged and no credentials
  enter the environment file.
- Runner tests prove matching VLESS and Hysteria2 responses pass against a
  distinct expected egress and mismatches remain `EXIT_MISMATCH`; result files
  still contain no observed IP or credentials.
- Run focused Host Agent tests, then the full Host Agent suite. Check the
  production config and unit backups, deploy to DE/NL one at a time, verify
  service health, environment-file metadata, and that timers remain disabled.
- Do not run a credential-backed check as part of implementation or deployment.
  The owner must separately confirm a fresh NL-to-DE VLESS recheck in Telegram.
  Preserve both audit rows as-is. A passing recheck can establish only the
  first binding; the other three distinct owner-approved proofs and a separate
  timer-activation confirmation remain required.

This does not promise 99.9% uptime. It corrects one test baseline and still
requires the four-proof acceptance gate and real client-side Happ testing.

## Rollback

Restore the exact backed-up Host Agent source/configuration and generated
environment files on each node, one at a time. Keep timers disabled. Retain
existing test credentials and audit rows; never replay the unknown install or
rotate the installed key as rollback.
