# Jarvis Life OS v2 Implementation Plan

**Date:** 2026-09-14

**Design:** `docs/superpowers/specs/2026-09-14-jarvis-life-os-v2-design.md`

**Status:** Ready for implementation

> Status update, 2026-09-15: all code checkpoints and available local checks
> are complete; checkpoint 14 is recorded in
> `docs/updates/2026-09-15-jarvis-life-os-v2.md`. After separate explicit owner
> requests, the Desktop package was built, inspected, installed, and
> launch-smoked, then server v2 and migrations 016–018 were deployed. Isolated
> complete real-PostgreSQL phrase/workflow acceptance through Action Orchestrator
> and the real Tool Gateway contract, plus authenticated read-only Desktop API
> acceptance, passed. Live-provider, Telegram, multi-device, and interactive
> changing-action acceptance remain explicitly outstanding.

## Objective

Extend the existing Life OS Core v1 into Life OS v2 without replacing Jarvis or
weakening any current trust boundary. Deliver the complete owner-scoped loop:

```text
signal -> event -> meaning/linking -> context -> ordinary Jarvis reply
       -> explainable proposal -> origin confirmation -> declared action
       -> verified result -> Timeline/commitment/recovery/future behavior
```

The mandatory integrated fixture begins with:

> Завтра вечером продолжу проект Life OS

It ends only after a due reminder creates one changing workspace-preparation
proposal, the origin client confirms it, the Action Orchestrator and Desktop
Tool Gateway return a verified result, and replay does not duplicate any event,
notification, proposal, dispatch, or execution.

## Constraints

- Keep Node.js CommonJS and the existing cloud-brain/local-hands split.
- Extend Core v1 modules through focused contracts; do not rewrite the domain.
- Do not grow `server/src/runtime.js`, `main.js`, `renderer/renderer.js`, or
  `lifeProjectionRepository.js` with new domain logic.
- Add no production dependency without explicit user approval.
- Keep owner identity, source trust, privacy, risk, and origin in trusted code.
- Never place raw audio, images, frames, OCR/document/email bodies, local paths,
  storage keys, credentials, tokens, source cursors, or raw provider output in
  Event Spine, prompt logs, telemetry, public APIs, or renderer state.
- Changing actions require existing origin-bound confirmation and execute only
  through declared Orchestrator/Tool Gateway contracts.
- An unknown action or notification outcome is reconciled under its original
  idempotency key and never repeated under a new identifier.
- Keep normal Telegram/Desktop chat and all current Jarvis domains working when
  Life OS, enrichment, projections, reminders, proactivity, or adapters fail or
  are disabled.
- Do not connect real external accounts, deploy, alter the VPS, or build/install
  Desktop EXE without a separate explicit request.
- Preserve unrelated user changes. Before every commit inspect the full diff
  and stage only files belonging to the checkpoint.

## Verification Discipline

For each checkpoint:

1. Add failing tests for the contract or bug first.
2. Run only the new/focused tests and confirm the intended failure.
3. Implement the smallest complete domain slice.
4. Re-run focused tests, then adjacent regression suites.
5. Run `git diff --check`, inspect for secrets/generated state, and commit only
   that checkpoint.
6. Record evidence but do not update product status documentation until the
   integrated capability is actually verified.

The implementation may use fake clocks/transports and fixture repositories for
unit tests. The final acceptance must also use real PostgreSQL repositories,
authenticated API routes, the real Orchestrator contract, and the Desktop Tool
Gateway contract.

## Checkpoint 0: Reconfirm Baseline and Freeze Contracts

### Inspect

- `server/src/db/migrations/013_life_os_core.sql`
- `server/src/life/*.js`
- `server/src/prompts/promptBuilder.js`
- `server/src/assistant/assistantService.js`
- `server/src/desktop/desktopMessageService.js`
- `server/src/telegram/messageService.js`
- `server/src/orchestrator/actionManifest.js`
- `server/src/orchestrator/actionOrchestrator.js`
- `server/src/runtime.js`
- `agents/toolSchemas.js`
- `agents/toolPolicy.js`
- `agents/toolGateway.js`
- `main.js`, `cloud/cloudPreload.js`, `cloud/desktopCloudClient.js`
- `renderer/life-os/*`

### Baseline commands

```powershell
cd server
node --test test/lifeSchemas.test.js test/lifeRepositories.test.js test/lifeEventGateway.test.js test/lifeLinker.test.js test/commitmentDetector.test.js test/lifeProjection.test.js test/lifeProactivityWorker.test.js test/lifeProposalService.test.js test/lifeRoutes.test.js test/promptPipeline.test.js test/desktopMessageService.test.js test/telegramMessageService.test.js test/actionManifest.test.js test/actionOrchestrator.test.js
cd ..
node scripts/testLifeOsIpc.js
node scripts/testLifeOsRenderer.js
node scripts/testToolGateway.js
node scripts/testRemoteProtocol.js
```

Use the bundled browser runtime for `node scripts/testLifeOsBrowser.cjs` when
the repository Node cannot resolve Playwright.

### Output

Create no code in this checkpoint. Record current suite totals and any existing
failures in working notes. A pre-existing failure must be diagnosed and kept
separate from v2 changes.

### Exit criterion

Core v1 and adjacent action/prompt boundaries are understood from current code,
the worktree is clean, and baseline results are reproducible.

## Checkpoint 1: Migration, Schemas, and Focused Repositories

### Files

- Add `server/src/db/migrations/016_life_os_v2.sql`.
- Modify `server/src/life/lifeSchemas.js` for shared closed enums and public
  input schemas only.
- Add `server/src/life/people/peopleSchemas.js`.
- Add `server/src/life/people/peopleRepository.js`.
- Add `server/src/life/people/familyAccessPolicy.js`.
- Add `server/src/life/modes/lifeModeSchemas.js`.
- Add `server/src/life/modes/lifeModeRepository.js`.
- Add `server/src/life/preferences/lifePreferenceSchemas.js`.
- Add `server/src/life/preferences/lifePreferenceRepository.js`.
- Add `server/src/life/reminders/reminderSchemas.js`.
- Add `server/src/life/reminders/reminderRepository.js`.
- Add `server/src/life/recovery/recoverySchemas.js`.
- Add `server/src/life/recovery/recoveryPlanRepository.js`.
- Add `server/src/life/priority/priorityRepository.js`.
- Add `server/src/life/sources/sourceSchemas.js`.
- Add `server/src/life/sources/sourceConnectionRepository.js`.
- Extend `server/test/migrations.test.js`.
- Add focused repository/schema tests matching each new directory.

### Migration content

Add owner-scoped tables and indexes for:

- `life_people`;
- `life_person_relationships`;
- `life_person_project_links`;
- `life_family_access_grants`;
- `life_modes`;
- `life_preferences`;
- `life_reminders`;
- `life_recovery_plans`;
- `life_recovery_steps`;
- `life_source_connections`;
- `life_source_cursors`;
- `life_project_priority_state`.

Extend Core v1 safely:

- allow `person` in event-link target checks;
- add `kind` and bounded recurrence metadata to `life_commitments`;
- add proposal source rule/version, confidence, person link, optional reminder
  link, and any origin metadata absent from Core v1;
- add only event types required by v2 lifecycle transitions;
- preserve every existing row and Core v1 query.

Use composite owner/resource foreign keys or transaction-level `EXISTS`
checks where PostgreSQL cannot express the cross-owner invariant directly.
Create unique idempotency/cooldown indexes for active grants, reminder
occurrences, recovery plans, source cursors, and proposal rule claims.

### Repository rules

- Every method accepts `userId` explicitly and binds it in the first database
  query touching a resource.
- Cross-owner and missing IDs return the same domain result.
- Dynamic SQL identifiers come only from closed code-owned maps.
- Writes use optimistic revisions where users can edit state.
- Claims use one atomic `UPDATE ... FOR UPDATE SKIP LOCKED` or equivalent
  transaction pattern and retain the same operation identifier across retry.
- Public return mappers exclude owner IDs, source cursors, secret references,
  frozen arguments, and local resource data.

### Tests

- Empty-schema migration and sequential upgrade from migration 015.
- Core v1 fixture rows survive migration unchanged.
- Database constraints reject cross-owner links and invalid enum/state data.
- Each repository tests owner A success, owner B absence, stale revision,
  replay/idempotency, and bounded list/query behavior.
- Schema tests reject extra fields, oversized text/JSON, forbidden keys,
  malformed recurrence/timezone, and user-supplied trust/risk/owner fields.

### Exit criterion

All v2 durable records have isolated repositories and schemas, migration tests
pass, and no new runtime behavior is enabled.

## Checkpoint 2: Life Context Composer and Ordinary Reply Integration

### Files

- Add `server/src/life/context/lifeContextSchemas.js`.
- Add `server/src/life/context/lifeContextRanker.js`.
- Add `server/src/life/context/lifeContextComposer.js`.
- Add `server/src/life/context/communicationGuidance.js`.
- Add `server/test/lifeContextRanker.test.js`.
- Add `server/test/lifeContextComposer.test.js`.
- Add `server/test/lifeCommunicationGuidance.test.js`.
- Modify `server/src/prompts/promptBuilder.js`.
- Modify `server/src/assistant/assistantService.js`.
- Modify `server/src/desktop/desktopMessageService.js` only to pass authenticated
  request metadata into the common assistant path.
- Modify `server/src/telegram/messageService.js` only to pass authenticated
  request metadata into the same common assistant path.
- Extend `server/test/promptPipeline.test.js`.
- Extend `server/test/desktopMessageService.test.js`.
- Extend `server/test/telegramMessageService.test.js`.
- Modify `server/src/config.js` and `server/test/config.test.js` for bounded
  feature flags/time budgets.
- Modify `server/src/runtime.js` only for construction/injection.

### Ranker contract

Build a deterministic ranker that accepts pre-owner-filtered candidates and
scores direct request match, current/pinned project, recency decay, due urgency,
link origin, confidence, mode compatibility, and explicit area preference.
Apply per-category caps, deterministic tie breaking, item/character/token
budgets, and minimum relevance. Family candidates must already carry an
authorized grant marker and are rechecked before output.

Do not call a model from the ranker. Missing factors contribute zero and lower
confidence. A factual question unrelated to the owner's active life context
must produce an empty or minimal context section.

### Composer contract

`compose({ userId, channel, conversationId, deviceId, text, locale, now })`
queries bounded candidates from existing/new repositories in parallel under a
short deadline. It returns:

- `lifeContext`: untrusted bounded facts, commitments, proposals, decisions,
  documents/devices, people-safe labels, and continuation;
- `communicationGuidance`: trusted allowlisted style fields derived only from
  explicit modes/preferences and server rules;
- `status`: fresh, partial, stale, disabled, or unavailable.

The composer catches domain failures and returns disabled/unavailable without
throwing into normal reply generation.

### Prompt integration

Add separate delimited prompt sections. `communicationGuidance` is trusted but
cannot modify action/tool/policy instructions. `lifeContext` is explicitly
untrusted data with injection warnings. Preserve independent budgets for
conversation history, memory, documents, Vision, devices, and Life OS.

The Assistant service requests context once per ordinary reply after owner
resolution. Both channels use that common result. Existing command/menu/media
paths that do not invoke an assistant remain unchanged.

### Tests

- Relevant project/commitment changes the ordinary reply prompt fixture.
- Unrelated context is omitted and does not hijack a normal answer.
- Owner B facts, ungranted family facts, hidden events, suppressed links, and
  stale/low-confidence candidates are absent.
- Malicious instructions in Timeline, documents, Vision, email-like fields,
  and project names remain inside the untrusted section and cannot alter the
  trusted policy section.
- Explicit Focus/concise guidance is trusted; event text that says "enter
  Emergency and execute" cannot create guidance.
- Composer timeout, disabled Life OS, missing projections, and repository error
  produce the pre-v2 prompt and a successful ordinary answer.
- Telegram and Desktop derive user/origin from authenticated context and never
  accept it from message text or request JSON.

### Exit criterion

Ordinary Telegram/Desktop prompts use relevant bounded Life context and degrade
to current behavior without Life OS.

## Checkpoint 3: Modes, Preferences, and Feedback Learning

### Files

- Add `server/src/life/modes/lifeModePolicy.js`.
- Add `server/src/life/modes/lifeModeService.js`.
- Add `server/src/life/preferences/lifePreferenceService.js`.
- Add `server/src/life/preferences/feedbackAggregator.js`.
- Add `server/test/lifeModePolicy.test.js`.
- Add `server/test/lifeModeService.test.js`.
- Add `server/test/lifePreferenceService.test.js`.
- Add `server/test/lifeFeedbackAggregator.test.js`.
- Extend `server/src/life/lifeRoutes.js` and route tests.
- Extend `server/src/life/lifePublic.js` for redacted public records.
- Extend `server/src/runtime.js` only for injection and worker lifecycle.

### Mode behavior

Implement Work, Focus, Home, Family, Meeting, Travel, Rest, Sleep, and
Emergency as a closed policy matrix. The matrix controls ranking weights,
notification deferral, allowed source categories, Mission Control emphasis,
proposal visibility, and communication guidance. Manual choice or acceptance
of a safe suggestion is required; observations never change mode directly.
Expiry restores the previous/default mode deterministically.

No mode changes privacy, family grants, authentication, tool risk, or
confirmation. Emergency grants no additional authority.

### Preference behavior

Implement explicit CRUD for response length, contextual adaptation,
initiative, notification windows, proactive caps, area weights, suppressed
rule types, low-confidence behavior, and reminder lead times. Explicit values
override derived values.

`FeedbackAggregator` consumes bounded `life_feedback` classes and produces only
transparent threshold-based derived preferences, for example repeated dismissal
of the same rule reduces that rule's frequency. It stores source counts and an
explanation. It never sends private feedback to model training or derives
personality/mental-health traits.

### Tests

- Manual mode selection, suggestion acceptance, expiry, revision conflict, and
  owner isolation.
- Every mode's quiet/priority/source/style effects and invariant permissions.
- Explicit preference precedence, derived threshold, explanation, reset,
  deletion, and no hidden reuse after deletion.
- Feedback replay does not increment counts twice.
- Context guidance updates immediately without rewriting canonical persona.

### Exit criterion

Modes and inspectable preferences safely influence ranker/guidance while all
authority remains unchanged.

## Checkpoint 4: People, Relationships, and Explicit Family Access

### Files

- Add `server/src/life/people/peopleService.js`.
- Add `server/src/life/people/personLinker.js`.
- Add `server/src/life/people/familyAccessService.js`.
- Add `server/test/lifePeopleService.test.js`.
- Add `server/test/lifePersonLinker.test.js`.
- Add `server/test/lifeFamilyAccess.test.js`.
- Modify `server/src/life/lifeLinker.js` only to delegate person candidates.
- Extend `server/src/life/lifeRoutes.js` and tests.
- Extend `server/src/life/lifePublic.js`.
- Extend `server/src/life/context/lifeContextComposer.js` and tests.

### Person behavior

Support owner-created display names/aliases, coarse relationship types,
project roles, meetings, commitments, and event links. Deterministic explicit
name patterns lead; optional model ranking may select only from same-owner
candidates and cannot set trust or create a grant. Ambiguous names remain
unresolved and correctable.

### Family behavior

Implement resource-scoped grants to known family member user IDs. Closed scopes
are area, project, event category, commitment, or family calendar source;
closed permissions are view-summary, contribute-event, and acknowledge.
Grant creation proves existing family membership and owner resource ownership.

Shared content is queried from the grantor scope and returned as a safe summary.
It is not copied into the member's private Timeline, memory, prompt search, or
device authority. Revocation excludes the resource before all future retrieval,
ranking, notification, and context composition.

### Tests

- Owner isolation for people, aliases, links, projects, and corrections.
- No contact/sensitive fields accepted by schemas or emitted publicly.
- Same-name ambiguity and explicit user correction.
- Family member without grant sees not-found-equivalent responses.
- Each grant scope/permission and expiry/revocation path.
- A person link alone never grants access.
- Shared project summary cannot expose documents, device authority, local
  paths, private conversation, or unrelated project events.

### Exit criterion

People participate in commitments/projects/context, and family access exists
only through explicit revocable grants.

## Checkpoint 5: Explainable Priority Engine and Mission Control API

### Files

- Add `server/src/life/priority/priorityFactors.js`.
- Add `server/src/life/priority/priorityEngine.js`.
- Add `server/test/lifePriorityFactors.test.js`.
- Add `server/test/lifePriorityEngine.test.js`.
- Modify `server/src/life/missionControlService.js` to consume the engine.
- Extend `server/test/lifeProjection.test.js` or add
  `server/test/lifeMissionControl.test.js`.
- Extend `server/src/life/lifeRoutes.js`, `lifePublic.js`, and route tests.
- Extend `server/src/life/context/lifeContextComposer.js` to use the selected
  mission.

### Factors

Implement versioned, capped factors for explicit pin, user/area weight,
deadline proximity, open/overdue commitments, recent activity, stalled state,
failed/unknown outcomes, available calendar window, current mode, resource
availability, and evidence confidence. Persist score, confidence, version, and
bounded reason codes. Do not use model scoring.

Pin overrides normal rank only for an eligible project. Temporary hide excludes
until expiry. Replace writes an explicit pin/selection. Fallback order is valid
pin, most-recent eligible activity, then no mission; never first database row.

### Mission Control output

Return selected mission/reasons, ranked projects/areas, commitments/reminders,
safe/changing proposals, meaningful events/decisions, failures/unknowns,
relevant devices, suggested next step, recovery availability, current mode,
source health, confidence, and `asOf`/stale status.

### Tests

- Exact score and reason fixtures for all factors and caps.
- Pin/hide/replace/expiry/revision conflict and owner isolation.
- Missing calendar/device/preference data lowers confidence without guessing.
- Fallback behavior and no-project empty state.
- Mission explanation does not expose internal IDs, owner IDs, arguments, paths,
  or private family data.

### Exit criterion

Mission Control selects one explainable mission and supports explicit user
control with deterministic fallback.

## Checkpoint 6: Commitment Detector v2

### Files

- Refactor `server/src/life/commitmentDetector.js` into a thin coordinator.
- Add `server/src/life/commitments/textNormalizer.js`.
- Add `server/src/life/commitments/temporalParser.js`.
- Add `server/src/life/commitments/recurrenceParser.js`.
- Add `server/src/life/commitments/commitmentIntentParser.js`.
- Add `server/src/life/commitments/commitmentLifecycleService.js`.
- Add `server/src/life/commitments/commitmentEnrichment.js`.
- Extend `server/test/commitmentDetector.test.js`.
- Add focused tests for temporal, recurrence, lifecycle, and enrichment modules.
- Extend `server/src/life/lifeEnrichmentService.js` and its adjacent tests.
- Extend commitment repository methods in a focused
  `server/src/life/commitments/commitmentRepository.js`; stop adding new
  lifecycle methods to `lifeProjectionRepository.js`.

### Deterministic parsing

Support Russian and English absolute date/time, weekdays, relative dates,
day-parts, ranges, no-date promises, promises involving people, recurrence,
cancellation, rescheduling, correction, and completion. Resolve from trusted
receive time, owner timezone, and locale. Represent ambiguous evening as a
configured range; do not invent an exact minute.

Lifecycle matching uses explicit IDs/links, then bounded recent candidates.
Verified action result may complete only its linked commitment. Model
enrichment receives deterministic candidates, returns a strict schema, and can
only suggest classification/link; invalid/missing output is discarded.

### Required phrase test

At a fixed Moscow receive time, parse "Завтра вечером продолжу проект Life OS"
into one open commitment linked to the Life OS project, with a next-day evening
range, source event, evidence, and stable deduplication key.

### Tests

- RU/EN table-driven temporal and lifecycle examples.
- Timezone/DST and week-boundary cases.
- Ambiguity produces range/clarification, not fabricated precision.
- Replayed event creates one commitment.
- Cross-owner candidate cannot be matched.
- Model output cannot inject ID, trust, risk, action, or unsupported recurrence.
- User correction appends an event and updates projection without mutating
  source history.

### Exit criterion

The required phrase and complete commitment lifecycle are deterministic,
bounded, correctable, and owner-scoped.

## Checkpoint 7: Durable Reminders

### Files

- Add `server/src/life/reminders/reminderService.js`.
- Add `server/src/life/reminders/reminderWorker.js`.
- Add `server/src/life/reminders/reminderDeliveryRouter.js`.
- Add `server/test/lifeReminderService.test.js`.
- Add `server/test/lifeReminderWorker.test.js`.
- Add `server/test/lifeReminderDeliveryRouter.test.js`.
- Extend Telegram and Desktop outbound transport tests.
- Extend `server/src/life/lifeRoutes.js`, public mappers, and route tests.
- Modify `server/src/config.js` and runtime lifecycle with bounded values.

### Behavior

Create, reschedule, cancel, acknowledge, and deliver owner-scoped reminders.
Destinations derive from authenticated origin/paired sessions, never model
text. Worker claims due reminders atomically, uses deterministic occurrence and
transport keys, observes quiet/mode/preference policy, and records delivery
lifecycle events.

Recurring schedule types are daily, selected weekdays, weekly, monthly-date,
and bounded interval. Commit terminal state and next occurrence atomically.
Ambiguous transport outcome becomes outcome_unknown and is reconciled under the
same key.

### Tests

- One-time/recurring timing, timezone, DST, quiet-hour deferral, rate limits,
  cancellation, acknowledgement, and expiry.
- Worker concurrency, expired claim, replay, transient failure, permanent
  failure, and unknown transport outcome.
- Wrong user/conversation/device cannot read, edit, or receive the reminder.
- Reminder content cannot contain action arguments, secrets, paths, or arbitrary
  destinations.
- Life OS disabled leaves ordinary outbound transport untouched.

### Exit criterion

The cloud can durably deliver one reminder occurrence without duplication and
without performing a local mutation.

## Checkpoint 8: Proactivity Engine and Real Proposals

### Files

- Add `server/src/life/proactivity/proactivityEngine.js`.
- Add `server/src/life/proactivity/proactivityRule.js`.
- Add one focused module under `server/src/life/proactivity/rules/` for each
  required rule class.
- Convert `server/src/life/proactivityWorker.js` into a scheduler/claim wrapper
  delegating to the engine.
- Extend `server/src/life/proposalService.js` only for validated v2 lifecycle
  fields and cloud-action dispatch.
- Add `server/test/lifeProactivityEngine.test.js`.
- Add table-driven tests for every rule module.
- Extend `server/test/lifeProactivityWorker.test.js`.
- Extend `server/test/lifeProposalService.test.js`.
- Extend `server/src/orchestrator/actionManifest.js` and manifest tests with
  only declared v2 actions.

### Rules

Implement approaching/overdue commitment, stalled project, failed/unknown
action, new active-project document, lost context, schedule conflict, suitable
free window, device-state change, repeatedly forgotten task, meeting
preparation, granted family event, and smart-home attention signal.

Each rule declares input types, evidence requirements, lookback, confidence,
cooldown, expiry, maximum open proposals, risk, and allowed action names.
Persist source rule/version, confidence, evidence, origin, project/area/person,
and cooldown claim.

### Actions

Declare and validate:

- cloud-domain `reminder.create`, `reminder.reschedule`,
  `life.commitment.reschedule`, and `life.task.create`;
- safe `project.show_documents`;
- existing-or-declared `device.status.request` and `workflow.continue`;
- Desktop `workspace.prepare`.

Changing proposals never dispatch from worker evaluation. Confirmation must
match owner, origin channel, conversation, device when required, proposal
revision, expiry, and frozen manifest. Cloud-domain actions use a declared
server executor behind the Orchestrator registry; Desktop actions use the
existing remote executor and Tool Gateway.

### Tests

- Every rule's positive, negative, low-confidence, stale, suppressed, quiet,
  cooldown, expiry, max-open, replay, and cross-owner case.
- Safe cards never claim mutation.
- Changing proposals contain a declared action but renderer payload omits
  frozen arguments.
- Worker evaluation cannot invoke Orchestrator or an executor.
- Wrong-origin confirmation fails; correct origin dispatches once.
- Unknown workflow outcome remains unknown and is not redispatched.

### Exit criterion

All required rule families create bounded explainable proposals, including at
least one real changing proposal that can execute only after valid origin
confirmation.

## Checkpoint 9: Recovery Plans and Desktop Workspace Preparation

### Server files

- Add `server/src/life/recovery/recoveryPlanService.js`.
- Add `server/src/life/recovery/recoveryPlanPublic.js` if the common public
  mapper would become too broad.
- Extend `server/src/life/contextRecoveryService.js` to delegate plan creation
  while preserving its Core v1 summary contract.
- Add `server/test/lifeRecoveryPlanService.test.js`.
- Extend `server/test/contextRecovery.test.js`.
- Extend routes, runtime injection, proposal service, action manifest, and
  orchestrator tests.

### Desktop files

- Add `tools/workspaceRegistry.js`.
- Add `tools/workspacePreparationService.js`.
- Add `agents/workspaceToolAdapter.js` only if needed to keep Tool Gateway
  dispatch focused.
- Modify `agents/toolSchemas.js`, `agents/toolPolicy.js`, and
  `agents/toolGateway.js` for the closed `workspace.prepare` contract.
- Modify `runtimeDataPath.js` only to declare the local registry filename under
  existing packaged/dev policy.
- Add `scripts/testWorkspaceRegistry.js`.
- Add `scripts/testWorkspacePreparationService.js`.
- Extend `scripts/testToolGateway.js`, `scripts/testToolPolicyMapping.js`, and
  `scripts/testRuntimeDataPath.js`.
- Extend `agents/remoteProtocol.js` tests only if the declared action schema
  requires a protocol version change.

### Preparation

Server prepares a read-only plan from verified context, open questions,
workflow state, linked document metadata, device capabilities, and continuation
point. Steps carry safe labels, closed types, risk, dependencies, and opaque
resource IDs. Plan is revision-bound and short-lived.

Desktop registry maps `workspaceProjectId` to local app aliases/search hints
and user-confirmed candidates. Local paths remain only in writable Desktop
state. `workspace.prepare` receives the cloud-safe project ID and requested
capability classes, resolves apps/files locally through existing resolvers and
short-lived opaque candidates, and reports sanitized per-step results.

### Execution

Plan preview and execution are separate. Changing steps become one frozen
proposal and use origin confirmation, Orchestrator, remote protocol, Tool
Gateway, and per-step verified results. Ambiguity returns candidate selection;
partial success remains partial; disconnect becomes outcome_unknown. A replayed
confirmation or result cannot re-execute steps.

### Tests

- Plan facts/inferences/unknowns/next step and strict output budgets.
- Stale context revision, expired plan, missing Desktop, ambiguous candidate,
  partial/failure/unknown results, and owner/origin isolation.
- Cloud/database/API/prompt/result fixtures contain no local path, executable
  command, window handle, or frozen arguments.
- Registry is local, bounded, schema-validated, packaged-path safe, and handles
  write `EPERM` without crashing.
- Tool Gateway executes only declared sub-operations and never shell/PowerShell.
- Verified result alone marks step/proposal/commitment/plan complete.

### Exit criterion

Jarvis can preview and execute one recovery plan through the real declared
Desktop action path without exposing local paths or claiming unverified success.

## Checkpoint 10: Provider-Neutral Source Adapter Framework

### Files

- Add `server/src/life/sources/lifeSourceAdapter.js`.
- Add `server/src/life/sources/sourceRegistry.js`.
- Add `server/src/life/sources/sourceSyncService.js`.
- Add `server/src/life/sources/fakeSourceTransport.js`.
- Add parser modules:
  - `calendarParser.js`
  - `emailParser.js`
  - `taskParser.js`
  - `receiptParser.js`
  - `deliveryParser.js`
  - `travelParser.js`
  - `subscriptionParser.js`
  - `smartHomeParser.js`
- Add redacted JSON fixtures under `server/test/fixtures/life-sources/`.
- Add contract and parser tests under `server/test/`.
- Extend source routes, config, runtime, and public source-health projection.

### Contract

Validate config, discover safe scopes, fetch a bounded page, parse one
request-temporary item, normalize allowlisted metadata, submit through Event
Gateway, and commit cursor only after accepted items. The sync service owns
claims, time/byte/page limits, retries, cursor storage, health, dedupe, and
sanitized errors. Adapters never write Life tables directly.

### Parser output

- Calendar: title, bounded times/timezone/status, unresolved attendee labels,
  recurrence summary, conflict key.
- Email: message/thread references, bounded subject/sender label/time,
  attachment metadata, candidate intent; no body storage.
- Tasks: title/state/due range/recurrence/list label/reference.
- Receipts/invoices: merchant/date/currency/total/due/category; no account/card.
- Deliveries: carrier, tracking hash, state/window/exception.
- Travel: type/provider/time/timezone/safe route or venue/state; no ticket body.
- Subscriptions: merchant/amount/currency/cadence/next date/state.
- Smart home: declared device/class/state transition/severity/home area/time; no
  raw sensor stream.

### Tests

- Shared adapter conformance for all eight parsers.
- Oversized, malformed, hostile instruction, missing-field, replay, timezone,
  pagination, rate-limit, cursor-crash, and cross-owner fixtures.
- Forbidden-field scan of normalized events, logs, prompt candidates, and
  public API responses.
- Cursor does not advance over an uncommitted item; stale claim reconciles.
- No credential path is implemented or claimed live. Fake source behavior is
  clearly labelled fixture-only.

### Exit criterion

Eight useful parser families feed safe normalized fixture events through one
contract, with no production provider claim or new dependency.

## Checkpoint 11: Complete Mission Control UI and Desktop Contracts

Before editing UI, read and apply the available `frontend-design` and
`ui-ux-pro-max` skills, plus `webapp-testing` for browser verification. Preserve
the current Jarvis/Quantum Core design language; do not perform an unrelated
decorative redesign.

### Cloud/Desktop bridge files

- Extend `cloud/desktopCloudClient.js` and `cloud/desktopCloudClient.test.js`.
- Extend `cloud/cloudPreload.js` with one method per closed operation.
- Add a focused `cloud/lifeOsIpc.js` registration module and call it from
  `main.js`, moving current Life IPC registration there rather than adding more
  handlers inline.
- Extend `scripts/testLifeOsIpc.js`.

### Renderer files

- Split `renderer/life-os/life-os.js` into focused modules only if the existing
  browser build/loading approach supports plain scripts without a new bundler:
  state/client adapters, render primitives, mission, timeline/project, people,
  modes/preferences, recovery, proposal, and source/privacy panels.
- Extend `renderer/life-os/life-os.css` using existing tokens.
- Modify the existing Cloud Chat HTML only to add semantic containers/dialogs.
- Extend `scripts/testLifeOsRenderer.js` and `scripts/testLifeOsBrowser.cjs`.

### Views

- Explainable mission with pin/replace/hide.
- Ranked areas/projects, commitments/reminders, recent events, device state,
  failures/unknowns, next step, and stale timestamp.
- Living Timeline with provenance/confidence/corrections.
- Project context with people/documents/workflows/continuation.
- People/relationships and explicit family grants.
- Manual life mode and visible effects.
- Recovery plan preview, risk, confirmation, execution, partial/unknown result.
- Proposal evidence/explanation/confidence/risk/expiry/origin.
- Explicit/derived preferences with explanation, reset, delete.
- Privacy/source health/scope and fixture/live status.

### Required states and accessibility

Implement loading, empty, stale, offline, error, conflict, partial, and
populated states. Offline state cannot confirm changing actions. Preserve user
input on revision conflict and offer refresh. Test 1440, 390, and 320 CSS pixels,
keyboard-only operation, focus restoration/trap, accessible names, headings,
status announcements, contrast, overflow, and reduced motion.

### Exit criterion

Every v2 domain is usable through bounded Desktop APIs and the existing Life OS
surface at all target sizes without exposing trusted internals.

## Checkpoint 12: Integrated End-to-End Acceptance

### Files

- Extend `server/test/lifePostgresAcceptance.cjs` or add
  `server/test/lifeV2PostgresAcceptance.cjs` when isolation improves cleanup.
- Add `server/test/lifeV2EndToEnd.test.js` for fake-clock/transport orchestration.
- Add a Desktop contract acceptance script under `scripts/` that exercises the
  real Tool Gateway with a temporary, explicitly scoped fixture workspace.
- Extend authenticated route, prompt, Telegram, Desktop, remote protocol, and
  browser suites.

### Scenario

1. Create owner, second owner, family member, conversation, paired Desktop,
   Life OS project, and local fixture workspace.
2. Send the exact Russian phrase through authenticated message handling.
3. Verify one event, project link, commitment, due range, evidence, Timeline,
   and mission priority reason.
4. Ask an ordinary follow-up and verify Life context affects the response while
   the Life-disabled control keeps normal behavior.
5. Advance fake clock to preparation time; claim/deliver one reminder and
   create one changing `workspace.prepare` proposal.
6. Reject confirmation from wrong user/channel/conversation/device.
7. Confirm from the origin, dispatch once, and execute through Orchestrator,
   remote contract, and Tool Gateway fixture.
8. Feed the verified result back and verify proposal, workflow, commitment,
   recovery plan/steps, Timeline, and continuation point.
9. Replay source, worker claim, delivery, proposal, confirmation, dispatch, and
   result; assert all durable counts and local invocation count remain one.
10. Repeat terminal handling for failure, partial, and outcome_unknown; assert
    no success claim and no new dispatch ID.

### Security acceptance

Run a parallel cross-owner/family/prompt-injection matrix. Inspect database
rows, API output, prompt capture, renderer fixture, and logs for prohibited
fields. Confirm an explicit grant exposes only its safe summary and revocation
removes it immediately.

### Exit criterion

The complete v2 loop passes with real PostgreSQL and authenticated boundaries,
and all negative/replay/unknown cases are proven.

## Checkpoint 13: Full Regression, Packaging Inspection, and Security Review

### Server

```powershell
cd server
npm test
```

Run the explicit PostgreSQL acceptance command documented by the test after a
local disposable database is available. It must use a unique schema or bounded
fixtures and clean them safely.

### Desktop and cloud

```powershell
node scripts/testLifeOsIpc.js
node scripts/testLifeOsRenderer.js
node scripts/testLifeOsBrowser.cjs
node scripts/testToolGateway.js
node scripts/testToolPolicyMapping.js
node scripts/testRemoteProtocol.js
node scripts/testRuntimeDataPath.js
node scripts/testQuantumCore.js
node scripts/testVoiceServiceSttProvider.js
node scripts/testVisionTransport.js
node scripts/testVisionRuntime.js
node scripts/testVisionIpc.js
node scripts/testVisionMediaPermission.js
node scripts/testObjectReconciler.js
node scripts/testSceneState.js
node --test cloud/*.test.js voice/cloudVoiceService.test.js tts/windowsSapiService.test.js
```

Run affected Operations server/host/UI tests if runtime, health, telemetry, or
packaging contracts changed. Do not claim Voice/Vision hardware acceptance from
fixtures alone.

### Security review

Apply the available `security-review` skill to the complete diff. Review owner
scope, family grants, schemas, SQL, IDOR, CSRF/origin, prompt injection, callback
forgery, replay/races, SSRF-capable adapter seams, secret/cursor handling,
filesystem boundaries, action policy, unknown outcomes, and sanitized logs.
Fix findings and rerun affected tests.

### Packaging inspection

Inspect `package.json`, packaged resource rules, runtime data declarations, and
installed EXE freshness. Do not run `npm run dist:win` or install anything
without explicit authorization. Because v2 changes Desktop, the final report
must offer the build/install step if the installed EXE is stale.

### Exit criterion

All required automated suites are green, real PostgreSQL acceptance is green,
the security review has no unresolved high-risk finding, and packaging content
is inspected without unauthorized build/deployment.

## Checkpoint 14: Truthful Documentation and Final Evidence Matrix

### Files

- Update `README.md` with verified current capability and clearly labelled
  remaining roadmap/manual checks.
- Update `docs/README.md` as status authority.
- Update `AGENTS.md` for material runtime ownership, safety boundaries, and new
  verification commands.
- Add `docs/updates/2026-09-14-jarvis-life-os-v2.md` (use actual completion date
  if work crosses a date boundary).
- Add implementation status notes to the approved design and this plan without
  rewriting historical decisions.

### Evidence matrix

For every numbered objective requirement and Definition of Done item, record:

- implementation files;
- focused tests;
- integration/acceptance evidence;
- status: implemented, automatically verified, locally verified, real
  PostgreSQL verified, deployed, or manual acceptance required;
- any missing external credential/provider/hardware/multi-device/deployment
  check.

Do not call fixture adapters live, do not call unit-tested UI production-ready,
and do not imply deployment. Record exact test commands/totals and sanitized
failure evidence.

### Exit criterion

Documentation matches evidence exactly, historical records remain intact, and
all unperformed external/manual checks are named.

## Commit Sequence

Use small repository-style commits after each passing checkpoint, for example:

1. `feat: add Life OS v2 domain foundations`
2. `feat: compose Life OS context into Jarvis replies`
3. `feat: add life modes and preference learning`
4. `feat: add Life OS people and family grants`
5. `feat: rank explainable Life OS missions`
6. `feat: expand Life OS commitment understanding`
7. `feat: add durable Life OS reminders`
8. `feat: add actionable Life OS proactivity`
9. `feat: add confirmed workspace recovery`
10. `feat: add Life source adapter parsers`
11. `feat: expand Life OS Mission Control`
12. `test: verify the Life OS v2 end-to-end loop`
13. `docs: record Life OS v2 verification`

Commit names may adapt to the actual diff. Never commit a partial deployment or
production-readiness claim. Do not push unless the user requests it.

## Completion Audit

Before declaring the goal complete, read the original objective again and map
every explicit requirement to authoritative current evidence. Confirm:

- context affects normal Telegram/Desktop replies with trust separation;
- persona adaptation is cautious, explicit, disableable, and non-diagnostic;
- Mission Control mission is explainable and user-controlled;
- recovery plan is previewed, confirmed, actually executed, and verified;
- every required proactivity rule exists and changing actions cannot bypass
  origin confirmation;
- commitment parsing/lifecycle covers the required RU/EN cases;
- people, relationships, family grants, modes, preferences, and deletion work;
- all eight adapters share one safe contract and are honestly fixture-only when
  no provider is connected;
- the exact phrase completes the full real-PostgreSQL action loop once;
- all existing Jarvis systems and disabled/failure modes remain functional;
- security, API, IPC, browser, accessibility, regression, and packaging
  inspection evidence exists;
- documentation distinguishes code/test/local/PostgreSQL/deployed/manual state;
- no production deploy, account connection, EXE build/install, dependency, or
  push occurred without authorization.

If any item lacks strong evidence, keep the goal active and continue the
relevant checkpoint. Do not redefine completion around the passing subset.
