# VPN Supervisor: distributed diagnosis and safe autonomy foundation

**Date:** 2026-09-15  
**Status:** Approved by owner on 2026-09-15
**Scope of this milestone:** dependency model, deterministic classifier, Operations integration, tests, deployment, and production snapshot acceptance. No repair action or LLM invocation is enabled in this milestone.

## Goal

Build the first reliable layer of an autonomous, LLM-assisted VPN Supervisor.
The Supervisor is a central coordinator running with Jarvis on the current VPS.
It monitors the local VPN services and, later, VPN services on additional
reachable VPS nodes registered in the same private management network. Each
node has a narrow local agent that reports health and executes only declared
operations.

When a confirmed incident is detected, the central Supervisor calls the
configured LLM with a versioned system prompt, a VPN diagnostic guide, the
sanitized diagnosis and bounded incident history, and the closed playbook
catalog. The model proposes a playbook; deterministic policy validates the
proposal before any action. The model does not receive arbitrary logs, secrets,
or shell access.

The immediate milestone converts `vpn.health.snapshot` into a stable,
secret-free diagnosis and records it through the existing Operations incident
pipeline. It establishes the contract used by the later LLM and execution
stages, but does not invoke the model or repair anything yet.

The end state is autonomous recovery of VPN services on every reachable managed
node. The normal path invokes the LLM. If Jarvis Server or the model provider is
temporarily unavailable, a node may execute only a small explicitly approved
set of deterministic emergency playbooks. Autonomy is fail-closed: uncertainty,
an unverified result, or an unavailable rollback stops all further mutations
and notifies the owner when a notification channel is available.

Recovering a completely unreachable or powered-off VPS is not part of this
design. A future milestone may place a coordinator outside the monitored
failure domain and integrate a hosting-provider recovery API.

## Product guarantees

- A model never receives shell access and never writes a script at incident
  time. It may select only a versioned playbook and bounded parameters from a
  closed manifest.
- The central Supervisor attempts LLM-assisted planning for every confirmed
  repair-eligible incident. The local recovery layer can operate without Jarvis
  Server or an LLM only with a much smaller preapproved emergency catalog.
- Every managed VPS has a stable opaque node ID and declared capabilities. A
  diagnosis and action are always bound to exactly one node; results from one
  node can never authorize a mutation on another.
- A healthy VPN stack is never modified to repair the other stack.
- Mutations are serialized, idempotent, rate-limited, audited, verified by a
  post-check, and rolled back when the playbook has a proven rollback.
- An operation with an unknown outcome is reconciled under its original claim;
  it is never repeated with a new identifier.
- Client credentials are never rotated or revoked autonomously. If replacement
  is necessary, the owner receives a Telegram notification containing the
  device name, VPN profile, and reason. A bounded, expiring button confirms the
  exact rotation. Credentials, UUIDs, private keys, and connection URIs never
  enter the message, incident history, telemetry, or logs.
- Firewall, routing, port, and server-credential recovery may eventually restore
  an exact declared known-good state. The Supervisor may not invent a topology,
  flush a firewall, broaden ingress, or rotate client credentials.
- A global kill switch disables autonomous mutations without disabling health
  collection or owner notifications.

## Ownership and data flow

The central Supervisor belongs to the existing Operations control plane. It
owns node inventory, incident correlation, sanitized history, LLM planning,
policy evaluation, notifications, and durable action orchestration. The current
VPS uses the existing local Unix-socket Host Agent connection. Additional VPS
nodes must connect through a mutually authenticated private management channel;
no Host Agent control port may be exposed directly to the public internet.

The deterministic classifier belongs in the Host Agent Python package so every
node and the future local emergency controller can reuse it while the central
Supervisor is unavailable. It is a pure module: validated snapshot in,
immutable diagnosis out, with no I/O and no side effects.

`vpn.health.snapshot` continues to return the raw bounded fields and adds a
versioned `diagnosis` object produced from those exact fields. Jarvis Server
strictly validates both structures rather than trusting a passthrough object.
The Operations collector forwards the diagnosis through a small adapter into
the existing `IncidentEngine`; no parallel incident store or notifier is
created. Telegram `/vpn_health` renders the same validated diagnosis.

```text
per-node Host Agent probes
  -> strict snapshot + node identity binding
  -> pure deterministic classifier
  -> central Operations adapter
  -> existing IncidentEngine / OperationsRepository / IncidentNotifier
  -> LLM planner with system prompt + guide + closed catalog (later milestone)
  -> deterministic policy gate
  -> exact-node playbook execution and verification
```

The existing generic service collection remains responsible for inventory and
metrics. Once classified VPN observation is enabled, generic Xray/Hysteria
observations must not open competing incidents for the same symptoms.

## Dependency model

The classifier uses explicit causal edges, not a blanket priority list:

- Xray depends on its validated configuration, `xray.service`, and both managed
  TCP listeners on 443 and 8443. TCP 443 does not conflict with Hysteria2 UDP
  443.
- Hysteria2 depends on its validated configuration,
  `hysteria-server.service`, UDP 443 on the configured second public IPv4, and
  local Host Agent HTTP authentication backed by the root-only Hysteria state
  file.
- The Hysteria auth endpoint is a loopback dependency. Host outbound failure is
  not evidence that this endpoint caused an auth failure.
- Host DNS and outbound HTTPS are host capabilities and may be incidents in
  their own right. They become the primary cause of a VPN failure only when a
  measured failing VPN probe has that declared dependency. In the current
  snapshot, `protocolProbe=unknown` supplies no such evidence.
- `unknown` is not `healthy`, but uncertainty alone is not an outage.
- Host resource exhaustion is not classified until concrete bounded resource
  fields and thresholds are part of the snapshot. The classifier never infers
  it from the generic `host` field.

## Diagnosis contract

The contract is versioned and bounded:

```json
{
  "version": 1,
  "state": "incident",
  "primary": {
    "code": "HYSTERIA2_AUTH_ENDPOINT_FAILURE",
    "failureKind": "vpn.hysteria2.auth_endpoint_failure",
    "severity": "error",
    "scope": "hysteria2",
    "confidence": "high",
    "likelyCause": "host_agent_auth_dependency",
    "evidence": [
      { "path": "hysteria2.service", "status": "healthy" },
      { "path": "hysteria2.listener", "status": "healthy" },
      { "path": "hysteria2.authEndpoint", "status": "unavailable" }
    ],
    "safeNextChecks": ["host_agent_status", "hysteria_auth_endpoint_probe"]
  },
  "secondarySignals": [
    { "code": "HYSTERIA2_PROTOCOL_UNVERIFIED", "severity": "info" }
  ]
}
```

`state` is `healthy`, `uncertain`, or `incident`; `primary` is null unless the
state is `incident`. Evidence uses closed path and status enums rather than
free-form strings. It is assembled only from snapshot fields and is limited in
length. `likelyCause`, `safeNextChecks`, and secondary signal codes are also
closed enums. This makes secret leakage structurally impossible rather than
dependent on redaction.

The public diagnosis code is uppercase for stable display and automation. The
lowercase `failureKind` satisfies the existing PostgreSQL incident constraint
and is the durable deduplication key.

## Initial taxonomy and causal ordering

The first stable primary codes are:

- `VPN_SNAPSHOT_INVALID`
- `HOST_UNAVAILABLE`
- `HOST_DNS_FAILURE`
- `HOST_OUTBOUND_FAILURE`
- `XRAY_CONFIG_FAILURE`
- `XRAY_SERVICE_FAILURE`
- `XRAY_LISTENER_FAILURE`
- `HYSTERIA2_CONFIG_FAILURE`
- `HYSTERIA2_SERVICE_FAILURE`
- `HYSTERIA2_LISTENER_FAILURE`
- `HYSTERIA2_AUTH_ENDPOINT_FAILURE`
- `HYSTERIA2_AUTH_CREDENTIAL_FAILURE`
- `VPN_MULTI_STACK_FAILURE`
- `UNKNOWN_VPN_FAILURE`

Protocol uncertainty is represented only by the secondary signals
`XRAY_PROTOCOL_UNVERIFIED` and `HYSTERIA2_PROTOCOL_UNVERIFIED`. These signals do
not open incidents by themselves and never have critical severity.

Rules select one primary cause. Explicit upstream evidence wins: an invalid
configuration can explain a stopped service; a stopped service can explain a
missing listener; a failed Hysteria auth dependency can explain rejected new
sessions while the Hysteria process remains healthy. Multi-stack failure is
used only when both stacks have actual local failures and no more specific
shared cause is proven. An unrelated DNS or outbound failure may coexist as a
secondary fact; it does not automatically replace the VPN diagnosis.

Malformed or missing required fields produce `VPN_SNAPSHOT_INVALID`, low
confidence, no repair eligibility, and only safe diagnostic checks. The
classifier never treats missing data as healthy.

Severity is based on impact, not merely probe state:

- `info`: unverified optional capability such as the current protocol probes;
- `warning`: degraded or incomplete evidence without a proven outage;
- `error`: one VPN stack or a required dependency has a proven failure;
- `critical`: both stacks or the host have a proven service-impacting failure.

Confidence is `low`, `medium`, or `high` and is derived from the number and
causal agreement of independent facts. It is never raised by narrative text.

## Existing IncidentEngine integration

`IncidentEngine.observe(service)` remains backward compatible. A focused
classified-observation entry point or adapter supplies the classifier's
`failureKind`, severity, bounded summary, and safe technical detail without
allowing the engine to overwrite severity from generic service state.

The adapter also owns incident-family reconciliation. When a VPN diagnosis
changes, the previous open diagnosis for the same affected scope is resolved
before or atomically with opening the replacement. A healthy diagnosis resolves
open classified VPN incidents. This avoids leaving stale competing primary
incidents, which the current `observe()` method cannot do by itself when the
failure kind changes.

This milestone reuses `ops_incidents`. The bounded diagnosis can be serialized
into the existing `technical_detail` field; no new database or secret-bearing
history is introduced. A later migration may add structured metadata only if a
real query or UI requirement justifies it.

To avoid alert flapping, repair eligibility and notifications are not driven by
one ambiguous sample. Ordinary failures require repeated consistent
observations using the existing incident debounce behavior. A definitive
systemd `failed` state may still open immediately, but this milestone performs
no repair.

## Future autonomous execution contract

The following stages are deliberately not implemented now, but the classifier
contract must support them without redesign:

1. Add a node registry and per-node health scheduling to Operations. Begin with
   the current local VPS, then add reachable remote nodes through a private,
   mutually authenticated channel.
2. Add read-only diagnostic actions and a closed repair-policy evaluator.
3. Add versioned playbooks with exact preconditions, action parameters,
   post-conditions, timeout, rollback, affected-node and affected-stack
   declarations.
4. Add the central LLM planner in advisory/dry-run mode. Its versioned system
   prompt and guide explain the supported VPN topologies and diagnosis rules.
   The model sees only the sanitized diagnosis, bounded incident history, node
   capabilities, and playbook catalog, and returns a schema-checked proposal.
5. Add a separate local safety controller that imports the classifier and can
   use only the emergency playbook subset when Jarvis Server or the LLM is
   unavailable. It acquires a per-node recovery lease, enforces cooldown and
   attempt budgets, and records durable claims.
6. Enable autonomous LLM-selected execution only after replay evaluation
   against incident fixtures and deliberate fault injection. Deterministic
   policy remains the final authority.

If a post-check fails, the controller performs only the declared rollback. If
rollback cannot be proven, the operation result is unknown, or the remaining
healthy stack would be endangered, the controller stops and notifies the owner.
It does not cascade into another guessed action.

## Verification

The Host Agent classifier receives table-driven tests covering, at minimum:

- all healthy;
- every individual host, network, Xray, Hysteria2, and auth failure;
- config failure combined with service/listener failure;
- one-stack and two-stack failures;
- network failure alongside unrelated VPN symptoms;
- protocol probes unknown without a primary incident;
- malformed, missing, extra, and unsupported status values;
- deterministic output independent of object key order;
- bounded evidence containing only allowlisted paths and statuses;
- absence of credentials, UUIDs, keys, URIs, paths, and arbitrary probe text.

Server tests cover strict response validation, IncidentEngine adaptation,
debounce and replacement resolution, notification deduplication, `/vpn_health`
rendering, and coexistence with generic service collection. The full Host Agent
and server regression suites follow focused tests.

Deployment uses the existing unified Host Agent deployment flow and normal
server preflight/Compose/smoke process. Production acceptance captures a live
secret-free snapshot, checks its deterministic diagnosis, confirms persistence
through the existing incident path where safely exercisable, and verifies that
no repair operation was invoked. No production fault is injected merely to
demonstrate classification.

## Out of scope for this milestone

- LLM calls or prompts;
- automatic restart or repair;
- remote VPS enrollment or public Host Agent listeners;
- recovery of a powered-off or wholly unreachable VPS;
- firewall, DNS, routing, port, or credential mutation;
- temporary probe clients;
- arbitrary shell or runtime-generated scripts;
- enabling backup scheduling;
- claiming a protocol healthy before a real end-to-end probe exists.
