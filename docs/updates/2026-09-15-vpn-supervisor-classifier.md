# VPN Supervisor deterministic classifier rollout

**Date:** 2026-09-15
**Status:** implemented and deployed on the current production VPS

## Delivered

- Host Agent now attaches a versioned, deterministic diagnosis to every
  `vpn.health.snapshot` without executing commands or exposing free-form probe
  output.
- The classifier selects one causal primary incident across host, DNS,
  outbound connectivity, Xray, Hysteria 2, and the Hysteria authentication
  dependency. Protocol-probe uncertainty remains a bounded secondary signal.
- Jarvis Server strictly validates the diagnosis against the raw snapshot.
  Malformed, contradictory, or extra fields are rejected before persistence.
- Operations opens a classified `vpn.*` incident only after three identical
  observations, resolves superseded causes, and does not create duplicate
  generic Xray/Hysteria incidents.
- A missing or invalid health snapshot becomes the bounded
  `vpn.health_unavailable` incident after the same debounce.
- Owner Telegram `/vpn_health` renders the same closed cause, scope, severity,
  confidence, and next checks without credentials or raw diagnostic text.

This milestone is observation and diagnosis only. It makes no LLM request,
runs no repair playbook, rotates no key, and enrolls no additional VPS.

## Fault simulations

The Host Agent E2E path was exercised with isolated fixtures for DNS failure,
outbound failure, Xray service/config/listener failures, Hysteria
service/config/listener failures, authentication endpoint/credential failures,
and simultaneous multi-stack failure. The tests verify the selected primary
cause and assert that no repair or mutation output exists.

The server E2E path simulated an authentication outage, three-sample debounce,
single notification, changed root cause, healthy recovery, invalid diagnosis,
Host Agent health unavailability, and unknown protocol probes. It verifies that
no repair executor is called.

No production VPN fault was injected. Production acceptance used the real
healthy snapshot so active user traffic was not disrupted.

## Verification

- Host Agent local suite: 79/79 passed.
- Server local suite: 430/430 passed.
- Built production server image: 36/36 focused tests passed.
- Production Host Agent suite during deployment: 79/79 passed.
- Production `vpn.health.snapshot`: healthy primary state; Xray and Hysteria 2
  protocol probes reported only their expected informational unverified state.
- Production server container: healthy after replacement.
- Public `deploy/scripts/smoke.sh https://jarvis.rilora.ru`: passed.
- `jarvis-host-agent`, `xray`, and `hysteria-server`: active.
- Open classified `vpn.*` incidents after the live collection cycle: none.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.

The pre-rollout server tree is retained on the VPS at
`/home/deploy/apps/jarvis/.deploy-backups/pre-3f33214-server.tar.gz`.

## Next milestone

Add the central multi-node registry and signed node transport, then the
versioned LLM system instruction and closed repair-playbook catalog. Every
model proposal must pass deterministic policy. Key rotation remains a changing
action and must send the owner a Telegram confirmation naming the affected
device and the reason before execution.
