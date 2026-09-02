# Action Orchestrator Platform Foundation Design

Status: approved design as of 2026-09-02.

## Goal

Prepare Jarvis for future server parsers, monitoring, VPN operations, and
owner-authorized account integrations without prematurely implementing those
products or turning the Desktop command path into a monolith.

The platform model is one cloud orchestrator with replaceable execution
targets. Windows Desktop is the first target. Server workers and account
connectors can be added later through the same validation, workflow,
confirmation, result, and audit contracts.

## Decisions

- Build generic extension boundaries now; implement concrete VPNs, parsers,
  social networks, and account adapters later.
- Rename the conceptual `DesktopTaskOrchestrator` boundary to
  `ActionOrchestrator`. Desktop remains its first production executor.
- Every action is declared through a versioned manifest and strict argument and
  result schemas.
- Execution targets are `device`, `server`, or `connector`.
- Account connections may remain local, use an official API, or transfer an
  owner-approved browser session to an isolated VPS worker.
- A browser-session transfer requires one strong confirmation in the channel
  that requested the transfer: Telegram confirms in that Telegram chat;
  Desktop confirms on that Desktop. It does not require both confirmations.
- A transferred session remains until explicit owner deletion. There is no
  automatic retention expiry, but health and revocation state are monitored.
- Permission to store an account session is separate from permission to
  perform actions through that account.

## Scope Decomposition

This design defines a shared foundation and three independently deliverable
families. Each concrete family receives its own later specification and rollout.

### Foundation now

- generic workflow and action-run records;
- action manifest registry;
- executor routing and capability discovery;
- origin-bound confirmation contracts;
- scheduling, monitoring, result delivery, idempotency, and audit interfaces;
- account-connection metadata and secret-reference interfaces;
- isolated worker protocol and health model;
- test harnesses for new manifests and executors.

### Desktop first

The natural-language Desktop tool workflow described in
`2026-09-02-desktop-natural-tool-orchestrator-design.md` implements the first
production executor and proves multi-step planning, candidate freezing,
confirmation, WSS delivery, and verified results.

### Later independent projects

- concrete document/web/data parsers;
- VPN health monitoring and bounded VPN administration;
- individual OAuth/API account connectors;
- individual browser-session connectors;
- dashboards and user-facing account management;
- browser automation recipes for specific supported services.

## Core Architecture

### Action orchestrator

`ActionOrchestrator` owns user intent, bounded planning, workflow state, target
selection, confirmation, and result continuation. It never contains
service-specific implementation code and never executes tools directly.

Every step resolves an action manifest, verifies owner and target scope, checks
policy, creates an action run, and routes it to one executor. Verified results
return through the same normalized envelope regardless of executor type.

### Action manifest registry

Each tool registers a versioned manifest containing at least:

- stable namespaced action name, for example `files.search`,
  `vpn.peer.status`, or `social.example.publish`;
- human-readable title and confirmation summary template;
- executor type and minimum executor protocol version;
- strict input and output schemas;
- capability and account scopes;
- policy: observe, low risk, confirmation, or strong confirmation;
- idempotency behavior and whether automatic retry is allowed;
- timeout and maximum result size;
- data classification and fields that must be redacted before model use;
- availability mode: cloud, online device, unlocked device, or interactive
  user presence.

The model receives only currently available manifests. It cannot invent a
manifest, change its policy, select an undeclared executor, or supply arbitrary
shell text.

### Executor adapters

Executors implement one small contract: advertise capabilities, accept a
validated action run, report progress, return a schema-valid result, cancel
when supported, and expose health.

`device` executors run on paired Windows clients over outbound authenticated
WSS. They own local apps, files, windows, and local browser sessions.

`server` executors run as isolated workers behind a bounded job protocol. They
own parsers, scheduled checks, and narrowly declared infrastructure operations.
The main Fastify server does not receive Docker control access or arbitrary
host-shell authority.

`connector` executors operate owner-linked external accounts. They may use an
official API or an isolated browser worker. Connector content is untrusted data
and never becomes system instruction.

## Workflow and Action Data

Generic workflows replace assumptions that every target is a Desktop device.
A workflow stores owner, conversation, origin channel, optional origin device,
status, selected resources, current step, revision, and timestamps.

Each action run stores:

- workflow and step identity;
- owner and target identity;
- action manifest name and version;
- validated arguments or opaque references;
- policy and frozen confirmation summary;
- idempotency key;
- status, attempt count, timeout, normalized result, and failure code;
- audit timestamps.

Targets use typed references such as `device:<id>`, `worker:<id>`, and
`account:<id>`. Repositories always scope lookups by owner before target ID.

The existing command records remain compatible with the first Desktop slice.
An adapter maps generic action runs to the current confirmed device-command
state machine until a later migration deliberately unifies storage.

## Account Connection Modes

Every owner-linked account chooses one mode independently.

### Local session

Jarvis uses an existing browser or application session on a paired PC. Cookies,
passwords, and local storage remain on that device. The connection is available
only while the required device and session are available.

### Official API

Jarvis uses OAuth or another supported provider API. Provider tokens are stored
through the secret-reference interface, never in prompts, chat history, logs,
or ordinary account metadata.

### Transferred browser session

Jarvis transfers a selected authenticated browser session to an isolated
browser worker on the VPS. This supports services without a suitable API while
making the security and operational limitations explicit.

The transfer lifecycle is:

1. The owner requests connection from Desktop or Telegram and selects the
   account and source device.
2. Jarvis shows the service, account label, source device, destination,
   requested capabilities, persistence behavior, and security warning.
3. A single strong confirmation must arrive from that same request channel and
   conversation. A confirmation from another channel, chat, device identity,
   or user is invalid.
4. The paired Desktop exports only the selected account's required browser
   session material through a bounded local connector.
5. The encrypted capsule is uploaded directly to the account-session service.
   It is never included in model context or returned through chat APIs.
6. An isolated account browser imports the capsule and performs a read-only
   health check. Only after that check does the connection become `active`.
7. The encrypted session remains active until the owner explicitly deletes it,
   the provider invalidates it, or Jarvis detects that reauthentication is
   required.

The transfer grant authorizes storage and use through declared connector
actions. It is not blanket permission to publish, message, purchase, change
settings, or export private data.

## Session Capsule Security

Each account receives an independent random data-encryption key. Envelope
encryption protects session material at rest; the wrapping key resides outside
PostgreSQL in a restricted VPS secret source. Database records contain only
encrypted blobs or opaque storage references, key version, account metadata,
health state, and audit timestamps.

Plain session material exists only in the source Desktop connector during
export and in the assigned isolated browser worker while in use. It is never
logged, cached in model prompts, placed in backups without encryption, or
shared between account containers.

Each browser-session account runs in an isolated profile and worker boundary.
It has no access to PostgreSQL, Docker control, host files, other profiles, or
internal worker endpoints. Network egress is restricted to the connector's
declared service domains where practical. Downloads, uploads, clipboard access,
and local filesystem mounts are disabled unless a later connector explicitly
declares and validates them.

Jarvis does not transfer stored passwords, authenticator seeds, backup codes,
hardware-key credentials, or password-manager vault data. CAPTCHA, 2FA,
provider risk checks, and forced re-login pause the workflow for explicit user
interaction. The assistant cannot solve or bypass them.

## Confirmation Semantics

Confirmation is origin-bound across all executor types:

- Telegram request: confirmation is valid only in the same Telegram chat;
- Desktop request: confirmation is valid only from that authenticated Desktop;
- future clients follow the same origin-client rule;
- target executor and confirmation client may differ;
- the confirmed payload freezes action, target, account, requested scopes, and
  relevant opaque candidates;
- confirmation expires if not used promptly, even though an active transferred
  account session itself has no retention expiry.

Account transfer uses strong confirmation. Explicit deletion of a transferred
session also uses strong origin-bound confirmation and removes the encrypted
capsule, isolated browser profile, active leases, and queued connector actions.
Minimal non-secret audit records remain.

Individual account actions use their own manifest policy. Reading account
status may be observe or low risk. Sending messages, publishing, purchasing,
changing privacy/security settings, deleting content, and granting new scopes
require confirmation or strong confirmation according to the connector
manifest. Prior session transfer never satisfies a later action confirmation.

## Scheduling and Monitoring

The platform adds generic schedules and monitors rather than service-specific
cron code. A schedule references an owner-scoped workflow template and declares
frequency, executor availability requirements, concurrency policy, and failure
notification policy.

Monitors record bounded health states such as `healthy`, `degraded`, `offline`,
`reauth_required`, and `permission_changed`. They may trigger notifications or
new observe workflows but cannot trigger changing actions without the required
policy and confirmation.

Examples of future use include parser freshness, account-session health, VPN
peer reachability, backup status, and external-account synchronization. Heavy
workers have explicit resource limits so VPN and assistant traffic cannot be
starved by parser or browser workloads.

## VPN Boundary

VPN monitoring and administration are separate actions. Read-only peer status
can run in a restricted server worker. Adding, revoking, or rotating a peer is
a strong-confirmation action implemented through fixed templates and validated
identifiers, never arbitrary shell generated by a model.

The VPN worker cannot reach PostgreSQL, model-provider secrets, document
storage, or Docker control. Network and capacity acceptance tests are required
before enabling it on the production VPS.

## Failure and Recovery

All executors normalize offline, timeout, invalid capability, authentication
expired, permission denied, policy rejected, rate limited, result invalid, and
execution unknown states. Unknown execution outcomes are not automatically
retried.

Account-session failures never expose cookies or provider response bodies in
chat. A revoked or invalid session becomes `reauth_required`; Jarvis asks the
owner to reconnect rather than silently exporting another local session.

Deleting a transferred session is idempotent. Partial cleanup remains in a
`deleting` state and is retried by a bounded cleanup worker until the encrypted
capsule and isolated profile are gone. New account actions are denied during
deletion.

## Testing Strategy

### Platform contracts

- property tests generate manifests, capabilities, target types, policies, and
  malformed arguments with reproducible seeds;
- no generated planner output can select an undeclared executor or weaken a
  manifest policy;
- owner and target IDs are always scoped together;
- duplicate events and retries cannot execute an action run twice;
- no success answer exists without a schema-valid verified result;
- executor outages and server restarts preserve terminal command state.

### Origin-bound confirmation

- Telegram confirmations fail from another chat, user, or channel;
- Desktop confirmations fail from another device;
- account transfer needs exactly one valid confirmation from its request
  origin, not simultaneous Telegram and Desktop approval;
- a valid transfer confirmation cannot approve a later publish or delete;
- confirmation expiry does not delete an already active account session.

### Session capsules

- encrypted data cannot be read with another account's key or metadata;
- plaintext session material never reaches logs, prompts, normal API responses,
  database metadata columns, or unencrypted backup fixtures;
- interrupted upload never creates an active connection;
- failed import destroys temporary plaintext and marks the connection failed;
- explicit deletion removes encrypted storage and isolated profile state while
  retaining only bounded audit metadata;
- account and worker isolation is tested across multiple owners and services;
- seeded scenarios rotate account order, failure points, reconnects, and
  duplicate confirmation delivery.

### Future executor conformance

Every new device, server worker, or connector must pass a shared conformance
suite for manifests, schema validation, idempotency, cancellation, timeout,
health, redaction, and audit behavior before its capability is advertised to
the planner.

## Delivery Sequence

The current implementation plan should build only the reusable minimum needed
by the Desktop natural-tool workflow:

1. generic action manifest interfaces and registry;
2. generic workflow/action-run model with a Desktop command adapter;
3. executor routing, verified results, origin confirmation, and asynchronous
   client updates;
4. seeded platform conformance tests;
5. stable interface contracts for server workers, schedules, monitors, account
   connections, and secret references, without production account-session or
   VPN execution.

Concrete account-session transfer, isolated browser infrastructure, VPN
workers, and provider-specific connectors are later projects with separate
threat models, capacity tests, and deployment approval.
