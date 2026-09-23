# VPN Supervisor: guide and execution rules

Status: the owner-approved real restart path is deployed as of 2026-09-23
after a brief rollback and verified redeployment. Migration 026 is applied.
No real repair has yet executed on a live incident.

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
2026-09-16. Local fault simulations and deployment health checks have passed,
but a real owner-confirmed repair has not yet executed. Its first eligible
incident remains the live acceptance check for this workflow.
