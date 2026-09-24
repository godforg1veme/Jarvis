# Host-bound VPN Supervisor callback routing — 2026-09-24

## Incident and root cause

On 2026-09-24 a controlled NL Xray stop produced an eligible
`restart_xray` Supervisor proposal and a real owner Telegram button. The
owner's `details` tap displayed the NL record, but `allow` returned
"diagnosis changed" while NL Xray was still stopped. The Telegram message
service passed every `vpsup:*` callback to the DE `VpnSupervisorService`.
Both services share the run repository, so DE could read and display NL's
record, but its confirmation recheck used a DE Host Agent snapshot. That
snapshot was healthy and correctly failed the incident-revision check. The
run became stale; no restart executed. NL Xray was restored manually and
the incident resolved.

## Decision

Introduce one Supervisor callback router that takes a closed registry of
configured node services. A callback carries only its existing run UUID.
The router looks up that run and chooses the service whose trusted
`hostIdProvider` matches the persisted `host_id`. It routes all three
actions—`details`, `reject`, and `allow`—through the same selection. It never
uses message text, button label, inferred country, or model output to choose
a node. Unknown/missing run IDs, unknown host IDs, and unavailable lookup
fail closed without calling any Host Agent mutation. The existing DE-only
synthetic no-op text command remains unchanged.

Add a second host-ownership check inside `VpnSupervisorService.handleCallback`
before returning details or making any decision. This protects direct calls
and future routing regressions. The existing owner identity, private chat,
expiry, playbook catalog, incident revision, deterministic policy, durable
claim, original-ID reconciliation, and post-restart two-stack verification
remain authoritative. No labels, rows, callback bytes/grammar, confirmation
text, or authorization scope change for valid requests.

The router accepts a registry, not a hardcoded NL branch. Adding a future
configured node must register its service and host provider; an unregistered
node fails closed. This covers all current and later Supervisor diagnosis
types on registered nodes because the routing key is the saved run host,
not a diagnosis code.

## Alternatives rejected

- Add `de`/`nl` to callback data: expands the public grammar, still requires
  server-side validation, and makes a forgeable callback field appear to be
  routing authority.
- Send all callbacks to DE and special-case NL only during execution: leaves
  details and rejection inconsistent and does not generalize to later nodes.
- Disable NL proposals: avoids the bug by abandoning multi-node repair.

## Verification and rollout

Test the router with DE/NL and a third registered fixture node for all three
actions; missing/unknown host, malformed callback, wrong owner/chat, replay,
expired/stale run, and direct wrong-service invocation must not mutate or
leak details. Verify the true NL path rechecks NL health and dispatches only
the closed NL Host Agent operation after owner approval, while DE remains
unchanged. Run the Telegram architecture/contract gate and full server suite.
Update the Telegram menu contract, architecture guide, `AGENTS.md`, and the
rollout record; build/test the production image, preflight, Compose health,
and public smoke. Only then repeat the owner-approved controlled NL Xray
drill with a seven-minute conditional `systemctl start` watchdog. Keep the
Hysteria2 stack healthy; restore Xray manually on any failed/uncertain path.
