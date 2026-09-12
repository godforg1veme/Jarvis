# Jarvis Life OS Core v1 Design

Status: approved design as of 2026-09-12.

This specification introduces the Life OS domain without replacing the current
cloud-brain/local-hands architecture. Historical specifications remain valid
where they describe Telegram, Desktop, memory, knowledge, Vision, devices, and
the Action Orchestrator. This document defines how those capabilities become
one event-driven personal operating system.

## Goal

Turn Jarvis from a primarily reactive conversational assistant into an
owner-scoped system that observes permitted signals, records normalized facts,
links them to areas and projects, preserves commitments, restores context,
creates explainable proposals, and executes only through the existing trusted
confirmation and Tool Gateway path.

The first complete acceptance scenario is:

1. The owner says through Telegram or Desktop Voice: "Tomorrow evening I will
   continue the Life OS design."
2. Jarvis stores the accepted message/transcript as a normalized event, links
   it to the Life OS project, and creates a commitment with provenance.
3. Living Timeline shows the event, inferred link, confidence, and source.
4. Mission Control shows the project and an explainable reminder proposal.
5. The owner confirms the changing action in the originating client.
6. The existing Action Orchestrator and Desktop Tool Gateway execute it.
7. The verified result creates a terminal event, updates the commitment, and is
   visible in Timeline and Mission Control.
8. A later "continue Life OS" request restores the relevant decisions,
   documents, open commitments, recent activity, and suggested next step.

Completion requires this loop to work jointly across the real domain services;
isolated tables, mock UI, or a synthetic happy-path test are insufficient.

## Product Surface

Mission Control is Desktop-first. It becomes the primary Life OS surface in the
Electron client and uses authenticated device-scoped cloud APIs. The UI is
responsive and its API is client-neutral so a later PWA can reuse it, but public
PWA authentication and release are not part of Core v1.

Telegram remains a first-class input, confirmation, notification, and query
client. It is no longer the product's conceptual center. The cloud control plane
remains the source of truth; Desktop remains the execution edge.

## Core Principles

- Facts enter one immutable, append-oriented Event Spine.
- Timeline, Mission Control, commitments, and proposals are projections over
  the same owner-scoped source data.
- Raw voice bytes, screen frames, document bodies, secrets, and provider output
  are not duplicated into Life OS events.
- Every stored row and every lookup is scoped by `user_id` before ranking,
  linking, or returning data.
- Deterministic identifiers and trusted source references are preferred over
  model inference.
- Model-created links and proposals are untrusted structured suggestions until
  schema and policy validation succeeds.
- Life OS may propose a changing action but cannot execute it or weaken its
  confirmation policy.
- Only a successful Tool Gateway result can establish action success.
- Failure of Life OS enrichment must not break the underlying message, Vision,
  knowledge, device, or action path.

## Domain Model

Migration `013_life_os_core.sql` introduces the following owner-scoped records.
All foreign references that cross Life OS tables include owner consistency
checks in repository transactions. Public identifiers are opaque UUIDs.

### Areas and projects

`life_areas` represents durable areas such as work, family, home, health,
finance, and development. An owner receives a small idempotent default set and
may create, rename, archive, and reorder areas.

`life_projects` represents bounded efforts inside an area. A project stores
name, summary, status, optional target date, timestamps, and revision. Status is
`active`, `paused`, `completed`, or `archived`. Archiving does not delete its
history.

### Event Spine

`life_events` stores:

- `id`, `user_id`, `event_type`, `occurred_at`, and `recorded_at`;
- trusted `source_channel`, bounded `source_ref`, and optional source device;
- `deduplication_key`, `correlation_id`, and optional `causation_event_id`;
- bounded human-readable summary and schema-versioned structured data;
- `confidence`, `privacy_class`, and `trust_level`;
- processing state and non-content failure code.

The unique owner/source/type deduplication key makes Telegram retries, Desktop
request replay, device reconnect, Vision retries, and workflow result delivery
idempotent. Events are not updated to revise meaning. Corrections and lifecycle
changes append new events and update only derived records.

Initial event families are:

- `message.received` and `voice.transcribed`;
- `vision.observed`;
- `document.ingested` and `document.ingest_failed`;
- `device.connected`, `device.disconnected`, and `device.state_changed`;
- `project.created`, `project.updated`, and `project.archived`;
- `commitment.detected`, `commitment.updated`, and `commitment.completed`;
- `proposal.created`, `proposal.dismissed`, `proposal.confirmed`, and
  `proposal.expired`;
- `workflow.started`, `workflow.awaiting_confirmation`, `workflow.completed`,
  `workflow.failed`, and `workflow.outcome_unknown`;
- `feedback.recorded`.

### Links

`life_event_links` connects an event to an area, project, conversation,
document, device, workflow, commitment, proposal, or another event. Each link
stores relation type, origin (`trusted`, `inferred`, or `user`), confidence,
and creation time. User corrections form a trusted overlay and never erase the
original machine inference.

### Commitments

`life_commitments` stores a bounded title, status, optional due time, source
event, optional area/project, confidence, and revision. Status is `open`,
`completed`, `dismissed`, or `expired`. A commitment always retains provenance
and is never created from low-confidence text without being visibly labelled as
an inference.

### Proposals and evidence

`life_proposals` stores the proposed outcome, explanation, status, risk class,
expiry, cooldown key, optional project/commitment, optional workflow, and
origin channel/device/conversation. `life_proposal_evidence` lists the exact
owner-scoped events used to create it.

Proposal status is `open`, `confirmed`, `dismissed`, `expired`, `executing`,
`completed`, `failed`, or `outcome_unknown`. Confirmation freezes the proposal,
target, action, arguments, evidence set, and origin identity before delegating
to the existing orchestrator.

`life_feedback` records usefulness, incorrect link, wrong project, dismissal,
and suppression preferences. Feedback may tune future ranking but cannot
change trusted policy or grant execution authority.

## Server Components

Create focused CommonJS modules under `server/src/life/`:

```text
lifeSchemas.js               bounded request/event schemas
lifeEventRepository.js       owner-scoped persistence and claims
lifeEventGateway.js          single normalized ingestion boundary
lifeProjectionRepository.js  areas, projects, links, commitments, proposals
lifeLinker.js                trusted and inferred relationships
commitmentDetector.js        bounded commitment extraction
proposalService.js           evidence-backed proposal lifecycle
timelineService.js           event and project timeline projection
contextRecoveryService.js    compact working-context reconstruction
missionControlService.js     current owner dashboard projection
proactivityWorker.js         claimed, bounded proactive rules
lifeRoutes.js                authenticated Desktop API
lifePublic.js                response redaction and public envelopes
```

The runtime wires one shared `LifeEventGateway` into existing services. Source
services publish accepted facts after their own authentication and validation;
they do not import projection repositories or create proposals directly.

## Source Adapters

### Telegram and Desktop messages

After deduplication and owner resolution, accepted text records
`message.received`. A successfully decoded Telegram or Desktop voice transcript
records `voice.transcribed`; raw audio never reaches Event Spine. Existing
conversation and assistant behavior continues even when enrichment is
temporarily unavailable.

### Vision

Only a schema-valid observation produced inside an active authorized Vision
lease records `vision.observed`. The event contains a bounded summary,
observation reference, source identity, confidence, and retention metadata. It
does not contain image bytes, plaintext OCR payload, protected-window content,
or authority to reopen a sensor.

### Documents and memory

Knowledge records `document.ingested` only after successful bounded ingestion
and indexing. Life OS stores the document identifier, safe metadata summary,
and project candidates, not document content. Existing conversational memory
is a retrieval source and may be linked by trusted IDs; it is not bulk-copied
into events.

### Devices and actions

Device lifecycle creates metadata-only events. The Action Orchestrator emits
workflow lifecycle events through a small observer interface. Desktop Tool
Gateway never writes directly to Life OS; only the authenticated command result
and orchestrator continuation establish the terminal event.

## Ingestion and Enrichment Flow

For every accepted source fact:

1. Validate event type, schema version, field size, timestamp, and source.
2. Derive owner and device from the authenticated service context, never from
   untrusted request fields.
3. Compute a deterministic deduplication key.
4. Insert the event atomically or return the existing event.
5. Create trusted links from known conversation, document, device, and workflow
   identifiers.
6. Queue the event for bounded enrichment using an atomic claim.
7. Match explicit project/area aliases and recent owner context.
8. Optionally request one schema-constrained model classification.
9. Validate inferred links and commitment candidates, then persist confidence
   and provenance.
10. Evaluate declared proactive rules and create at most one cooldown-protected
    proposal per rule key.

The worker has bounded batch size, attempts, result bytes, and processing time.
A stale claim is reconciled. An unknown action outcome is not retried under a
new identifier.

## Safe Proactivity

Core v1 supports only declared rules:

- a commitment is approaching its due time;
- a commitment becomes overdue;
- an active project has an unfinished recent context but no activity;
- a relevant document was added to an active project;
- a workflow completed, failed, or has unknown outcome;
- a user-requested follow-up condition becomes true.

Each rule declares event inputs, lookback window, confidence threshold,
cooldown, maximum open proposals, expiry, risk class, and allowed action
manifest. Proactivity creates a proposal or safe notification. It never creates
a changing command by itself.

## Context Recovery

`ContextRecoveryService` builds a bounded, source-backed response for an active
project from:

- recent trusted and high-confidence events;
- latest decisions and workflow results;
- open commitments and proposals;
- linked document metadata and citations;
- active devices required for the next action;
- the last known continuation point.

The response separates verified facts, inferred links, and suggestions. It
contains stable source references and remains within a fixed item/token budget.
No independent summary copy becomes a second source of truth.

## Authenticated API

Life routes use the existing device authenticator and rate limiter. Owner
identity is derived from the bearer token. Initial routes are:

```text
GET    /desktop/life/bootstrap
GET    /desktop/life/timeline
GET    /desktop/life/projects
POST   /desktop/life/projects
PATCH  /desktop/life/projects/:projectId
GET    /desktop/life/projects/:projectId/context
GET    /desktop/life/mission-control
POST   /desktop/life/events/:eventId/feedback
POST   /desktop/life/proposals/:proposalId/confirm
POST   /desktop/life/proposals/:proposalId/dismiss
```

Pagination uses bounded opaque cursors. Writes require strict schemas and
optimistic revision checks. Responses exclude owner IDs, internal source keys,
raw model output, storage paths, command arguments containing sensitive data,
and private data from unrelated domains. Missing and cross-owner resources use
the same public not-found response.

Confirmation endpoints do not execute tools directly. They validate the
proposal and origin, then invoke the existing Action Orchestrator with the
frozen declared action. A proposal created from Telegram is confirmed in the
same Telegram conversation; Desktop may display it but cannot satisfy that
confirmation. Desktop-origin proposals are bound to that authenticated device.

## Mission Control and Living Timeline

Mission Control becomes a dedicated Desktop surface reachable from Cloud Chat
and the tray. It reuses the existing authenticated Desktop cloud transport and
does not receive database credentials or a local inbound port.

The home view contains:

- one current mission or continuation point;
- active projects grouped by area;
- open commitments ordered by urgency and confidence;
- explainable proposals requiring attention;
- recent meaningful events;
- device availability relevant to the selected action;
- clear links to Timeline and project context.

Living Timeline provides day and project views, source chips, relation and
confidence indicators, evidence links, and correction controls. It does not
render every telemetry update as a user-visible item; projection rules collapse
noise while preserving the immutable underlying history.

Design direction is restrained editorial command space: the existing Quantum
Core remains Jarvis's identity, while Timeline is readable and dense rather
than decorative. Use existing assets and no new production dependency. All
controls are keyboard accessible, have textual names and visible focus, meet
WCAG AA contrast, remain usable at 320, 390, and 1440 pixels, and respect
reduced motion.

Desktop preload exposes only bounded Life OS methods. Renderer code cannot
construct arbitrary cloud paths, bearer headers, SQL, or Tool Gateway actions.

## Failure and Recovery

- Event persistence failure is logged as bounded metadata and does not turn a
  successful underlying operation into failure.
- Enrichment failure leaves the source event available as unclassified and may
  retry within its bounded attempt policy.
- Unknown project candidates appear under Unsorted and remain correctable.
- Provider failure degrades to deterministic links and rules.
- Offline Desktop receives cached shell state and an explicit stale/offline
  indication; changing proposals cannot be confirmed offline.
- A missing target device leaves the proposal open or expired; it does not
  claim execution.
- Disconnect after dispatch preserves the orchestrator's unknown-outcome
  semantics and creates `workflow.outcome_unknown`.
- Projection rebuild is idempotent and derives from events plus current
  lifecycle records.
- Invalid or cross-owner evidence invalidates the whole proposal.

## Security and Privacy Invariants

- Owner A cannot list, infer, link, rank, correct, confirm, or restore owner B's
  events, projects, commitments, proposals, or evidence.
- Source identity and owner identity never come from model output.
- Uploaded documents and observed visual text remain untrusted content.
- Prompt injection cannot create events with trusted origin, change proposal
  policy, select undeclared actions, or confirm execution.
- Event JSON and summaries are size bounded before persistence and before model
  use.
- SQL is parameterized; dynamic ordering and event types use allowlists.
- Raw voice, images, OCR, document bodies, tokens, local paths, and provider raw
  responses never enter events, logs, Operations archives, or API responses.
- Changing proposals preserve the existing origin-client confirmation policy.
- No event, model classification, Timeline control, or Mission Control control
  bypasses Action Orchestrator or Tool Gateway.
- The Desktop opens no inbound control port.

## Testing Strategy

### Repository and contract tests

- migrations apply from an empty database and upgrade the current schema;
- every repository read/write is owner-scoped and parameterized;
- idempotency prevents duplicate source and terminal events;
- cross-owner project, link, proposal, and evidence operations look absent;
- schema bounds reject oversized summaries, payloads, cursors, and identifiers;
- projection rebuilding produces the same result.

### Source adapter tests

- Telegram text and voice create events after update/owner validation;
- Desktop text and voice derive owner/device from authentication;
- Vision emits only after an authorized schema-valid observation;
- document success and failure create metadata-only lifecycle events;
- device reconnects do not duplicate lifecycle facts;
- orchestrator terminal results create exactly one terminal event;
- source behavior still succeeds when Life OS enrichment is unavailable.

### Proactivity and confirmation tests

- declared rules create evidence-backed proposals with cooldown and expiry;
- low-confidence inputs do not silently become trusted commitments;
- no proactive rule directly executes a changing action;
- Telegram and Desktop confirmations fail from another user, conversation,
  channel, or device;
- unknown outcomes are never automatically repeated;
- only schema-valid verified results mark proposals and commitments complete.

### UI and end-to-end tests

- Mission Control and Timeline render useful empty, loading, stale, error, and
  populated states at 1440, 390, and 320 pixels;
- keyboard, focus, accessible names, reduced motion, and content overflow pass;
- Desktop message, Voice, Vision, document, device, and action fixtures appear
  in one correlated Timeline;
- the full acceptance scenario runs from source event through confirmation,
  verified action result, Timeline update, and context recovery;
- existing cloud, Voice, Vision, Tool Gateway, remote protocol, Operations, and
  packaging regression suites remain green.

## Runtime and Deployment

The server worker starts and stops with the existing runtime. No new public
service, database port, Docker socket, sudo path, or ingress mode is added.
Life API routes remain device-authenticated under the existing HTTPS origin.

Rollout order is migration, server with ingestion disabled, projection
backfill only for explicitly supported metadata, source-by-source enablement,
Desktop UI, proactivity in observe-only mode, then changing proposals through
existing confirmations. Feature flags permit disabling ingestion, enrichment,
and proactivity independently without disabling chat or commands.

No historical raw conversation, visual frame, or document body is bulk-imported.
Backfill may create only bounded metadata events with explicit `backfill`
provenance and deterministic keys.

## Delivery Checkpoints

1. Event schema, migration, repositories, and owner isolation.
2. Event Gateway, worker claims, deterministic projections, and feature flags.
3. Telegram, Desktop Voice/text, Vision, document, memory-reference, device,
   orchestrator, and Tool Gateway-result adapters.
4. Areas, projects, links, commitments, feedback, and context recovery.
5. Explainable proposals, proactive rules, and origin-bound confirmation.
6. Authenticated APIs, Mission Control, Living Timeline, and Desktop IPC.
7. Cross-source end-to-end acceptance and adjacent regression suites.
8. Documentation aligned with verified reality.
9. Current Windows installer build, local installation, installed-runtime smoke
   test, commit, and push after all earlier gates pass.

Checkpoints are implementation order, not separate product releases. Core v1 is
not complete until they operate together.

## Definition of Done

Life OS Core v1 is complete only when:

- all named source families emit the common event contract without storing raw
  sensitive media or weakening their existing behavior;
- Event Spine, areas, projects, links, commitments, proposals, feedback,
  Timeline, context recovery, and Mission Control are owner-scoped and usable;
- safe proactivity is evidence-backed, bounded, deduplicated, explainable, and
  incapable of bypassing origin confirmation;
- the full acceptance scenario completes with a real repository, authenticated
  API boundary, Desktop UI, orchestrator handoff, verified result, and restored
  context;
- failure, replay, cross-owner, prompt-injection, unknown-outcome, responsive
  UI, and accessibility tests pass;
- server, Desktop, Voice, Vision, Tool Gateway, remote protocol, Operations, and
  packaging regressions pass in proportion to affected code;
- deployment preflight, migration, health, and smoke checks pass without
  exposing PostgreSQL or internal workers;
- README and authoritative status documents describe only verified capability;
- a current Desktop EXE is built, installed on this PC, and smoke-tested;
- the intended files are committed without absorbing unrelated user changes,
  and the resulting branch is pushed successfully to GitHub.

## Explicit Non-Goals

- Public PWA authentication and release.
- Arbitrary autonomous goals or model-generated schedules.
- Bulk import of historical private content.
- Raw continuous audio, screen, or camera recording.
- New arbitrary shell, PowerShell, browser-coordinate, or Docker authority.
- Provider-specific mail, finance, health, or smart-home connectors beyond the
  common adapter contract; each requires its own later privacy and action spec.
- Enabling deferred backup scheduling as a side effect of this project.
