# Jarvis Life OS v2 Design

**Date:** 2026-09-14

**Status:** Approved architecture; implementation has not started

> Implementation update, 2026-09-15: the design is implemented in the local
> repository and covered by focused, integration, browser, security, and
> regression tests. After a separate explicit owner request, the Desktop package
> was built, content-inspected, installed, and launch-smoked. Real PostgreSQL
> acceptance, live external providers, and production server deployment have
> not been performed. See `docs/updates/2026-09-15-jarvis-life-os-v2.md` for exact evidence.

## Summary

Life OS v2 extends the deployed Life OS Core v1 into the contextual and
proactive operating layer of Jarvis. It does not replace Jarvis, its canonical
persona, the conversation system, memory, documents, Voice, Vision, devices,
Telegram, Desktop, VPN, Operations, the Action Orchestrator, or Tool Gateway.
It connects those capabilities through an owner-scoped life context and a
closed, observable action loop:

```text
permitted signal
  -> validated normalized event
  -> deterministic meaning and relationships
  -> owner-scoped projections and ranked context
  -> contextual Jarvis response
  -> explainable proposal
  -> origin-bound confirmation when required
  -> declared Orchestrator action
  -> verified Tool Gateway result
  -> Timeline, commitment, recovery, and preference updates
```

The implementation is an evolutionary extension of Core v1. Existing tables,
repositories, event types, APIs, UI, and proven safety boundaries remain in
place. New responsibilities are isolated in focused modules and integrate
through explicit contracts. Life OS remains independently disableable: an
unavailable context composer, projection worker, provider, source adapter, or
proactivity worker must not break normal Jarvis chat or existing commands.

## Current-State Audit

The design is based on the repository state and automated checks inspected on
2026-09-14.

### Already implemented and retained

- The append-oriented, owner-scoped Event Spine, typed event links, areas,
  projects, commitments, proposals, proposal evidence, feedback, Timeline,
  Mission Control projection, context summary, and bounded proactivity exist
  under `server/src/life/`.
- Migration `013_life_os_core.sql` supplies the Core v1 database model.
- Telegram, Desktop, Voice transcript, Vision, knowledge, device, and
  orchestrator lifecycle facts can enter the Life event path without copying
  prohibited raw media or document bodies.
- Proposal lifecycle and the Action Orchestrator already support frozen
  declared actions, origin-bound confirmation, verified results, failures, and
  unknown outcomes.
- Desktop has a bounded Life OS preload bridge and a Mission Control/Timeline
  interface under `renderer/life-os/`.
- Existing owner isolation, schema validation, deduplication, cooldown,
  redaction, and failure-degradation tests pass.
- The baseline server suite and focused Desktop Life OS tests pass. The local
  Life OS browser fixture passes through the bundled browser runtime.

### Partially implemented

- Commitment detection handles a useful deterministic subset but not the full
  Russian/English time, recurrence, correction, cancellation, rescheduling,
  people, and verified-completion lifecycle required by v2.
- Mission Control presents current data but chooses the first active project,
  rather than using an explainable priority calculation or explicit pin/hide
  state.
- Context recovery returns a bounded project summary but does not create a
  durable, previewable recovery plan or execute its declared steps.
- Proactivity produces evidence-backed safe cards for a small set of rules but
  does not cover the required rule families or create useful changing-action
  proposals in production logic.
- Feedback is recorded, but it is not yet aggregated into inspectable and
  editable user preferences.

### Missing in Core v1

- Life context is not composed into ordinary Telegram and Desktop replies.
- Trusted communication guidance derived from explicit mode and preferences is
  absent.
- People, relationships, explicit family sharing, life modes, reminder
  delivery, recovery-plan records, source-adapter connections/cursors, and
  explainable priority state are absent.
- There is no provider-neutral Life Source Adapter contract for calendar,
  email, task, receipt, delivery, travel, subscription, and smart-home inputs.
- There is no local project/workspace registry that lets cloud proposals refer
  to a project without storing local paths.

This matrix is an implementation baseline, not a production-readiness claim.

## Goals

1. Make relevant Life OS facts improve every normal Telegram and Desktop
   answer without hijacking unrelated questions or trusted prompt policy.
2. Preserve Jarvis's canonical identity while adapting brevity, initiative,
   interruption level, and wording from explicit settings and cautious,
   non-diagnostic situational signals.
3. Select and explain a useful current mission through a deterministic,
   inspectable priority engine.
4. Turn context recovery into a previewed plan whose executable steps pass
   through existing action manifests, confirmation, Orchestrator, and Tool
   Gateway boundaries.
5. Produce deduplicated proactive suggestions that include both informational
   proposals and real declared actions.
6. Model people, relationships, modes, preferences, reminders, and safe source
   integrations as owner-scoped domains.
7. Complete at least one real repository-backed end-to-end scenario from the
   phrase "Завтра вечером продолжу проект Life OS" to a verified action and a
   recoverable continuation point.
8. Preserve all current Jarvis behavior and provide explicit degraded modes.

## Non-Goals

- Replacing the canonical Jarvis persona or making Life OS a separate product.
- Giving a model arbitrary scheduling, shell, PowerShell, filesystem, browser
  coordinate, Docker, VPN, smart-home, financial, or account authority.
- Inferring or persisting psychiatric diagnoses, hidden personality profiles,
  emotions stated as facts, or unnecessary sensitive characteristics.
- Creating implicit shared family memory or copying data between owners.
- Storing local file paths, window handles, credentials, source storage keys,
  document bodies, OCR bodies, images, audio, or raw provider output in Life
  tables.
- Connecting real third-party accounts, deploying to production, changing the
  VPS, or building/installing Desktop EXE without separate user authorization.
- Adding a new production dependency without separate approval.
- Enabling deferred backup scheduling as a side effect.
- A broad redesign or unrelated refactor of the server or Desktop client.

## Architectural Decision

Life OS v2 remains a set of domains inside the existing cloud control plane.
The cloud remains the durable brain: it owns identities, context, reminders,
proposals, and source synchronization metadata. Desktop remains the local
execution edge: it resolves project-local resources and performs approved app,
file, and window operations.

A separate Life OS service was rejected because it would duplicate identity,
transactions, confirmation, deployment, and observability. A model-first agent
was rejected because it would make priority, family access, reminders, and
changing actions nondeterministic. Models may enrich bounded candidates, but
they do not own policy, identity, state transitions, or execution.

New server modules are grouped by responsibility:

```text
server/src/life/context/
  lifeContextComposer.js
  lifeContextRanker.js
  communicationGuidance.js
server/src/life/priority/
  priorityEngine.js
  priorityFactors.js
server/src/life/people/
  peopleRepository.js
  peopleService.js
  familyAccessPolicy.js
server/src/life/modes/
  lifeModeRepository.js
  lifeModeService.js
  lifeModePolicy.js
server/src/life/preferences/
  lifePreferenceRepository.js
  lifePreferenceService.js
  feedbackAggregator.js
server/src/life/reminders/
  reminderRepository.js
  reminderService.js
  reminderWorker.js
server/src/life/recovery/
  recoveryPlanRepository.js
  recoveryPlanService.js
server/src/life/proactivity/
  proactivityEngine.js
  rules/*.js
server/src/life/sources/
  lifeSourceAdapter.js
  sourceRegistry.js
  sourceSyncService.js
  parsers/*.js
tools/workspaceRegistry.js
tools/workspacePreparationService.js
```

Existing Core v1 modules remain owners of their current contracts. In
particular, the Event Gateway remains the only normalized event ingestion
boundary, proposal lifecycle remains in `proposalService.js`, and the existing
Orchestrator and Tool Gateway remain the only changing-action path. The new
modules compose those services rather than growing their repositories into
multi-domain monoliths.

## Data Model

Migration `016_life_os_v2.sql` extends Core v1. Every durable domain table has a
mandatory `user_id`; cross-table mutations check that referenced rows have the
same owner inside one transaction. Public IDs are opaque UUIDs. Bounded enums,
length checks, JSON shape checks, timestamps, revision columns, and indexes are
defined in migration and mirrored in application schemas.

### People and relationships

`life_people` stores a safe display name, optional user-defined aliases, a
coarse relationship category, optional notes explicitly supplied by the owner,
archive state, timestamps, and revision. It does not ingest full contact cards,
addresses, phone numbers, biometric traits, health data, or inferred sensitive
attributes.

`life_person_relationships` describes an owner-visible relationship between
two person records or between the owner and a person. Direction, coarse type,
explicitness, confidence, and provenance are retained. Machine-inferred
relationships remain labelled and correctable.

`life_person_project_links` links a person to an owner-scoped project with a
bounded role such as participant, stakeholder, assignee, or beneficiary. It is
not an authorization grant.

Existing event links gain `person` as an allowed target type through the
versioned schema. Commitments may reference a beneficiary or counterpart via a
same-owner person ID.

### Explicit family access

Family access is not represented by a broad shared-owner flag.
`life_family_access_grants` references:

- the granting owner;
- a known family member user identity;
- one closed resource scope: area, project, event category, commitment, or
  family calendar source;
- closed permissions such as view-summary, contribute-event, or acknowledge;
- start, optional expiry, revision, and revocation state.

The implementation may reuse an existing family membership table where it
already establishes identities, but Life OS authorization requires its own
resource-scoped grant. A person record alone never grants access. Shared API
queries first authorize the grant and then apply the owning user's scope. They
return only the resource fields allowed by that grant. Shared content is not
copied into the member's private Timeline, memory, prompt context, or search
index. Revocation takes effect before subsequent read/rank operations.

The grant table has a unique active owner/member/resource/permission key, an
optimistic revision, and a revocation event. Database foreign keys prove the
grantor and recipient are known family identities, while service policy proves
that the grantor owns the resource. Grant rows never authorize a member's
device or local actions on the owner's Desktop.

### Modes

`life_modes` stores the owner's current explicit mode, source (`manual` or
`accepted_suggestion`), start time, optional expiry, revision, and last mode
transition event. The closed mode set is Work, Focus, Home, Family, Meeting,
Travel, Rest, Sleep, and Emergency.

Automatic evidence never changes mode silently. It can create a safe mode
suggestion. Emergency mode is manually activated or explicitly accepted; it
cannot expand permissions or bypass privacy, authentication, confirmation,
quiet-hour, or action-policy rules.

### Preferences

`life_preferences` uses named, schema-versioned preference records rather than
an unrestricted settings blob. Initial groups are:

- response style: concise, balanced, or detailed;
- contextual adaptation enabled/disabled;
- initiative: minimal, normal, or high;
- notification windows and quiet hours;
- maximum proactive notifications per period;
- prioritized and deprioritized areas;
- suppressed proposal rule types;
- default handling for low-confidence links;
- preferred reminder lead times.

Values may be explicit or derived from aggregated feedback. Explicit values
always win. Derived values include an explanation, source counts, confidence,
last update, and reversible status. Users can inspect, override, or delete each
preference. Deletion removes the derived state but not immutable audit events
that are required for proposal history; those events expose only the original
bounded feedback classification.

### Reminders

`life_reminders` stores owner, bounded title, optional commitment/project/person
links, trigger time, timezone, optional validated recurrence, delivery
channels, origin identity, state, idempotency key, next attempt, delivery
claim, attempt count, and revision. It stores no arbitrary message template or
executable action arguments.

Reminder state is scheduled, claimed, delivered, acknowledged, cancelled,
expired, failed, or outcome_unknown. Delivery is a cloud notification to an
authorized Telegram conversation and/or a paired Desktop session; it is not a
local OS mutation. A reminder may create a proposal such as "prepare the Life
OS workspace", but that proposal follows its own confirmation policy.

Core v1 `life_commitments` gains a closed `kind` (`commitment` or `task`) and
optional recurrence metadata. `life.task.create` therefore creates a real open
task in the same commitment lifecycle instead of introducing a competing task
source of truth. Imported external tasks remain source events linked to a local
task only after the deterministic linking/deduplication policy accepts them.

Recurring reminders use a closed recurrence schema for daily, selected
weekdays, weekly, monthly-date, and interval-based schedules. Timezone and DST
resolution are deterministic. The next occurrence is committed atomically
with terminal handling of the current occurrence so worker replay cannot
double-deliver.

### Recovery plans and steps

`life_recovery_plans` stores owner, project, source context revision, bounded
summary, status, expiry, origin channel/device/conversation, creation reason,
and revision. Status is draft, ready, awaiting_confirmation, executing,
completed, partial, failed, outcome_unknown, expired, or cancelled.

`life_recovery_steps` stores an ordered closed step type, safe user-facing
label, risk class, declared action name, opaque resource reference, dependency
indices, status, and verified result summary. Frozen action arguments remain
inside the trusted proposal/orchestrator domain and are not exposed by the
renderer response.

Cloud plans may refer to a `workspace_project_id`, document ID, application
class, workflow ID, or short-lived Desktop candidate ID. They cannot contain a
path, executable name supplied by a model, window handle, or shell fragment.

### Source connections and cursors

`life_source_connections` stores owner, adapter type, enabled state, selected
scope, privacy policy version, configuration metadata safe for display, health
status, last successful sync, and failure code. It stores an opaque secret
reference only when an existing credential vault supplies one; it never stores
tokens or passwords itself.

`life_source_cursors` stores owner, connection, adapter schema version, bounded
opaque provider cursor, last claimed sync, and revision. Cursors are treated as
sensitive metadata: they are excluded from public APIs, prompts, events, and
logs.

### Explainable priority state

`life_project_priority_state` stores the owner's explicit pin, temporary hide
until, optional user weight, latest calculated score, confidence, factor
breakdown, calculation version, and timestamps. The score is a disposable
projection and can be rebuilt. User pin/hide state is durable intent and is
not overwritten by calculation.

## Life Context in Ordinary Replies

### Composition boundary

`LifeContextComposer.compose()` runs after authenticated owner resolution and
before prompt assembly for ordinary Telegram and Desktop messages. It receives
only trusted request context: user ID, channel, conversation ID, optional
authenticated device ID, current time, locale, bounded user text, and feature
flags. The user ID never comes from request body content or model output.

The composer performs bounded parallel retrieval for:

- active area and selected or highest-priority project;
- recent meaningful events;
- open and approaching commitments;
- open proposals;
- recent confirmed decisions and verified workflow outcomes;
- related document metadata and paired device state;
- last working-session continuation point;
- explicit modes and preferences;
- safe, permission-filtered family summaries relevant to the current request.

It never loads the entire Timeline. Each source has a small candidate limit.
`LifeContextRanker` scores candidates from deterministic factors: direct text
match, explicit/current project, recency decay, due urgency, link provenance,
confidence, current mode, user priority, and privacy eligibility. Per-category
caps prevent a noisy source from consuming the budget. The final result has
strict item, character, and estimated-token limits and deterministic tie
breaking.

If retrieval exceeds its time budget, fails, or projections are stale beyond
the configured limit, the composer returns no context or a smaller verified
subset. Prompt building continues. This failure is visible through bounded
telemetry but not disclosed as internal database detail.

### Prompt separation

Prompt construction uses two separate objects:

```js
{
  communicationGuidance: {
    responseLength: 'concise',
    initiative: 'minimal',
    interruptionPolicy: 'focus',
    emotionalAdaptation: true,
    wordingCautions: ['situational_signals_are_uncertain']
  },
  lifeContext: {
    asOf: '...',
    facts: [],
    commitments: [],
    proposals: [],
    continuation: null,
    sourceStatus: 'fresh'
  }
}
```

`communicationGuidance` is trusted server-derived instruction. It can be
created only from explicit mode, explicit settings, and allowlisted preference
logic. It cannot add tools, change policy, grant data access, suppress required
confirmation, or claim user emotion.

`lifeContext` is untrusted contextual data. All Timeline summaries, source
messages, document metadata/text snippets, Vision summaries, inferred links,
and external-adapter fields remain clearly delimited as data. The prompt tells
the model to ignore instructions embedded in that data. Model output still
passes the existing policy-sensitive validation and corrective retry.

### Relevance and non-interference

The composer can improve a reply, mention an approaching commitment, or offer
a relevant next step. It must not inject unrelated Life OS material into a
simple factual question. A deterministic relevance gate requires either a
direct topic/project/person match, a near-term high-priority commitment, an
explicit continuation intent, or a critical safe signal allowed in the
current mode.

Life OS context does not replace conversation history, semantic memory, or
knowledge retrieval. Prompt budgets are allocated independently so adding Life
OS cannot silently remove all ordinary conversational context. With Life OS
disabled, unavailable, or empty, both channels use their current prompt and
action behavior unchanged.

## Contextual Persona and Empathy

The canonical Jarvis persona remains versioned in the existing prompt domain.
`CommunicationGuidance` adds only bounded style decisions:

- high load or Focus mode prefers short answers and one next action;
- a verified failed/unknown action uses calm wording and states what is known;
- an approaching deadline permits more direct initiative;
- Rest or Sleep suppresses non-urgent proactive interruptions;
- an explicit user preference can disable situational adaptation entirely.

Situational signals are not emotions. Jarvis may say "Похоже, сейчас удобнее
коротко" or "Возможно, после этой ошибки лучше сначала проверить состояние",
but cannot state that the user is anxious, angry, tired, depressed, or otherwise
diagnose them. Signals are ephemeral unless they correspond to an explicit
mode or user preference. They do not become hidden person traits.

## Priority Engine and Mission Control

### Deterministic score

`PriorityEngine` evaluates every eligible active project using a versioned
factor set. Each factor emits a normalized contribution and a human-readable
reason code:

- explicit pin: overrides normal ranking while the project is eligible;
- user weight and area priority;
- due-date proximity and overdue commitments;
- number and severity of open commitments;
- recent meaningful activity with decay;
- stalled duration and unresolved workflow outcomes;
- available time-window compatibility;
- current life mode compatibility;
- device/resource availability for the next step;
- inferred-link confidence and overall evidence confidence.

The implementation uses fixed, tested weights and caps. A pin does not make an
archived or inaccessible project active. A temporary hide excludes the project
until expiry unless the user explicitly opens it. Missing data contributes
zero and lowers confidence rather than being guessed by a model.

The engine persists score, confidence, calculation version, and the bounded
factor breakdown. Mission Control displays the top reasons, for example:
"Закреплено вами", "Срок завтра", and "Есть незавершённое действие". Users can
pin, replace, hide, or restore a mission. These mutations use optimistic
revision checks and append corresponding Life events.

### Mission Control projection

The v2 projection includes:

- chosen mission, score confidence, reasons, pin/hide controls;
- active areas and ranked projects;
- near-term commitments and reminders;
- open safe/changing proposals with risk and expiry;
- recent meaningful events and confirmed decisions;
- failed and unknown workflow outcomes;
- relevant device availability;
- recommended next step;
- recovery-plan availability and status;
- current mode, privacy/source health, and stale timestamp.

An unavailable priority calculation falls back to an explicit pin, then the
most recently active eligible project, while labelling the reason as fallback.
It never silently returns "first row" behavior.

## Commitment Understanding

Deterministic parsing remains authoritative. `CommitmentDetector` is split into
tokenization/normalization, intent patterns, temporal parsing, recurrence,
lifecycle matching, and confidence calculation so the current module does not
become monolithic.

Supported Russian and English inputs include:

- absolute dates and times;
- weekdays and expressions such as tomorrow, the day after tomorrow, next
  Friday, tonight, tomorrow evening, this weekend, and after lunch;
- bounded time ranges such as 18:00-20:00 or "between six and eight";
- commitments without an exact date, visibly marked unscheduled;
- promises to or involving a linked person;
- daily, weekday, weekly, monthly, and interval recurrence;
- explicit cancellation, rescheduling, correction, and completion statements.

Relative expressions are resolved from authenticated receive time, owner
timezone, locale, and a documented day-part mapping. "Tomorrow evening" maps
to a configurable owner default, with the default range represented as a range
rather than a fabricated exact minute. Ambiguity remains explicit and may
create a clarification proposal.

Lifecycle matching first uses explicit commitment/project/person references,
then deterministic recent-candidate scoring. A verified Orchestrator result may
complete a commitment only when the originating proposal or recovery step is
already linked to it. Merely saying that an action succeeded does not establish
completion.

Optional model enrichment receives bounded text and deterministic candidates,
returns a strict schema, cannot invent owner/source/action IDs, and may only
suggest classification or a candidate link. Invalid, unavailable, or
low-confidence output is discarded without breaking deterministic detection.
User corrections append correction events and update projections without
rewriting the original event.

## Reminders and Proactivity

### Durable reminder delivery

`ReminderWorker` uses database claims with expiration, deterministic delivery
keys, bounded batches, and attempt limits. It resolves channels from the
reminder's authorized origin and current paired sessions; it does not accept a
destination from model text. Successful transport records one delivery event.
Ambiguous transport outcome is `outcome_unknown` and is reconciled using the
same idempotency key rather than retried as a new reminder.

Quiet hours, mode policy, rate limits, and initiative settings can delay an
ordinary reminder but cannot erase it. Explicitly critical owner-created
reminders follow a separately allowlisted urgency policy. Emergency mode does
not manufacture urgency.

### Rule engine

`ProactivityEngine` evaluates independently testable rule modules. Each rule
declares accepted event families, lookback, required evidence, confidence
threshold, cooldown, expiry, maximum open proposals, risk class, and allowed
action names. Initial rule classes are:

- approaching commitment;
- overdue commitment;
- stalled active project;
- failed or unknown action outcome;
- new document in an active project;
- lost working context;
- schedule conflict;
- suitable free calendar window;
- important device-state change;
- repeatedly forgotten task;
- meeting preparation;
- explicitly shared family event;
- relevant smart-home attention signal.

Every proposal records source rule/version, evidence event IDs, explanation,
confidence, risk, cooldown key, expiry, project/area/person links, origin
channel/conversation/device, and a closed allowed action. Dedupe is enforced by
an owner-scoped unique cooldown claim, not only application-memory checks.

Initial declared proposal actions are:

- `reminder.create` and `reminder.reschedule` in the cloud domain;
- `life.commitment.reschedule` and `life.task.create` through validated cloud
  domain actions;
- `project.show_documents` as a safe projection/query action;
- `device.status.request` through the existing device/orchestrator contract;
- `workflow.continue` for an already known workflow;
- `workspace.prepare` and existing app/file/window actions on Desktop.

Any action that changes state is classified according to the existing action
manifest and requires origin-bound confirmation. A proactive worker only
creates the proposal. It never confirms or dispatches it. Safe informational
cards may be shown without confirmation but still respect suppression,
cooldown, mode, and privacy rules.

## Context Recovery and Local Workspace Preparation

### Plan preparation

`RecoveryPlanService.prepare()` composes a project recovery plan from verified
events, recent decisions, workflow states, open questions, linked document
metadata, device availability, the last continuation point, and workspace
capabilities advertised by an authenticated Desktop. Preparation is read-only.

The plan distinguishes:

- facts and last verified result;
- unresolved or unknown outcomes;
- suggested next step;
- safe display/query steps;
- changing executable steps.

A plan has a context revision and short expiry. If the project, device, or
workflow state changes before confirmation, execution returns conflict and
requires a refreshed plan. The UI never labels plan preparation as workspace
restoration.

### Local workspace registry

Desktop maintains an owner-approved local workspace registry in writable local
state. A record maps a cloud-safe `workspace_project_id` to local capabilities:
known app aliases, search hints, and user-confirmed candidate selections. The
registry may store local paths only on Desktop under the existing runtime data
policy; it never uploads them.

`workspace.prepare` receives the project ID and bounded requested capability
types, not paths. Tool Gateway invokes `WorkspacePreparationService`, which:

1. resolves the local project registration;
2. uses existing app resolution and opaque short-lived file candidates;
3. produces a bounded preview when candidate choice is ambiguous;
4. executes only declared app/file/window operations allowed by Tool Policy;
5. returns per-step verified status with sanitized labels;
6. never runs model-generated shell or PowerShell.

The cloud receives only terminal status, safe resource labels, opaque
correlation IDs, and continuation metadata. It never receives resolved paths,
window handles, command lines, or process internals.

### Execution semantics

The user first sees the recovery plan. Safe query steps may run according to
their manifests. Changing steps require confirmation in the proposal's origin
client and are sent through the existing Orchestrator. Partial success records
completed and failed steps separately. A disconnect after dispatch becomes
outcome_unknown; neither the plan nor a repeated confirmation dispatches a new
action under a new ID. Only verified Tool Gateway results may mark steps,
proposal, linked commitment, and plan completed.

## Life Modes

`LifeModePolicy` is a closed matrix, not a prompt-generated instruction. It
affects ranking, Mission Control emphasis, notification timing, source
eligibility, proposal visibility, and response guidance:

- Work emphasizes work areas and executable next steps.
- Focus suppresses non-urgent notifications and shortens replies.
- Home emphasizes home tasks and devices while preserving owner permissions.
- Family permits explicitly shared family summaries but no implicit sharing.
- Meeting emphasizes agenda, people, documents, and interruptions only for
  urgent or meeting-relevant events.
- Travel emphasizes bookings, timezones, deliveries, and device availability.
- Rest suppresses routine initiative and favors brief, optional suggestions.
- Sleep queues all non-critical notifications until the allowed window.
- Emergency surfaces owner-defined critical information but grants no new
  access or execution rights.

Adapters may be disabled by mode only as a read/sync policy configured by the
owner. A mode cannot expose a source or family resource that is otherwise
unauthorized.

## People and Relationship Behavior

Person extraction starts with explicit phrases and owner-selected candidates.
The system can associate a meeting, commitment, project, or event with a person
while preserving provenance and confidence. Ambiguous names remain
unresolved. The model may rank same-owner candidates but cannot create a
trusted relationship or family share.

Interaction preferences are explicit, bounded facts such as "prefer morning
meetings" or "use email for project updates". They are never silently inferred
from message sentiment. Deleting a person detaches future ranking and returns
historical links as a neutral removed-person reference where audit integrity
requires retention.

## External Life Source Adapters

### Contract

Every adapter implements the same provider-neutral interface:

```js
{
  type,
  schemaVersion,
  validateConfig(config),
  discoverScopes(context),
  fetchPage({ connection, cursor, limit, signal }),
  parseItem({ item, connection, receivedAt }),
  normalize({ parsed, ownerContext }),
  health({ connection, signal })
}
```

`SourceSyncService` owns authentication context, bounded page size, byte/time
limits, claim/retry behavior, cursor persistence, deduplication, error
sanitization, and Event Gateway submission. Adapters never write Life tables
directly. Provider items are untrusted. Parsed results pass strict schemas and
map only to allowlisted normalized event types. Instruction-looking text inside
email, calendar descriptions, receipts, bookings, or device labels remains
data and cannot become policy, trusted evidence, or an action.

No real provider is claimed as connected without credentials and a live
acceptance run. v2 first supplies the common contract, fake transport,
fixtures, configuration schemas, and deterministic parsers. Provider-specific
OAuth, webhooks, and API transports are later separately authorized adapters.

### Initial parsers

The initial parser modules normalize:

- calendar: event identity, bounded title, start/end/timezone, status,
  attendees as unresolved safe labels, recurrence summary, and conflict keys;
- email: metadata, bounded subject/sender label, received time, thread
  reference, attachment metadata, and candidate intent without storing body;
- tasks/reminders: bounded title, state, due range, recurrence, list label, and
  external reference;
- receipts/invoices: merchant label, date, currency, totals, due state, and
  line-item category summaries without card/account numbers;
- deliveries: carrier label, safe tracking reference hash, status, delivery
  window, and exception code;
- tickets/bookings: provider label, type, date/time/timezone, safe route or
  venue summary, and booking state without full ticket artifacts;
- subscriptions/recurring payments: merchant label, amount/currency, cadence,
  next expected date, and change/cancellation state;
- smart home: declared device ID, class, bounded state transition, severity,
  home area, and timestamp without raw sensor streams.

Each parser has malicious-content, oversized-input, malformed-item,
cross-owner, replay, timezone, and missing-field fixtures. Sensitive provider
payloads are request-temporary and absent from events, prompts, logs, and test
snapshots.

## API and IPC Surface

Existing authenticated Life APIs are extended with bounded routes for:

```text
GET/PATCH  /desktop/life/mission
GET        /desktop/life/people
POST/PATCH /desktop/life/people/:personId
GET/POST   /desktop/life/family-grants
DELETE     /desktop/life/family-grants/:grantId
GET/PUT    /desktop/life/mode
GET/PATCH  /desktop/life/preferences
DELETE     /desktop/life/preferences/:preferenceKey
GET        /desktop/life/reminders
POST/PATCH /desktop/life/reminders/:reminderId
POST       /desktop/life/projects/:projectId/recovery-plans
GET        /desktop/life/recovery-plans/:planId
POST       /desktop/life/recovery-plans/:planId/propose
GET/PATCH  /desktop/life/sources
```

Exact route composition may use collection and item forms consistently with
the existing server, but all public contracts are versioned and schema tested.
Authentication supplies owner/device identity. Clients cannot submit owner
IDs, action risk, trusted provenance, source cursor, credential reference, or
frozen action arguments.

Desktop preload exposes one method per closed operation. The renderer cannot
construct arbitrary URLs, bearer headers, filesystem paths, or Tool Gateway
actions. Proposal and recovery responses contain safe display data and action
names only; frozen arguments remain server-side. Telegram callbacks use opaque
bounded identifiers and revalidate owner, origin, revision, and proposal state
on every interaction.

## Desktop Interface

The existing `renderer/life-os/` becomes a richer Mission Control while keeping
the current Jarvis visual language and Quantum Core. It is not replaced by a
separate dashboard framework.

Views and panels are:

- Mission: current mission, reason breakdown, pin/replace/hide, next step;
- Timeline: meaningful events, confidence/provenance, filters and corrections;
- Project context: commitments, decisions, documents, people, workflows,
  devices, and continuation point;
- People: owner-scoped people, relationships, project links, and explicit
  family sharing controls;
- Mode: current mode, manual switching, expiry, and visible effects;
- Recovery plan: facts, unknowns, ordered steps, risk, confirmation state, and
  per-step verified result;
- Proposal detail: evidence, explanation, confidence, cooldown/expiry, risk,
  origin, and allowed action;
- Preferences: explicit and derived preferences with explanations, edit,
  reset, and delete;
- Privacy and sources: enabled adapters, selected scope, last sync, health,
  permissions, and disconnect controls.

All views define loading, empty, stale, offline, error, conflict, and partial
result states. Offline cached content is visibly dated and cannot confirm a
changing proposal. Optimistic writes reconcile revisions; conflicts preserve
the user's unsent intent and offer refresh.

The interface works at 1440, 390, and 320 CSS pixels without horizontal
content loss. Every action is reachable by keyboard, has an accessible name,
visible focus, logical tab order, status announcement where appropriate, and
WCAG AA contrast. Animations respect reduced motion. Charts are not used where
textual factor reasons are clearer. Significant UI implementation must apply
the available design skills before editing and must preserve functionality over
decoration.

## Security and Privacy Model

The following are release-blocking invariants:

- All reads, writes, rankings, joins, cursor claims, reminders, people,
  preferences, modes, plans, and proposals are owner-scoped before filtering or
  model use.
- Family access requires an explicit resource grant and never becomes shared
  conversation history, private memory, or device authority.
- Raw Telegram voice, audio, images, Vision frames, OCR bodies, document/email
  bodies, local paths, storage keys, tokens, credentials, source cursors, and
  raw provider output never enter Event Spine or user-content logs.
- Source content and model output remain untrusted. Prompt injection cannot
  create trusted events, modes, preferences, shares, reminders, or actions.
- Identity, trust, privacy class, risk class, and allowed action derive from
  authenticated code paths and closed registries, never model output.
- Changing actions require confirmation bound to the proposal's originating
  client. Cross-channel, cross-conversation, cross-device, expired, stale,
  replayed, or cross-owner confirmations fail closed.
- Unknown execution or notification outcome is reconciled under the same
  identifier and is never automatically repeated under a new one.
- Renderers never receive frozen action arguments, owner IDs, secret refs,
  provider cursors, or local paths.
- API, IPC, adapter payloads, event data, and prompt sections have strict
  schemas and byte/count/time limits.
- PostgreSQL, adapter workers, Desktop local APIs, Docker, and Host Agent remain
  private; this project adds no public database or control endpoint.
- Disabling Life OS, enrichment, a source, or proactivity preserves ordinary
  chat, commands, and all existing safety checks.

A dedicated security review covers the implementation diff before completion,
including SQL ownership, IDOR, prompt injection, callback forgery, secret
handling, SSRF in provider transports, replay, race/claim handling, local-path
exfiltration, action policy, and log content. Provider transports are not added
until their own threat model and credential storage are approved.

## Failure, Degradation, and Reconciliation

- Context timeout or stale projections: answer normally without Life context;
  telemetry records a bounded status code.
- Model enrichment failure: deterministic parsing, linking, priority, and
  policy continue.
- Event persistence failure: the underlying accepted chat/action is not falsely
  reported failed; enrichment is omitted and the failure is sanitized.
- Projection outage: Mission Control reports unavailable/stale; normal chat and
  declared commands continue.
- Reminder transport failure: bounded retry uses the same idempotency key;
  ambiguous delivery becomes outcome_unknown.
- Adapter rate limit/outage: cursor is not advanced past uncommitted items;
  source health becomes stale without inventing new events.
- Invalid provider item: quarantine is metadata-only with a failure code; raw
  content is not logged or persisted in Life tables.
- Missing Desktop: local-action proposal remains pending or expires and never
  claims success.
- Ambiguous local resource: preparation returns candidate choice instead of
  opening an arbitrary file or app.
- State conflict after plan preview: confirmation fails with conflict and
  requires a refreshed plan.
- Partial Tool Gateway result: completed steps remain verified, failed steps
  remain failed, and the plan reports partial rather than success.
- Disconnect after dispatch: existing unknown-outcome semantics apply; replay
  does not duplicate execution.
- Preference/mode deletion: defaults apply immediately and no hidden copy is
  used for future guidance.
- Family grant revocation: subsequent retrieval, ranking, notifications, and
  context composition exclude that content.

## Required End-to-End Scenario

The acceptance phrase is exactly:

> Завтра вечером продолжу проект Life OS

The scenario must exercise real domain boundaries:

1. Telegram text, Desktop text, or an accepted voice transcript records one
   owner-scoped normalized event. Voice contributes only its transcript.
2. Deterministic parsing resolves tomorrow from received time and owner
   timezone, represents evening as a configured range, and creates one
   commitment with evidence.
3. Existing aliases and link ranking associate the event and commitment with
   the Life OS project at an explicit confidence; ambiguity is visible.
4. Timeline and Mission Control show the commitment and explain why the project
   priority changed.
5. A subsequent ordinary question receives bounded relevant Life context, and
   the response is measurably different from the Life-OS-disabled fixture while
   preserving the ordinary answer.
6. A durable reminder becomes due at the configured preparation lead time.
7. Proactivity creates one evidence-backed proposal to prepare the Life OS
   workspace, with expiry, cooldown, origin identity, changing risk, and the
   declared `workspace.prepare` action.
8. Confirmation succeeds only from the originating Telegram conversation or
   Desktop device. Other origins are denied without information leakage.
9. The Action Orchestrator dispatches the frozen action to the paired Desktop.
   Tool Gateway resolves the cloud-safe project ID locally and performs only
   registered app/file/window steps.
10. A verified Tool Gateway result transitions workflow, proposal, recovery
    steps, and commitment according to the result; a claimed-but-unverified
    result cannot mark success.
11. Timeline records the terminal event, and Context Recovery reports the
    verified workspace result and continuation point.
12. Replaying the source update, reminder claim, proposal creation,
    confirmation, dispatch, or terminal result produces no duplicate event,
    proposal, notification, or local execution.
13. Separate fixtures cover failed, partial, and unknown Tool Gateway outcomes.

The automated form uses the real PostgreSQL repositories and authenticated API
boundaries plus a fake Desktop transport feeding the real Orchestrator and Tool
Gateway contract. A local manual Desktop run verifies actual app/file behavior
without exposing paths. Production Telegram, multi-device, deployment, and
external-provider acceptance remain separately authorized manual checks.

## Testing and Verification

### Unit and contract tests

- every new repository method proves owner predicates and cross-owner absence;
- migration applies to empty/current schemas and preserves Core v1 data;
- context ranking is bounded, deterministic, relevant, privacy-filtered, and
  resilient to stale/missing sources;
- trusted guidance cannot be influenced by event/document/provider text;
- persona guidance covers modes, failure tone, initiative, disablement, and
  uncertain wording;
- priority factors, pins, hides, fallbacks, confidence, and explanations are
  deterministic;
- RU/EN commitment dates, ranges, recurrence, people, corrections,
  cancellation, rescheduling, and verified completion are tested;
- reminders cover timezone/DST, recurrence, claims, replay, cooldown,
  delivery failure, and unknown outcome;
- every proactivity rule proves evidence, confidence, risk, expiry, suppression,
  cooldown, dedupe, and no direct changing execution;
- people, relationship, preference, mode, and family-grant lifecycle and
  isolation are tested;
- recovery plans cover stale revisions, ambiguity, partial result, failure,
  unknown outcome, and local-path exclusion;
- every source parser covers bounds, malformed and hostile content,
  deterministic normalization, replay, and sensitive-field exclusion.

### Security and boundary tests

- cross-owner IDs are indistinguishable from missing resources;
- family members see only explicitly granted resource summaries;
- prompt injection in messages, documents, emails, calendar descriptions,
  device names, and Vision summaries cannot alter trusted guidance or actions;
- API and IPC reject extra fields, owner IDs, forged origins, oversized values,
  invalid enums, and stale revisions;
- proposal confirmation rejects wrong owner/channel/conversation/device,
  expiry, duplicate use, and mutated action state;
- frozen arguments are absent from Desktop renderer payloads;
- events, logs, API responses, and prompt fixtures contain no prohibited raw
  body, path, secret, cursor, or storage key;
- unknown outcomes are not redispatched under a new identifier.

### Integration and regression tests

- real PostgreSQL integration covers the complete acceptance phrase and all
  projection/action transitions;
- authenticated API acceptance covers the new Life routes and origin binding;
- Desktop IPC tests prove the bounded bridge and renderer redaction;
- browser tests cover 1440, 390, and 320 pixels, keyboard use, focus, accessible
  names, reduced motion, overflow, and every loading/empty/stale/offline/error/
  conflict/partial state;
- Telegram and Desktop ordinary chat tests run with Life OS enabled, disabled,
  timed out, and projection-unavailable;
- full server tests and affected Desktop suites pass;
- Voice, Vision, Tool Gateway, remote protocol, Operations, Quantum Core,
  document, memory, VPN, device, and family regressions pass in proportion to
  affected interfaces;
- packaging inspection verifies resources and runtime policy after client
  changes, without building or installing an EXE unless separately requested.

Test reports distinguish: implemented in code, automatically verified, locally
verified, verified with real PostgreSQL, deployed, and requiring manual
acceptance. Unit tests alone never establish production readiness.

## Rollout and Feature Flags

Rollout is additive and reversible:

1. Apply migration with v2 behavior disabled.
2. Enable repository and projection writes for internal fixtures.
3. Enable Life context in observe/compare mode, then per-channel prompt use.
4. Enable modes, preferences, people, and priority UI.
5. Enable cloud reminders and safe proactivity under strict rate limits.
6. Enable changing proposals only through existing confirmation manifests.
7. Enable local workspace registration and recovery action for opted-in
   Desktop devices.
8. Enable fake/fixture source adapters; real provider transports remain off
   until separately configured and accepted.

Independent flags cover Life context, model enrichment, priority projection,
reminders, proactivity, changing proposals, recovery execution, family sharing,
and each source adapter. The safe disabled behavior is the current Core v1/chat
behavior, not an application startup failure.

This goal does not authorize production deployment, VPS mutation, external
account connection, or Desktop build/install. Those remain explicit follow-up
decisions after automated and local verification.

## Implementation Checkpoints

The work remains one goal with sequential integration gates:

1. **Context composer:** schemas, bounded ranker, prompt integration for
   Telegram/Desktop, non-interference and injection tests.
2. **Modes and preferences:** explicit policy, communication guidance,
   feedback aggregation, CRUD and disablement.
3. **People and family access:** person/relationship records, project links,
   explicit share grants and isolation.
4. **Priority and Mission Control:** factor engine, explanations, pin/hide,
   expanded projection and API.
5. **Reminders and proactivity:** durable scheduling, all rule classes, safe and
   changing proposals, origin/cooldown/dedupe tests.
6. **Recovery and local workspace:** durable plans, Desktop registry,
   `workspace.prepare`, Tool Gateway verification, partial/unknown handling.
7. **Source adapters and parsers:** common contract, registry, fake transport,
   fixtures, eight parser families, privacy tests.
8. **Integrated UI:** functional panels and responsive/accessibility/failure
   states using the existing design system.
9. **End-to-end and security:** real PostgreSQL phrase scenario, authenticated
   API, IPC/browser, security review, and adjacent regressions.
10. **Truthful documentation:** README, `docs/README.md`, AGENTS.md, and a dated
    verification record updated only to the level actually proven.

Each checkpoint starts with narrow tests and ends with adjacent regressions.
Completion is judged on the integrated loop, not the number of finished
modules. Independent tasks may run in parallel only when their files and
architecture boundaries do not overlap.

## Documentation Status Rules

Historical Core v1 specifications and plans remain unchanged. This document is
the approved v2 design record. During implementation its header receives a
status line rather than rewriting the original design. A separate dated update
records commands, environments, and manual checks.

README and authoritative status files may say only one of:

- implemented in code;
- verified automatically;
- verified locally;
- verified with real PostgreSQL;
- deployed;
- requires manual acceptance.

Missing credentials, provider transport, multi-device tests, production
Telegram tests, deployment, and installed-EXE tests are named explicitly and
never represented as successful.

## Definition of Done

Life OS v2 is complete only when all of the following are true:

- ordinary Telegram and Desktop replies use bounded, relevant, owner-scoped
  Life context while preserving normal answers and existing prompt policy;
- Timeline, projects, people, relationships, commitments, modes, preferences,
  reminders, proposals, and verified workflow results operate as one model;
- Mission Control selects an explainable mission and supports pin, replace,
  temporary hide, stale state, and fallback;
- Context Recovery prepares a visible plan and executes eligible steps only
  through origin-bound proposal confirmation, Orchestrator, and Tool Gateway;
- proactivity creates useful safe and changing proposals, with evidence,
  confidence, risk, expiry, cooldown, deduplication, suppression, and no direct
  changing execution;
- the required Russian phrase completes the real PostgreSQL-backed cycle from
  normalized event through contextual response, reminder, proposal,
  confirmation, verified action, Timeline, and continuation recovery;
- replay at every source, worker, confirmation, dispatch, and result boundary
  does not duplicate delivery or execution;
- all initial connector families use the same safe adapter contract and have
  deterministic parsers, fake transports, fixtures, and privacy tests;
- owner isolation, explicit family grants, prompt separation, prohibited-data
  exclusions, origin confirmation, and unknown-outcome rules hold in tests and
  security review;
- ordinary chat, memory, documents, Voice, ASR, Vision, local actions, remote
  commands, confirmations, VPN, Operations, devices, Quantum Core, family
  restrictions, and all required disabled/failure modes remain functional;
- required unit, integration, authenticated API, IPC, browser, accessibility,
  security, regression, and packaging inspection checks pass;
- documentation reports only verified states and explicitly lists external or
  manual acceptance still outstanding;
- only intended files are committed, no production deployment or external
  account change occurs without separate permission, and no new production
  dependency is introduced without approval.
