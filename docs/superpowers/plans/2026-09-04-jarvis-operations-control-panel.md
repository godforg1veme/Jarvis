# Jarvis Operations Control Panel Implementation Plan

2026-09-06 status correction: the original rollout below overstated acceptance.
See `docs/updates/2026-09-06-operations-verification.md`. Subsequent work fixes
mutation claims and timeout recovery, live device refresh and connection
revocation, stale/error display, archive privacy/quotas, backup races, and
notification retries; adds provider/polling/queue/migration checks, CPU/swap/
network metrics, and read-only component discovery. Migrations now include
010 and 011. The owner explicitly deferred all actual backup/restore work;
the backup timer remains disabled. Historical milestones below are preserved
as decision history rather than silently rewritten.

Status: advanced implementation in progress as of 2026-09-04; production is
healthy, but final root-owned activation and restore acceptance remain open.

Implemented and verified live: migrations 007-009, authenticated Unix-socket
Host Agent, four-service inventory, Telegram browser approval, persistent
sessions and immediate SSE revocation, exact operations-host enforcement,
host metrics, five-minute rollups, bounded age retention, read APIs, live SSE,
parser state history, deterministic incidents, safe Telegram error delivery,
metadata-only family device mapping, reassignment workflows, and the complete
read UI for Overview, Infrastructure, Services/logs, Devices, Parser,
Incidents, Events, Backups, and Sessions. Fixed service-operation code and UI
are deployed. Restart capabilities for Jarvis Server and Cloudflare Tunnel are
enabled and verified live, including Host Agent journal reconciliation after
Jarvis restarts itself. PostgreSQL and Telegram Parser remain read-only. The
non-stopping knowledge maintenance gate and backup script are deployed and
locally verified.

Still required for final acceptance: provision an external restic repository
and its root-only credentials, install/enable the daily backup timer, run a
real encrypted backup and isolated restore drill, verify a safely simulated
incident notification, and complete phone/desktop visual acceptance. The
updated Host Agent, disk/inode collection, sudo boundary, and selected action
allowlists are verified live. The already running Telegram parser remains
unmodified.

Design:
`docs/superpowers/specs/2026-09-04-jarvis-operations-control-panel-design.md`

## Outcome

Deliver one owner-only web panel that observes the whole current VPS, shows
Jarvis and the already deployed Telegram parser in one operational model,
reports failures through the main Jarvis bot, and performs a small fixed set of
manual actions from an approved browser session.

The first production rollout starts read-only. Control is enabled only after
the panel's readings have been compared with the VPS. The implementation does
not reinstall the parser, add automatic recovery, add arbitrary shell access,
or begin VPN, proxy, and automatic deployment work.

## Implementation Constraints

- Keep the existing Fastify server on CommonJS and PostgreSQL as the source of
  truth.
- Keep panel modules focused; do not grow `server/src/runtime.js` or
  `server/src/app.js` into operations monoliths.
- The Fastify container must not receive the Docker socket, systemd authority,
  unrestricted sudo, or arbitrary host commands.
- The Host Agent accepts only versioned structured requests and uses
  `subprocess` argument arrays without a shell.
- Browser approval happens once through the main Telegram bot. An active panel
  session is sufficient for later panel commands; no per-command Telegram
  confirmation is added.
- Panel sessions do not expire automatically. Forgetting a session is the only
  normal invalidation path.
- Do not expose family conversation, memory, document, message, or request
  content through operations repositories or routes.
- Preserve old ownership when Telegram identities or devices are reassigned.
- Treat the already deployed production parser as an external, read-only
  integration: do not move, copy, reinstall, modify its source, alter its
  systemd unit, or add parser control/source/discovery actions in this plan.
- Preserve unrelated dirty-worktree changes and generated/local state listed
  in `AGENTS.md`.

## Approved Dependency Checkpoint

The user approved adding dependencies for the panel during design. Keep them
isolated as follows:

Server production dependency:

- `@fastify/static` to serve the built panel assets.

New `ops-ui/package.json` production dependencies:

- `react`;
- `react-dom`.

New `ops-ui/package.json` development dependencies:

- `vite`;
- `typescript`;
- `@vitejs/plugin-react`;
- `vitest`;
- `jsdom`;
- `@testing-library/react` and `@testing-library/user-event`.

The Host Agent uses the Ubuntu Python 3 standard library and adds no pip
runtime dependency. Cookie generation, hashing, validation, and serialization
use Node built-ins and a small local module rather than adding a general
authentication framework.

If implementation requires a dependency outside this list, stop at that point
and request a separate approval.

## Target Layout

Add or extend these areas:

```text
ops-ui/
  package.json
  vite.config.ts
  tsconfig.json
  src/
    api/
    components/
    features/
    pages/
    styles/
    test/

server/src/operations/
  auth/
  collectors/
  connections/
  incidents/
  actions/
  repositories/
  routes/
  sessions/
  hostAgentClient.js
  operationsRuntime.js
  sseHub.js

host-agent/
  jarvis_host_agent/
    collectors/
    adapters/
    actions.py
    config.py
    protocol.py
    server.py
  tests/

deploy/host-agent/
deploy/operations/
```

The production panel build is generated under `ops-ui/dist/` and is not
committed. The server Docker image builds it in a separate build stage and
copies only static output into `/app/server/public/ops`.

## Milestone 0: Baseline and Contract Fixtures

### Task 0.1: Record the current baseline

Before changes, run:

```powershell
cd server
npm test
cd ..
git diff --check
```

Run the parser test suite using its configured environment. Local Windows may
not have a usable Python executable, so an environment-only failure is recorded
rather than hidden with unrelated project changes. Before parser deployment,
run the same suite using the production parser virtual environment.

Capture read-only VPS fixtures for tests without copying secrets:

- `systemctl show tg-parser.service` selected non-secret properties;
- Docker Compose project/container JSON output;
- representative `/proc/meminfo`, `/proc/loadavg`, disk, and inode values;
- bounded redacted journal lines;
- parser systemd-state and bounded redacted journal shapes without
  session/config data.

Store synthetic equivalents under `host-agent/tests/fixtures/`; do not commit
raw production output.

### Task 0.2: Define the shared Host Agent protocol

Create:

- `host-agent/jarvis_host_agent/protocol.py`;
- `server/src/operations/hostAgentProtocol.js`;
- `host-agent/tests/test_protocol.py`;
- `server/test/operationsHostAgentProtocol.test.js`.

Define a versioned JSON request and response envelope containing request ID,
protocol version, operation name, validated arguments, result state, timestamps,
and bounded error code. Separate read operations from changing operations.

For each operation define an exact closed argument schema, including maximum
array items, string lengths, and per-field formats. The response must echo the
request ID and operation name exactly. Changing requests use a durable Host
Agent idempotency journal keyed by the request ID: the Agent persists the
terminal result before returning it, returns that result for a duplicate ID,
rejects an ID reused with different operation/arguments, and exposes a bounded
read operation for reconciling a previously accepted ID after a disconnect or
restart. A timeout is still `unknown` to the server until that reconciliation
returns a verified terminal result.

Initial operation names:

```text
host.snapshot
services.snapshot
service.logs.read
service.start
service.stop
service.restart
backup.status
backup.run
parser.snapshot
```

Do not include a generic command field. Reject unknown fields, overlong
identifiers, unsupported versions, argument-schema violations, request-ID
reuse with a changed payload, and responses above the configured byte limit.

Exit criterion: Node and Python validate the same fixtures, and no protocol
field can carry arbitrary command text.

## Milestone 1: Operations Database Foundation

### Task 1.1: Add core operations schema

Add `server/src/db/migrations/007_operations_control_plane.sql` with:

- `ops_hosts`;
- `ops_services`;
- `ops_service_capabilities`;
- `ops_panel_approval_requests`;
- `ops_panel_sessions`;
- `ops_operation_runs`;
- `ops_admin_audit`;
- `ops_incidents`;
- `ops_events`;
- `ops_backup_runs`;
- `ops_maintenance_flags`.

Use database checks for bounded identifiers and known states. Keep browser
credential hashes as fixed-length binary values. Approval requests contain a
five-minute expiry and single consumed/denied state. Panel sessions contain
creation, last-use, label, coarse client metadata, and revocation timestamps,
but no automatic expiry column used for authorization.

Use one seeded host row for the current VPS through an idempotent repository
initializer, not a migration containing production-specific labels.

### Task 1.2: Add metrics and parser schema

Add `server/src/db/migrations/008_operations_telemetry.sql` with:

- `ops_metric_samples` for 30-second raw samples;
- `ops_metric_rollups` for five-minute aggregates;
- `ops_log_entries` for bounded normalized journald and Docker log records;
- `ops_parser_results` for found-job/classification summaries;
- indexes for host/service/time queries and retention batches.

Do not use a new time-series database. Keep payloads bounded and keep commonly
filtered fields in typed columns rather than one unrestricted JSON document.

### Task 1.3: Add connection-reassignment records

Add `server/src/db/migrations/009_operations_connections.sql` with:

- `device_reassignments`, linking the old device, target profile, generated
  re-pair request, status, and audit timestamps;
- `device_kind` on `devices`, initially `computer` with reserved `mobile` and
  `web` values;
- optional `source_device_id` on pairing codes so the new device row can be
  traced to the revoked binding without moving old command history.

Telegram reassignment uses the existing `user_identities` row and changes only
its future `user_id`. Device reassignment revokes the old row, cancels its
non-terminal commands, and creates a re-pair request for the target profile.
The Desktop claims that request through the existing pairing boundary and
receives a new device row and token.

### Task 1.4: Add repositories and migration tests

Create focused repositories under `server/src/operations/repositories/`:

- `operationsRepository.js`;
- `telemetryRepository.js`;
- `panelSessionRepository.js`;
- `incidentRepository.js`;
- `connectionAdminRepository.js`.

Update `server/test/migrations.test.js` with migrations 007-009. Add
`server/test/operationsRepositories.test.js` for parameterization, state
transitions, retention boundaries, session revocation, and atomic reassignment.

Exit criterion: migrations apply once, repositories never return personal
content, and simulated reassignment leaves old history attached to the old
profile.

## Milestone 2: Read-Only Host Agent

### Task 2.1: Build the local agent service

Create the Python standard-library package under `host-agent/`. The agent:

- listens only on `/run/jarvis-host-agent/agent.sock`;
- runs as a dedicated privileged Host Agent account only where systemd/Docker
  management requires it; its fixed manifest is the authority boundary;
- sets the socket directory to traversable only by root and a dedicated
  `jarvis-server` group, and the socket to `0660 root:jarvis-server`;
- validates an authenticator from an ignored file readable by the Host Agent
  and the Fastify process only (not a root-only file that the `node` container
  cannot read);
- enforces request and response byte limits;
- has no public TCP listener;
- executes subprocesses only from fixed argument builders with `shell=False`;
- uses bounded timeouts and output sizes;
- emits structured logs to journald.

Create:

- `deploy/host-agent/jarvis-host-agent.service`;
- `deploy/host-agent/jarvis-host-agent.tmpfiles.conf`;
- `deploy/host-agent/config.example.json`;
- `deploy/host-agent/README.md`.

The real config and authenticator stay outside Git. The config registers exact
systemd units, Compose project paths, parser paths, and backup unit names.
The deployment runbook creates the matching host group and container group
mapping before the server starts; an inaccessible socket or secret is a hard
startup failure, not a fallback to TCP.

### Task 2.2: Implement host collectors

Create collectors for:

- `/proc` CPU, memory, swap, load, network, and uptime;
- filesystem size, free space, and inodes for configured mountpoints;
- systemd unit state via selected `systemctl show` properties;
- Docker project/container state, health, restart count, and one-shot resource
  use via fixed Docker CLI calls;
- bounded journald and Docker log reads;
- backup status file and systemd timer state.

Normalize all timestamps to UTC and all capacities to bytes. A missing source
returns `unavailable` with an error code, not zero and not healthy.

### Task 2.3: Add service discovery and management registry

Discovery lists all Docker containers and relevant systemd units. A separate
root-owned config section names managed service IDs and maps each ID to one
exact systemd unit or Compose service. Only those IDs advertise changing
capabilities.

Keep the initial managed set limited to:

- Jarvis Compose server;
- Jarvis Cloudflare Tunnel;
- PostgreSQL only after stop/start behavior is tested separately;
- `tg-parser.service`;
- parser discovery service;
- Jarvis backup service.

PostgreSQL should remain read-only in the panel until its restart behavior and
Jarvis error presentation have been accepted in production observation.

### Task 2.4: Test the Host Agent

Add Python tests for malformed requests, fixed command construction, timeout,
output truncation, missing commands, unknown services, log bounds, duplicate
request IDs, and synthetic collector fixtures. Tests monkeypatch subprocesses;
they do not control the developer machine.

Exit criterion: the agent returns a complete synthetic VPS snapshot, rejects
all undeclared actions, and has no general shell path.

## Milestone 3: Server Collection and Live Operations API

### Task 3.1: Connect Fastify to the agent

Create `server/src/operations/hostAgentClient.js` using Node's Unix-socket
support. Mount `/run/jarvis-host-agent/` into the server container read-only
and mount the server-side authenticator with the explicit container UID/GID
required by the `node` process. The container receives neither the Docker
socket nor host privilege.

Extend:

- `server/src/config/loadConfig.js` with operations enablement, socket path,
  authenticator path, polling intervals, owner ID, public origin, and retention
  settings;
- `deploy/env.example` with non-secret settings;
- `deploy/docker-compose.yml` with the Unix-socket directory, secret, and UI
  build/runtime changes;
- `deploy/server.Dockerfile` with a panel build stage.

Operations remain disabled by default outside configured environments.

### Task 3.2: Implement the collector worker

Create:

- `server/src/operations/collectors/collectorWorker.js`;
- `server/src/operations/collectors/snapshotNormalizer.js`;
- `server/src/operations/collectors/rollupWorker.js`;
- `server/src/operations/collectors/retentionWorker.js`.

The collector fetches host and service snapshots every 30 seconds, upserts
service state, stores raw samples, and publishes bounded change events. The
rollup worker creates idempotent five-minute aggregates. The retention worker
deletes small indexed batches:

- raw metrics older than 24 hours;
- rollups, resolved incidents, completed operation runs, administrative audit,
  and bounded events older than 60 days; open incidents are never removed by
  age retention;
- parser results older than 15 days;
- logs exceeding per-service quota, 60 days, or the global 10 GB budget.

Retention failures create an operations incident and do not broaden deletion
targets.

### Task 3.3: Add read APIs and SSE

Create `server/src/operations/routes/readRoutes.js` and
`server/src/operations/sseHub.js` with:

```text
GET /ops/api/overview
GET /ops/api/services
GET /ops/api/services/:id
GET /ops/api/services/:id/metrics
GET /ops/api/services/:id/logs
GET /ops/api/incidents
GET /ops/api/events
GET /ops/api/backups
GET /ops/api/parser
GET /ops/api/stream
```

Every list endpoint has fixed maximum page size, validated cursors, and bounded
time ranges. SSE sends event IDs, heartbeats, and only summary payloads. A
client that reconnects beyond retained event history receives a signal to
refresh through REST. Every subscription is associated with its validated panel
session ID; session revocation removes and closes all of that session's active
subscriptions immediately, rather than waiting for EventSource to reconnect.

### Task 3.4: Wire a focused operations runtime

Create `server/src/operations/operationsRuntime.js` to construct repositories,
workers, routes, and stop hooks. `server/src/runtime.js` receives only a small
call to create/start/close this sub-runtime. Do not place collector or session
logic directly in the main runtime.

Add tests:

```text
server/test/operationsHostAgentClient.test.js
server/test/operationsCollector.test.js
server/test/operationsRollup.test.js
server/test/operationsRetention.test.js
server/test/operationsReadRoutes.test.js
server/test/operationsSse.test.js
server/test/operationsRuntime.test.js
```

Exit criterion: with synthetic agent data, the API reports the VPS and services
live, generates rollups, and restarts without duplicate intervals or events.

## Milestone 4: Telegram-Approved Panel Sessions

### Task 4.1: Implement session credentials and middleware

Create:

- `server/src/operations/sessions/sessionCredentials.js`;
- `server/src/operations/sessions/sessionService.js`;
- `server/src/operations/auth/requirePanelSession.js`;
- `server/src/operations/routes/sessionRoutes.js`.

Routes:

```text
POST   /ops/api/session/request
GET    /ops/api/session/request/:id
POST   /ops/api/session/logout
GET    /ops/api/sessions
DELETE /ops/api/sessions/:id
```

An approval request expires after five minutes and is single-use. At request
creation, issue a distinct random browser-request verifier in a host-only
Secure, HttpOnly, SameSite=Strict cookie and store only its hash with the
approval request. The poll route must require that verifier before it reports
state or issues the approved session credential, so the opaque request ID alone
cannot claim a session. Store only hashes. The session itself has no expiry;
touch `last_used_at` at a bounded frequency rather than on every request.

Restrict every `/ops/*` route, including request/poll and static assets, to the
configured exact operations hostname. Require an approved owner session for
every `/ops/api/*` route except the verifier-bound request/poll routes. Require
same-origin `Origin` (and reject cross-site Fetch Metadata) for all state
changing operations; SameSite cookies are defense in depth, not the sole CSRF
control. A logged-in session can forget itself or another listed session
without Telegram confirmation.

### Task 4.2: Add Telegram approval callbacks

Extend `server/src/telegram/bot.js` with a narrow `callback_query:data` handler
and add
`server/src/operations/sessions/telegramApproval.js`. Callback data contains
only a compact opaque approval ID and decision. Validate:

- callback sender equals the configured operations owner;
- request is pending and younger than five minutes;
- decision is applied atomically once;
- callback answers do not reveal a browser credential.

Do not route approval callbacks through the assistant or store them as family
conversation messages.

### Task 4.3: Add session tests

Test unknown browsers, verifier mismatch, allow, deny, expiry, duplicate
callback, wrong Telegram user, callback routing, cookie properties, server
restart persistence, no automatic expiry, forgetting, REST/SSE rejection after
forgetting (including closing an already-open SSE connection), cross-origin
state changes, and Telegram unavailability.

Exit criterion: a new browser requires Telegram once; after approval it remains
fully usable until forgotten.

## Milestone 5: Incidents, Human Summaries, and Notifications

### Task 5.1: Add deterministic incident rules

Create:

- `server/src/operations/incidents/incidentEngine.js`;
- `server/src/operations/incidents/statusLanguage.js`;
- `server/src/operations/incidents/incidentNotifier.js`.

Rules include:

- ordinary health checks open after three consecutive failures;
- a systemd `failed` state or unexpected stop opens immediately;
- stale data is `no_fresh_data`, never healthy;
- one open incident exists per host, service, and failure kind;
- repeated observations update that incident without repeated alerts;
- recovery closes it in the panel without a Telegram recovery message.

Human summaries use deterministic Russian templates first. An optional model
summary may be added only from redacted bounded facts and must never initiate
or recommend an undeclared operation.

### Task 5.2: Send owner error alerts

Use the existing main bot API and configured owner destination. Send only a new
error notification with service, plain-language impact, observed time, and a
panel link. Parser found-job notifications stay unchanged.

If Telegram delivery fails, retain the unsent state and retry only the
notification with bounded backoff. Do not retry service actions.

### Task 5.3: Add Jarvis-specific checks

Create collectors for readiness, migration state, polling freshness, tunnel,
queues, Desktop presence, backup age, and configured provider health. The
provider probe runs every six hours with a minimal prompt and no tools, memory,
documents, user messages, or family data.

Exit criterion: seeded failures produce one understandable alert and one panel
incident, and no service is restarted automatically.

## Milestone 6: Responsive Operations UI

### Task 6.1: Scaffold the isolated UI package

Create `ops-ui/` with TypeScript strict mode, Vite, React, Vitest, and Testing
Library. Add scripts for `dev`, `build`, `test`, and `typecheck`. The application
uses a small typed fetch client and native `EventSource`; do not add a general
state-management or charting package initially.

Create reusable primitives for status, cards, compact tables, metric sparklines
using SVG, filters, drawers, dialogs, empty states, error states, and mobile
navigation. Preserve the approved dark industrial visual direction.

### Task 6.2: Implement login and application shell

Implement:

- unknown-browser approval request screen;
- pending, denied, expired, and Telegram-unavailable states;
- desktop sidebar and mobile navigation;
- session-aware API bootstrap;
- SSE reconnect with REST refresh fallback;
- explicit loading, stale, empty, and unavailable states.

### Task 6.3: Implement read-only screens

Create routes/pages for:

- overview;
- services and service detail;
- parsers;
- Jarvis connections;
- infrastructure;
- incidents;
- events/audit;
- logs;
- backups;
- settings/sessions.

Desktop uses dense tables and charts. Mobile keeps status, incidents, service
details, connections, and actions usable while replacing dense chart tables
with compact summaries and drill-down views.

### Task 6.4: Serve production assets

Register `@fastify/static` from a focused operations static module. Update the
global security-header hook so API responses retain restrictive headers while
panel HTML/assets receive a route-specific CSP allowing only same-origin
scripts, styles, images, fonts, fetch, and SSE. No inline executable script or
external CDN is required.

Add UI unit tests and server static-route tests. Run a production build and
visually verify key desktop and phone widths before deployment.

Exit criterion: an approved browser can use every read screen on desktop and
phone without exposing an unbounded endpoint.

## Milestone 7: Fixed Manual Operations

### Task 7.1: Implement Host Agent actions

Add action handlers only for registered targets:

- start, stop, and restart service;
- run configured backup service;

Each handler builds exact argument arrays. The API cannot supply unit names,
Compose paths, executable paths, environment variables, or command fragments.

### Task 7.2: Add operation service and routes

Create:

- `server/src/operations/actions/operationService.js`;
- `server/src/operations/routes/operationRoutes.js`.

Routes:

```text
POST /ops/api/services/:id/actions/start
POST /ops/api/services/:id/actions/stop
POST /ops/api/services/:id/actions/restart
POST /ops/api/backups/actions/run
```

The service creates an operation record before contacting the Host Agent,
passes the same operation ID, and stores the verified result. It does not retry
changing operations after timeout, disconnect, or restart. A duplicate browser
submission with the same idempotency key and identical normalized request
returns the existing operation; reuse of a key with a different action, target,
or arguments is rejected. The service may reconcile a previously accepted
Host-Agent operation ID, but never creates a second changing request.

The panel session is the authorization; do not add Telegram confirmation.

### Task 7.3: Add action UI

Add action menus and short in-panel confirmation dialogs that state target and
action. These dialogs prevent accidental clicks but are not authentication and
do not contact Telegram. Show pending, succeeded, failed, and unknown results
from operation records.

Exit criterion: only explicitly registered services expose buttons, every
action has a durable audit record, and unknown results are never displayed as
success.

## Milestone 8: Existing Parser Observation

The production parser already runs on the VPS outside this repository. This
milestone changes neither its source, virtual environment, session, systemd
unit, configuration, notification destination, sources, nor discovery flow.

### Task 8.1: Read-only parser adapter

Implement `host-agent/jarvis_host_agent/adapters/tg_parser.py` and server parser
normalization using only selected `systemctl show tg-parser.service` properties,
the process freshness visible to systemd, and bounded redacted journal records.
If the existing deployment already exposes a non-secret status/checkpoint file,
it may be listed in root-owned Host Agent config and read as a bounded optional
source; absence is `unavailable`, not an error or a reason to modify parser.

Store only service-state and bounded operational summaries for 15 days. Do not
store Telegram session data, tokens, proxies, source lists, messages, found-job
content, classification content, or parser configuration. Keep current parser
alert delivery untouched.

### Task 8.2: Verify observation only

Run the parser's existing test suite in its production virtual environment as a
read-only acceptance check, then compare panel state with `systemctl` and
journald. Do not restart the service during this milestone.

Exit criterion: the panel accurately displays the parser service's current
health and bounded operational errors while the parser behavior and files are
unchanged.

## Milestone 9: Jarvis Connection Administration

### Task 9.1: Add metadata-only connection queries

Create:

- `server/src/operations/connections/connectionAdminService.js`;
- `server/src/operations/routes/connectionRoutes.js`.

Routes expose only profile display metadata, Telegram identity labels/IDs,
device label/type/status/last seen, and binding state. Do not join or serialize
messages, memories, documents, chunks, Desktop request content, or command
arguments/results.

### Task 9.2: Implement Telegram reassignment

In one transaction:

1. lock the identity and both profiles;
2. update only `user_identities.user_id`;
3. write a bounded admin audit event;
4. return the new metadata mapping.

Do not update old conversations, messages, memories, documents, audit rows, or
device ownership. New Telegram activity resolves to the new profile through
the existing identity lookup.

### Task 9.3: Implement device reassignment

In one transaction:

1. lock the device and target profile;
2. cancel non-terminal commands for the old device;
3. revoke the old binding;
4. create a short-lived re-pair request linked to the old device and target
   profile;
5. record the admin operation.

The panel shows the re-pair code to the owner. When entered on that computer,
the existing pairing flow creates a new token and device row for the target
profile. Old commands and results remain attached to the revoked row and old
profile.

### Task 9.4: Add connection UI and tests

Implement a separate Connections screen with profile rows and clear Telegram
and device columns. Add direct admin reassign actions and pending-reconnect
state. Do not send family-user confirmation or notification.

Test cross-profile history preservation, command cancellation, old token
revocation, new token creation, and response redaction.

Exit criterion: the owner can see and edit `profile -> Telegram -> device`
links without gaining a reader for personal content.

## Milestone 10: Backups Without Stopping Jarvis

### Task 10.1: Add a knowledge-write maintenance gate

Use `ops_maintenance_flags` for `knowledge_writes_paused`. Add a small gate to
document upload and the knowledge worker. While paused, new uploads return a
clear temporary-unavailable response and queued ingestion does not start.
Ordinary chat, Telegram polling, memory, Desktop sessions, and the operations
panel continue.

The upload gate and the worker's `claimNextIngest` query must read and enforce
the flag inside their respective database transactions; a check before a later
claim is insufficient. The backup path writes and clears the flag through a
fixed, authenticated `psql` invocation inside the existing PostgreSQL Compose
service, never through an unauthenticated HTTP route. It waits for every
running document-ingest and embedding job to reach a terminal state before the
database dump and document-volume snapshot, with a bounded timeout that clears
the flag and fails safely.

### Task 10.2: Update backup scripts and reporting

Modify `deploy/backup/backup.sh` to:

- acquire the existing backup lock;
- set the knowledge-write flag;
- wait boundedly for active document-ingestion and embedding jobs to finish;
- run `pg_dump` and snapshot the document volume;
- clear the flag in an exit trap;
- write a bounded machine-readable result under a configured host state
  directory;
- never stop the Jarvis server.

Update the timer to one daily run. Keep restic credentials outside Git. Update
`server/test/backupScripts.test.js` for the maintenance flag, trap, result
record, and absence of `docker compose stop server`.

### Task 10.3: Automate isolated restore verification

Extend `deploy/backup/restore.sh` or add
`deploy/backup/verify-restore.sh` to require an explicitly named empty target,
create a separate test database and document directory, restore there, start an
isolated verification server, and run an owner-scoped search for a known test
document. It must refuse live database names and document paths.

The first real restore remains a supervised production acceptance step.

Exit criterion: a daily-format backup completes while Jarvis remains available
and restores into isolation with successful private-document search.

## Milestone 11: Production Rollout and Documentation

### Task 11.1: Deploy observation-only

On the VPS:

1. install the Host Agent files and ignored config/authenticator;
2. start the Unix-socket service;
3. deploy database migrations and server collection with actions disabled;
4. add `ops.jarvis.rilora.ru` to the existing Cloudflare Tunnel routing;
5. approve the first browser through the main Jarvis bot;
6. compare panel values with `systemctl`, Docker, `/proc`, disk tools, and the
   parser for at least one normal operating cycle;
7. verify no periodic status message is sent.

Do not modify Xray or bind host ports 80/443.

### Task 11.2: Verify retention and incidents

Seed or safely simulate one non-production service failure, one stale
collector, one duplicate error, and one oversized log fixture. Verify human
status, one owner alert, panel resolution, and correct retention behavior.

### Task 11.3: Enable managed actions gradually

Enable actions in this order:

1. Jarvis server restart;
2. Cloudflare Tunnel restart;
3. manual backup;
4. PostgreSQL restart only if explicitly accepted after observation.

For each action, compare the durable operation result with actual systemd or
Docker state. Do not enable automatic recovery.

### Task 11.4: Complete acceptance and status docs

Run:

```powershell
cd server
npm test
cd ..\ops-ui
npm test
npm run typecheck
npm run build
cd ..
git diff --check
```

Run Host Agent and parser Python suites in their valid environments, then run
`deploy/scripts/preflight.sh`, Compose health checks, and
`deploy/scripts/smoke.sh` on the VPS.

Perform the isolated restore acceptance. Verify phone and desktop panel flows,
session forgetting, no per-command Telegram prompt, parser notification
destination, family-content privacy, and 6-hour provider probe.

Update:

- `README.md` only with verified current capability;
- `docs/README.md` as status authority;
- `deploy/README.md` with the operations deployment/runbook;
- `AGENTS.md` if runtime ownership, safety boundaries, or verification commands
  changed;
- a dated operations rollout record under `docs/updates/`.

Exit criterion: all design acceptance conditions are verified against the live
VPS and documented without marking future VPN/proxy/autodeploy work complete.

## Recommended Commit Boundaries

Keep implementation commits small and independently verifiable:

1. operations protocol and database schema;
2. read-only Host Agent and fixtures;
3. server collection, rollups, retention, and SSE;
4. Telegram-approved persistent panel sessions;
5. incident rules and owner error notifications;
6. responsive read-only operations UI;
7. fixed manual operations;
8. read-only Jarvis parser adapter and panel integration;
10. connection administration;
11. non-stopping backup and restore verification;
12. production acceptance and documentation.

Never include secrets, local browser credentials, parser sessions, parser
configuration, production logs, database dumps, generated UI output, or
unrelated dirty-worktree changes.

## Immediate Next Action

Begin Milestone 0 and Milestone 1 locally only. The first implementation change
should define and test the protocol envelopes and database schema before adding
the UI or any VPS-changing action. Deploy only after the read-only Host Agent,
session boundary, and collector tests pass locally.
