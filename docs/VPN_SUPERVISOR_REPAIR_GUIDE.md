# VPN Supervisor: guide and execution rules

Status (2026-09-24): the limited owner-approved real-restart path is deployed;
migration 026 is applied. A genuine NL Xray service-failure drill passed with
`POSTCHECK_PASSED` after a host-bound callback routing fix. This validates that
case only: DE Xray, DE Hysteria2, and NL Hysteria2 have not each been exercised
by a live service outage. No autonomous restart, broad repair, or 99.9%
availability guarantee is claimed.

## What the Supervisor is

The Supervisor combines deterministic Host Agent health classification with an
isolated LLM planner. It is not a general-purpose shell agent. The model sees a
closed incident, bounded facts, and sanitized recent service logs; it may return
only a schema-validated decision and a playbook ID from the declared catalog.
Logs are untrusted evidence, not instructions. The model cannot write commands,
arguments, scripts, configuration, firewall rules, routing, credentials, or
new playbooks.

The deterministic classifier remains authoritative. It selects one primary
cause, binds it to a diagnosis revision, and requires repeated observations
before creating an incident. The model may request one bounded read-only
observation round. A second request, invalid snapshot, or changed diagnosis
stops planning.

## Monitoring and Telegram alerts

Operations polls each node's local health snapshot at the configured interval
(30 seconds by default). The VPN incident adapter requires three consecutive
observations of the same primary diagnosis before opening an incident; the
owner receives a Telegram incident alert when it opens. Supervisor analysis
then may produce a separate repair proposal, but does not itself change VPN
state.

This alert path is distinct from the two cross-node systemd external-probe
timers, which run approximately every 15 minutes. They cover NL→DE and DE→NL
for both VLESS and Hysteria2; each snapshot has VLESS TCP 443/8443 and
Hysteria2 UDP fixed-443/hopping statuses. A failed scheduled external probe
does not currently enter the Operations incident notifier, so it does not
promise a proactive Telegram alert for that route. The result is visible in
`/vpn_health`; profile generation may demote a node on failed VLESS 8443 or
Hysteria2 hopping checks. Unknown or stale external data is not proof of a
healthy route.

## Current decision tree

1. If the incident is absent, uncertain, invalid, or outside a declared stack
   service failure, stop or request the one permitted read-only observation.
   Do not restart to fix a config, listener, DNS, outbound, host, auth, or
   multi-stack failure.
2. To consider Xray, require `XRAY_SERVICE_FAILURE`, high model confidence,
   zero remaining checks, healthy host/DNS/outbound, degraded or unavailable
   Xray service, healthy Xray config, and healthy Hysteria2 service/config/
   listener/auth/auth endpoint. Neither protocol probe may be failed.
   Hysteria2's auth credential probe may be healthy or
   unknown, but never failed.
3. To consider Hysteria2, require `HYSTERIA2_SERVICE_FAILURE` with the same
   host/network and confidence requirements, degraded or unavailable Hysteria2
   service, healthy Hysteria2 config/auth/auth endpoint, healthy Xray service/config/
   listener, neither failed protocol probe, and Hysteria2 credential probe healthy or unknown.
4. A deterministic policy check repeats these conditions. If it rejects the
   proposal, no action button is sent. Restore-known-good playbooks remain
   disabled.
5. A valid proposal is only a request for owner approval. It is not an action.

The enabled playbooks are intentionally limited to the two service failures
above. `XRAY_CONFIG_FAILURE`, `XRAY_LISTENER_FAILURE`, all Hysteria2 config,
listener, auth endpoint and credential failures, DNS/outbound/host failures,
multi-stack incidents, invalid/unknown health, and external route-probe
failures do not authorize a restart. They remain incidents for diagnosis. The
known-good restore playbooks are disabled.

## Confirmation and fixed operations

The owner has ten minutes to approve from the owner's private Telegram chat.
The handler rechecks the user's identity, chat, prompt/catalog versions,
playbook, expiry, and incident revision. It takes a fresh validated health
snapshot and reruns the deterministic preconditions before dispatch.

The only real operations are the existing no-argument Host Agent actions:

- `restart_xray` → `vpn.restart`
- `restart_hysteria2` → `vpn.hysteria2.restart`

No other action, shell command, or model-supplied argument is possible through
this path. Restarting the selected stack can briefly disconnect its clients;
the opposite stack and credentials are not modified.

The run UUID is also the action request ID. A database claim, one repair attempt
per incident revision, and a per-host cooldown prevent concurrent/repeated
dispatch. If the response is uncertain, the Supervisor checks `operation.status`
using the same request ID. It never retries the restart under a new ID.

## Verification and failure behavior

After success, a new validated health snapshot must show the target and opposite
stacks healthy. A failed check records a closed result code; no automatic
rollback or second restart occurs. If status or health is still unknown, the run
remains recoverable and the background recovery worker continues read-only
reconciliation without replaying the action.

If the diagnosis changed, the request expired, policy checks fail, approval
comes from the wrong identity/chat, or Host Agent is unavailable, the action is
cancelled or left explicitly uncertain. Do not interpret a timeout as permission
to retry.

## Persisted evidence and rollout

Run records contain status, closed codes, bounded safe metadata, and opaque
evidence references only. Raw logs, credentials, arbitrary model text, and
configuration contents must not be persisted or sent in Telegram diagnostics.

Migration 026 is applied in production. The running server catalog enables
only the matching Xray and Hysteria2 restarts and the synthetic no-op; restore
playbooks remain disabled. The owner accepted the synthetic no-op on
2026-09-16. The first NL live drill safely dispatched no restart because the
callback was routed to DE; the host-bound routing correction was then deployed.
The repeated owner-approved NL Xray drill restarted only NL Xray and passed the
target/opposite-stack postchecks. DE Xray, DE Hysteria2, and NL Hysteria2 live
failure drills remain unaccepted; local fault simulations are not substitutes.
