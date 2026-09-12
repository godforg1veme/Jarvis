# Jarvis-managed Happ VPN design

Date: 2026-09-12
Status: approved for implementation

## Context

The production VPS already exposes Xray on TCP 443 through x-ui. Inspection on
2026-09-12 found Xray 26.6.22 and x-ui 3.4.1. The only VLESS inbound uses REALITY
and XTLS Vision, but its generated runtime configuration has no REALITY
`target`/`dest` and contains the malformed server name `ya.ru:`. The current
configuration is therefore not a valid basis for a Happ client. The x-ui panel
also listens on all interfaces and its port is allowed by UFW.

Happ officially supports VLESS, REALITY, XTLS Vision, standard subscription
URLs, QR/deep-link import, and subscription-provided metadata. The implementation
will use those public contracts and a current Xray configuration validated by
the installed Xray binary before activation.

## Goals

1. Provide a reliable personal VLESS + REALITY + XTLS Vision connection that
   imports cleanly into Happ.
2. Give every device an independent credential that can be issued, inspected,
   rotated, or revoked without changing unrelated clients.
3. Make VPN health and bounded traffic/connection telemetry visible in the
   existing Operations panel and incident pipeline.
4. Let the owner inspect and administer VPN access from both Telegram and the
   Desktop cloud conversation.
5. Keep private keys, client UUIDs, subscription tokens, and complete share
   links out of Git, application logs, model prompts, monitoring events, and
   conversation history.
6. Preserve a tested rollback path throughout the production migration.

## Non-goals

- Selling VPN access or implementing billing.
- Public self-registration or family-wide access by default.
- Allowing the model to execute arbitrary shell commands or edit arbitrary
  Xray JSON.
- Exposing an administration panel, Xray API, Host Agent socket, PostgreSQL, or
  subscription store to the public internet.
- Enabling the deferred backup timer.
- Automatically installing or replacing the Desktop EXE without owner approval.

## Chosen architecture

### Xray runtime

x-ui will be removed from the active execution path. A dedicated `xray.service`
will run the existing/current Xray binary under systemd with a root-owned
configuration and state directory. Only the VLESS listener on TCP 443 is public.
The local Xray statistics API, if retained, binds to loopback and is reachable
only by the Host Agent.

The initial inbound uses:

- VLESS with `decryption: none`;
- RAW/TCP transport;
- REALITY with a tested TLS 1.3 target and matching SNI;
- `xtls-rprx-vision` flow;
- one generated X25519 server key pair;
- a distinct UUID and short ID for each client;
- blocking of private destination ranges and BitTorrent traffic;
- warning-level logs with no access log containing destination history.

The selected REALITY target must be reachable from the VPS, present a valid
certificate for the configured SNI, and support the handshake expected by the
current Xray release. It is selected by a deployment-time probe rather than
copied blindly from an example.

### Root-owned VPN state

Canonical VPN state lives outside the repository in a root-owned directory on
the VPS. It contains the REALITY server private key and a bounded client registry.
The registry stores stable opaque client IDs, labels, status, creation time, and
the minimum data needed to regenerate the Xray configuration. Labels are
validated and length-bounded. Deleted credentials are not retained in active
state.

All writes use a temporary file, permission verification, Xray's configuration
test, atomic replacement, and a systemd reload/restart. Before every changing
operation, the helper creates a bounded rollback snapshot. If validation,
restart, or the post-start health probe fails, it restores the previous files
and service state.

### Host Agent boundary

The existing root-owned Host Agent remains the only execution boundary for
Jarvis. Its versioned protocol gains explicit VPN operations; it never accepts
a command line, executable path, config fragment, raw UUID, key, or arbitrary
JSON from the model.

Read operations:

- `vpn.status`: service state, configuration validity, listener status, active
  client count, aggregate traffic counters, and last successful probe time;
- `vpn.clients.list`: bounded metadata only, without credentials.

Changing operations:

- `vpn.client.issue` with a validated display label;
- `vpn.client.revoke` with an opaque client ID;
- `vpn.client.rotate` with an opaque client ID;
- `vpn.client.export` with an opaque client ID, producing an owner-authorized
  one-time export handle rather than returning a credential in protocol logs;
- `vpn.restart`.

Issue, revoke, rotate, export, and restart are durable, idempotency-keyed
operations.
An interrupted changing request has an unknown outcome and is reconciled using
the original request identifier; it is never blindly replayed with a new ID.

### Control-plane service

A server-side VPN service validates owner scope, records non-secret audit
metadata, invokes the Host Agent, and converts raw results into bounded public
results. VPN actions join the orchestrator action manifest through a dedicated
server/host executor rather than pretending to be Desktop device actions.

Policy mapping:

- status and client listing are `safe`;
- issuing, revoking, rotating, restarting, and exporting credentials are
  `changing` and require confirmation in the client where the request began;
- no VPN action is available to non-owner users;
- planner output cannot weaken the trusted policy.

Telegram and Desktop cloud chat use the same service and policy. Deterministic
slash commands may supplement natural-language planning, but they must call the
same validated service. Expected intents include checking VPN status, listing
clients, issuing a client, revoking or rotating a named client after selection,
and restarting Xray.

### Credential delivery

The complete Happ share URI and QR code are secrets. They are not returned in a
normal assistant message and are not stored in conversation content. An issue,
rotation, or explicit export creates a short-lived, single-use download artifact
scoped to the owner and protected by an opaque high-entropy token. The public
response contains only an expiry and a download/open action. The artifact is
deleted after successful retrieval or expiry.

For the initial production acceptance, a copy is also written on the operator's
local workstation to an ignored, permission-restricted directory. The final
handoff points to the file without printing its contents. The bundle contains a
Happ-compatible VLESS URI, a QR image, a short import guide, and non-secret
connection metadata.

### Monitoring and incidents

`xray` becomes a first-class entry in the Operations service catalog. The
collector records:

- systemd source and health state;
- whether the expected TCP listener exists;
- whether Xray accepts the generated configuration;
- aggregate upload/download counters when available;
- active connection count without peer IPs or destinations;
- probe latency and last successful probe time.

The Operations UI shows current state, recent bounded metrics, sanitized logs,
and restart capability. Consecutive service, listener, configuration, or probe
failures open an incident and notify the owner through the existing Telegram
incident notifier. Recovery resolves the incident. Monitoring never records
UUIDs, keys, share links, subscription tokens, peer IP addresses, SNI history,
or visited destinations.

## Migration and firewall

The production migration is performed in this order:

1. Capture a root-only backup of the current x-ui database, unit, binary
   metadata, and Xray configuration without copying secrets into Git or chat.
2. Generate and validate the new configuration while x-ui still serves TCP 443.
3. Install `xray.service` and the root-owned state/helper files without starting
   the new listener.
4. Stop and disable x-ui, start Xray, and run immediate local and external
   health probes.
5. Roll back automatically if validation or health fails.
6. After successful verification, remove public UFW allowances for the x-ui
   panel and unused proxy/listener ports. SSH and TCP 443 remain allowed.
7. Keep the disabled x-ui installation and rollback archive until Happ and
   Jarvis acceptance are complete; removal is a later explicit cleanup.

Closing firewall rules must be based on exact numbered/rule identity checks at
execution time. The process must not assume that historical UFW rule numbers
are stable.

## Error handling

- Invalid labels, client IDs, protocol envelopes, and extra fields fail before
  any filesystem or service mutation.
- A failed Xray config test leaves the active configuration untouched.
- Restart timeout or ambiguous Host Agent transport produces `unknown`, followed
  by reconciliation of the same operation.
- Credential delivery failure does not create a second client automatically;
  the existing issued client can be exported through a new one-time artifact.
- Missing telemetry degrades monitoring but does not restart a healthy tunnel.
- Incident and audit summaries contain only fixed error codes and bounded
  operator-safe text.

## Verification

### Local automated checks

- Host Agent protocol validation and action tests, including unknown fields,
  unsafe labels, nonexistent clients, idempotent replay, ambiguous results,
  rollback, and secret redaction.
- Server tests for owner scoping, confirmation policy, Telegram/Desktop routing,
  audit metadata, one-time export expiry, and unavailable Host Agent behavior.
- Operations collector, service catalog, metrics, incident, log-redaction, and
  responsive UI tests.
- Existing Host Agent, server, Operations UI, remote protocol, and policy suites.

### Production checks

- Xray configuration test passes on the VPS.
- `xray.service` is enabled and healthy; x-ui is disabled.
- Only intended public ports remain allowed and TCP 443 is owned by Xray.
- A synthetic client from outside the VPS completes a REALITY handshake and
  reaches a known HTTPS endpoint through the tunnel.
- The Operations panel reports Xray healthy and displays bounded metrics.
- Telegram and Desktop can query status and can drive a confirmed reversible
  restart.
- Issue and revoke are verified with a disposable client.
- The final owner client imports into Happ and is manually tested over both
  mobile data and Wi-Fi.

## Acceptance criteria

Implementation is complete only when the server-side and client-side automated
tests pass, the deployed Xray and Jarvis monitoring/control paths are verified,
the protected Happ bundle exists, and the only remaining checks are the owner's
real-device Happ tests. No claim of successful tunnelling is made solely from a
running systemd unit.
