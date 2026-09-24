# Jarvis Operations Control Panel Design

Status: approved design as of 2026-09-04.

## Goal

Add one owner-only operations panel to Jarvis for observing and manually
managing the VPS, Jarvis itself, the already deployed Telegram job parser, and
future services running on the same host.

The panel is part of Jarvis, not a separate product. Jarvis remains the cloud
brain and source of identity, device, conversation, and knowledge data. The
operations panel adds a bounded administrative view over infrastructure and
service health without exposing family members' private content.

## Approved Product Decisions

- The panel is a responsive web application on a dedicated hostname such as
  `ops.jarvis.rilora.ru`, published through the existing Cloudflare Tunnel.
- The UI is an isolated React, Vite, and TypeScript package in this repository.
  Its production build is served by the existing Fastify server.
- A new browser session is approved through the main Jarvis Telegram bot by the
  configured owner account. The owner Telegram ID is configuration, not
  hard-coded application behavior.
- An approved browser session has no automatic expiry. The owner can list and
  forget sessions. A forgotten session loses access immediately and must be
  approved through Telegram again.
- The approved panel session is sufficient authorization for panel commands.
  Start, stop, restart, parser controls, and backup commands do not require a
  separate Telegram confirmation.
- If Telegram is unavailable, an already approved panel session keeps both
  read and control access. A new browser cannot be approved until Telegram is
  available again.
- There is no automatic service recovery. Jarvis detects, records, explains,
  and reports failures; the owner decides whether to act.
- The UI explains operational state in ordinary Russian, while retaining
  technical details in expandable views.
- The first release manages one VPS and all services discovered on it. The data
  model may retain a host identifier, but multi-host orchestration is not part
  of this release.
- Automatic code deployment, client VPN, proxy administration, and automatic
  recovery are future projects, not hidden parts of this implementation.

## Scope

### Included

- whole-host CPU, memory, swap, load, uptime, disk, inode, and network metrics;
- Docker Compose projects, containers, health, restart counts, and resource
  use;
- relevant systemd units and their current state;
- bounded journald and Docker log viewing;
- Jarvis API, database, migrations, Telegram polling, Cloudflare Tunnel,
  provider checks, queues, and connected devices;
- the existing `tg-parser.service`, including status, errors, queue/activity,
  sources, discovery, and found-job history;
- human-readable incidents and owner-only error notifications;
- manual commands from the panel;
- daily backup status and an on-demand backup command;
- an administrative connection map between family profiles, Telegram
  identities, computers, and future device types;
- session listing and revocation;
- audit history for administrative actions;
- desktop and mobile layouts for the same web application.

### Excluded

- arbitrary shell or PowerShell input;
- a general-purpose Docker control endpoint or direct Docker socket access from
  the Jarvis server;
- automatic restart, rollback, repair, cleanup, or deployment;
- permanent data deletion from the first release;
- editing parser classification rules;
- moving or reinstalling the production parser during initial integration;
- reading family users' conversations, memory, documents, or requests;
- client VPN and proxy configuration;
- a second monitoring product such as Grafana, Portainer, or a separate admin
  portal.

## Architecture

The implementation has four bounded parts:

1. **Operations web UI** renders overview, service, parser, connection,
   incident, log, backup, event, and settings screens. It uses REST for reads
   and commands and Server-Sent Events for live updates.
2. **Operations API inside Fastify** owns browser approval, sessions,
   authorization, service metadata, metrics queries, incidents, audit records,
   command validation, and UI asset delivery.
3. **Jarvis Host Agent** runs as a dedicated systemd service on the VPS. It
   reads host, systemd, Docker Compose, and bounded log state and executes only
   fixed actions declared in its manifest.
4. **Collectors and integrations** translate Jarvis and parser-specific state
   into the common service, metric, event, and incident contracts.

The Fastify container must not receive the Docker socket, unrestricted sudo,
or arbitrary host-shell access. The Host Agent is the only host-management
boundary. It exposes a small local authenticated protocol and rejects any
action that is absent from its manifest.

The agent automatically discovers Docker and systemd services so the panel can
show the whole VPS. Discovery does not automatically grant control: newly
discovered services are read-only until added to the managed-service registry.

## Operations Web UI

The approved visual direction is a dark, information-dense operator interface
with clear health colors, compact charts, and Russian human-readable status.
The primary sections are:

- **Overview:** overall VPS state, active failures, resource pressure, backup
  freshness, and service summary;
- **Services:** all discovered Docker and systemd services, with explicitly
  managed services offering start, stop, and restart;
- **Parsers:** current parser activity, sources, discovery, errors, and recent
  found jobs;
- **Jarvis connections:** family profile to Telegram identity and device
  mapping;
- **Infrastructure:** host, Docker, database, tunnel, network, disk, and model
  provider state;
- **Incidents:** open and resolved operational problems with a plain-language
  explanation and technical detail;
- **Events and audit:** administrative actions and their outcomes;
- **Logs:** bounded filtering and viewing by service and time;
- **Backups:** latest result, age, history, and manual run;
- **Settings:** active panel sessions, service registration, retention display,
  and notification destination.

On a phone, status, incidents, connections, and manual service controls remain
fully usable. Dense charts and log tables switch to simpler summaries and
drill-down views rather than shrinking desktop tables.

## Browser Approval and Sessions

When an unknown browser opens the panel, the API creates a short-lived approval
request. The main Jarvis Telegram bot sends the owner the browser label and an
allow or deny choice. The approval request expires after five minutes and
cannot be reused. Approval creates a random browser credential. The browser
receives it in a Secure, HttpOnly cookie; the server stores only a derived
value suitable for validating it.

The session record contains a label, creation time, last-use time, coarse
client information, and revocation state. It does not expire automatically.
The settings screen lists active sessions and provides one direct **Forget
session** action. Revocation invalidates subsequent API and SSE requests.

There is no second confirmation per operational command. The API validates
that the request belongs to an active owner session, that the target service
is registered for management, and that the requested command is declared. It
then records the request and result in the audit trail.

This owner-panel session model applies only to the operations panel. It does
not silently change confirmation rules for family-facing Desktop commands or
other Action Orchestrator workflows.

## Host Agent and Managed Actions

The Host Agent runs with only the operating-system permissions needed for the
approved service inventory and actions. Its protocol accepts structured action
names and arguments, never command text.

The first manifest supports:

- read host metrics and uptime;
- list Docker Compose projects and containers;
- read container state, health, restart count, and resource use;
- list relevant systemd units and read their state;
- read bounded recent logs for a selected registered service;
- start, stop, or restart an explicitly registered service;
- request a configured backup job;
- read backup metadata and result;
- read parser status and invoke its declared pause, resume, source, and
  discovery operations.

Every command has an operation ID and a terminal result. A timeout or lost
connection is reported as unknown or failed, never converted into success. The
panel does not automatically retry changing actions.

## Common Operational Model

The API normalizes infrastructure into a small set of records:

- `hosts` identify the VPS and its latest contact time;
- `services` identify Docker, systemd, Jarvis, parser, database, tunnel, and
  provider components;
- `service_capabilities` determine which fixed actions are available;
- `metric_samples` contain raw time-series values;
- `metric_rollups` contain five-minute aggregates;
- `incidents` represent deduplicated open and resolved problems;
- `events` represent bounded service and collector events;
- `operation_runs` record requested actions and verified outcomes;
- `panel_sessions` represent approved browsers;
- `backup_runs` record scheduled and manual backup results;
- `parser_results` store bounded found-job and classification summaries.

Service state is mapped to human-facing levels such as **Работает**,
**Требует внимания**, **Недоступен**, and **Нет свежих данных**. Technical
source state remains available for diagnosis.

## Collection, Retention, and Storage Limits

- Host and service metrics are sampled every 30 seconds.
- Raw metric samples are retained for 24 hours.
- Five-minute metric aggregates are retained for 60 days.
- Technical logs, incidents, administrative audit, and bounded service events
  have a maximum retention of 60 days.
- Parser found jobs and classification results are retained for 15 days.
- Stored logs share a 10 GB maximum budget with per-service quotas. When a
  quota or global budget is reached, the oldest eligible records are removed
  first, so high log volume may reduce actual log history below 60 days. This
  size limit does not shorten incident or administrative audit retention.
- Retention work is bounded and incremental so it cannot monopolize the
  database or starve assistant traffic.

Secrets, Telegram tokens, session credentials, document content, and private
conversation text are excluded from operational logs and audit records.

## Incidents and Notifications

Collectors create or update a single incident per service and failure kind.
Repeated observations update the same incident instead of producing repeated
notifications.

An ordinary availability incident opens after three consecutive failed checks,
approximately 90 seconds. A systemd unit entering `failed` or unexpectedly
stopping opens an incident immediately. Resolution is reflected in the panel;
there is no separate recovery notification requirement.

Only new errors are sent through the existing main Jarvis Telegram bot to the
configured owner destination. There are no periodic Telegram status reports.
The panel always contains the current summary.

Jarvis generates or selects a concise Russian explanation from bounded
technical facts: what stopped working, likely impact, and useful next manual
action. The explanation cannot initiate an action by itself.

## Jarvis-Specific Monitoring

Jarvis monitoring includes:

- live and readiness health;
- database reachability and migration state;
- Telegram polling freshness and update errors;
- Cloudflare Tunnel state;
- action and ingestion queue depth and age;
- Desktop device presence and connection freshness;
- backup age and result;
- configured model-provider availability.

The provider check runs every six hours as a minimal health request. It does
not use tools, user memory, documents, conversations, or family data.

## Existing Parser Integration

The production parser is already fully deployed as `tg-parser.service` from
`/home/deploy/apps/TG-Parser-Freelance-Bot`. The first release must not copy a
second runtime, replace its virtual environment, move its session, or switch
its systemd unit.

Integration adds a narrow local status contract or heartbeat that exposes only
the data required by the panel: process freshness, queue/activity, latest
source checks, bounded errors, source registry, discovery state, and bounded
found-job summaries. The Host Agent reads that contract and maps it into the
common model.

The panel may pause or resume the parser, edit its source list through a
validated parser-specific operation, and start discovery. Editing
classification rules is postponed. Existing parser notifications continue to
their current destination; the panel does not reroute them through Jarvis.

A later migration may place parser source under a Jarvis worker package while
keeping session and runtime data outside Git. Such a migration requires a
parallel verification period and is not part of initial panel integration.

## Jarvis Connection Administration

The connection view models:

`family profile -> Telegram identities -> computers/devices/sessions`

It shows which Telegram identity and physical client belong to each family
profile and allows the owner to reassign them. A mobile device type is reserved
in the schema, but real mobile registration waits for a PWA or mobile client.

Administrative reassignment does not require confirmation from the family
member and does not send them a notification. It is recorded in the audit
trail.

Reassigning a Telegram identity does not move old conversations, memory,
documents, or audit history. Those remain with the original profile; only new
activity belongs to the new profile.

Reassigning a device cancels incomplete commands, revokes the previous device
binding and token, creates a new binding, and requires the Desktop client to
reconnect. Existing command and result history remains with the original
profile.

The panel exposes connection metadata and operational state only. It does not
provide an administrative reader for personal conversations, memory,
documents, or requests.

## Backups and Restore Acceptance

One backup runs daily without stopping Jarvis. A consistent database and
private-document snapshot may briefly pause new document upload and ingestion,
but ordinary assistant and Telegram operation continues.

Backup status includes start time, finish time, size, result, and bounded error
detail. The panel may request an additional backup using the configured backup
job; it cannot supply arbitrary paths or commands.

Backup completion is not accepted solely because an archive exists. Production
acceptance requires restoring into a separate database and document directory,
starting an isolated verification instance, and successfully retrieving a
known private document through owner-scoped search. The verification must not
overwrite live data.

## Failure Handling

- Stale collector data becomes **Нет свежих данных** rather than healthy.
- Host Agent loss disables affected commands and creates a deduplicated
  incident.
- A command remains pending only for its bounded timeout, then becomes failed
  or unknown with the last verified fact.
- Changing commands are never retried automatically.
- A collector or UI failure cannot restart a service.
- Metric, log, and parser retention failures create an incident instead of
  deleting outside their configured datasets.
- Telegram loss prevents new browser approval but does not invalidate an
  already approved session.
- SSE reconnection resumes from the latest available event when possible and
  falls back to a fresh REST snapshot when history is no longer available.

## Testing Strategy

### API and session tests

- an unapproved browser cannot read or change operations data;
- only the configured owner can approve a browser;
- approved sessions survive server restarts and have no time-based expiry;
- forgetting a session immediately blocks REST and SSE access;
- Telegram unavailability blocks new approval but not an active session;
- no operation requires a second Telegram confirmation;
- session credentials and Telegram tokens never appear in logs or API bodies.

### Host Agent contract tests

- malformed and undeclared actions are rejected;
- unregistered discovered services remain read-only;
- structured start, stop, and restart map only to the selected registered
  service;
- timeouts, duplicate operation IDs, restarts, and unknown outcomes do not
  produce false success;
- log reads enforce service, time, byte, and line bounds;
- the Jarvis server can operate the agent without access to arbitrary shell or
  the Docker socket.

### Collection and retention tests

- 30-second samples and five-minute rollups produce expected values;
- stale data and three consecutive failed checks produce the correct states;
- immediate systemd failure creates one incident;
- duplicate errors do not create notification storms;
- 24-hour, 15-day, and 60-day retention boundaries are applied to the correct
  datasets;
- per-service and global log limits remove only the oldest eligible records.

### Product and privacy tests

- desktop and phone layouts can perform every included manual action;
- technical failures have a human-readable Russian summary;
- family connection mapping is visible and editable;
- Telegram and device reassignment preserve old private ownership and revoke
  the previous device binding where required;
- operations APIs cannot return family conversation, memory, request, or
  document content;
- the existing parser continues running and notifying its current destination
  throughout read-only integration.

### Production acceptance

1. Deploy the Host Agent and panel in observation-only mode.
2. Verify VPS, Docker, systemd, Jarvis, and existing parser state against the
   host for an agreed observation period.
3. Verify metric aggregation, retention, incidents, logs, and error delivery.
4. Enable the fixed command manifest for explicitly registered services.
5. Verify Telegram browser approval, persistent access, session forgetting,
   and direct panel commands.
6. Verify family connection mapping without exposing private content.
7. Run a real daily-format backup and restore it into isolated database and
   document storage.
8. Verify owner-scoped search for a known private document in the restored
   environment.

## Delivery Sequence

The feature should be implemented in slices that remain independently
testable:

1. common operations schema, service registry, and read-only Host Agent;
2. metrics, health summaries, incidents, retention, and Telegram error
   delivery;
3. Telegram-approved persistent browser sessions and session forgetting;
4. responsive web UI with overview, services, infrastructure, incidents,
   events, logs, and settings;
5. existing parser heartbeat, history, source, and discovery integration;
6. fixed manual operations for explicitly registered services and backups;
7. family connection administration;
8. daily backup and isolated restore acceptance.

No slice should migrate the parser, expose general host control, add automatic
recovery, or start the later VPN/proxy/deployment projects.

## Future Projects

The following are intentionally deferred and require separate designs:

- automatic code deployment and rollback, marked as distant future;
- automatic service recovery;
- client VPN management;
- proxy and Xray administration;
- real mobile/PWA device enrollment;
- parser classification-rule editing;
- migration of the current parser runtime into the Jarvis repository;
- additional VPS hosts and fleet management.
