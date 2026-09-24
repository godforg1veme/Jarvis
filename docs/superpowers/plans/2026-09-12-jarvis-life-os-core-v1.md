# Jarvis Life OS Core v1 — implementation plan

Status: implemented, packaged, installed, and production-verified on 2026-09-13.
Optional model enrichment remains disabled; deterministic Core v1 is active.

Date: 2026-09-12

Status: approved for implementation. This plan implements
`../specs/2026-09-12-jarvis-life-os-core-v1-design.md` as one integrated release.
The phases below are checkpoints, not independently complete products.

## Delivery rules

- Preserve the cloud-brain/local-hands model and CommonJS.
- Add focused modules under `server/src/life/` and `renderer/life-os/`; do not
  grow `main.js`, `renderer/cloud-chat/renderer.js`, or message services with
  domain algorithms.
- Keep every repository operation owner-scoped and parameterized.
- Source adapters publish accepted facts only. They never create commands.
- Raw audio, images, OCR, document bodies, secrets, and local paths never enter
  Event Spine, API responses, prompts, logs, or Operations telemetry.
- Changing actions continue through Action Orchestrator, origin confirmation,
  authenticated Desktop delivery, and Tool Gateway verification.
- Use deterministic fakes and clocks before live acceptance.
- Add no production dependency without explicit owner approval.
- Keep unrelated worktree changes out of implementation commits.

## Phase 0 — contract and baseline

1. Add `server/src/life/lifeSchemas.js` with allowlisted event families,
   privacy/trust classes, relation types, lifecycle states, source envelopes,
   public response schemas, identifier/summary/data bounds, and cursor rules.
2. Add `server/test/lifeSchemas.test.js` for malformed identifiers, unknown
   keys/types, invalid times/confidence, oversized structured data, and valid
   cross-source fixtures.
3. Add feature flags to `server/src/config/loadConfig.js` for ingestion,
   enrichment, and proactivity. Defaults must preserve current behavior and
   permit tests without a provider.
4. Record the migration baseline and ensure `013_life_os_core.sql` is the next
   ordered migration.

Verification:

```powershell
cd server
node --test test/lifeSchemas.test.js test/config.test.js
```

## Phase 1 — Event Spine persistence

1. Add migration `server/src/db/migrations/013_life_os_core.sql` for areas,
   projects, events, event links, commitments, proposals, proposal evidence,
   feedback, processing claims, constraints, owner indexes, deduplication, and
   bounded lifecycle values.
2. Add `lifeEventRepository.js` for atomic insert-or-existing, owner-scoped
   reads, opaque cursor pagination, atomic worker claims, completion/failure,
   and stale-claim reconciliation.
3. Add `lifeProjectionRepository.js` for owner-scoped areas, projects, links,
   commitments, proposals, evidence, and feedback with revision checks.
4. Add repository tests that inspect SQL parameters and PostgreSQL acceptance
   tests that apply the migration to an isolated schema when PostgreSQL is
   available.

Verification:

```powershell
cd server
node --test test/lifeRepositories.test.js test/migrations.test.js
```

Required gate: cross-owner IDs must be indistinguishable from missing records;
duplicate source facts return one event; evidence cannot cross owners.

## Phase 2 — Event Gateway and deterministic projections

1. Implement `lifeEventGateway.js` as the only normalized ingestion boundary.
   Derive trusted owner/source data from callers, validate, deduplicate, persist,
   and queue without exposing projection internals.
2. Implement trusted linking for known conversations, documents, devices,
   workflows, commitments, and proposals.
3. Implement default areas and exact/alias project matching without a model.
4. Add idempotent projection rebuild for Timeline-visible summaries.
5. Wire lifecycle start/stop into `server/src/runtime.js` behind flags.

Verification:

```powershell
cd server
node --test test/lifeEventGateway.test.js test/lifeProjection.test.js
```

Failure gate: unavailable Life OS persistence does not convert an accepted
message, document, Vision observation, or action result into a false failure.

## Phase 3 — existing source adapters

1. Add narrow event publisher hooks to `TelegramMessageService` after update
   deduplication and owner resolution for text and accepted voice transcripts.
2. Add equivalent hooks to `DesktopMessageService`, preserving request replay
   behavior and authenticated device identity.
3. Publish metadata-only document lifecycle events after knowledge ingestion.
4. Publish bounded Vision observation events only after active-lease validation
   and schema-valid analysis.
5. Publish device lifecycle metadata at authenticated session registration and
   removal without producing reconnect noise.
6. Add an Action Orchestrator observer that publishes workflow lifecycle and
   verified terminal result events exactly once. Tool Gateway remains local and
   is represented only by the authenticated result path.
7. Link existing memory/conversation references by trusted identifiers without
   copying memory content.

Verification:

```powershell
cd server
node --test test/telegramMessageService.test.js test/desktopMessageService.test.js
node --test test/knowledgeService.test.js test/visionRoutes.test.js
node --test test/deviceSessionRoute.test.js test/actionOrchestrator.test.js
node --test test/lifeSourceAdapters.test.js
```

Required gate: retries/reconnects create one fact, raw source content stays out
of event rows, and every original source path still works with Life OS disabled.

## Phase 4 — areas, projects, links, and commitments

1. Implement `lifeLinker.js` with trusted identifier links, exact owner aliases,
   recent context candidates, bounded provider classification, confidence, and
   one corrective retry for malformed structured output.
2. Implement `commitmentDetector.js` with deterministic Russian/English date and
   commitment cues plus optional provider classification. Low confidence remains
   visibly inferred and cannot trigger changing work.
3. Implement area/project create, update, archive, list, and detail services with
   optimistic revision checks.
4. Implement `life_feedback` corrections and suppression overlays.
5. Seed default areas idempotently on first Life OS bootstrap rather than during
   unrelated user creation.

Verification:

```powershell
cd server
node --test test/lifeLinker.test.js test/commitmentDetector.test.js
node --test test/lifeProjects.test.js test/lifeFeedback.test.js
```

Provider gate: missing key, timeout, invalid JSON, prompt injection, and fallback
must leave a useful deterministic Timeline without granting trust or authority.

## Phase 5 — Timeline and context recovery

1. Implement `timelineService.js` with day/project filters, bounded opaque cursor,
   meaningful-event projection, relation/confidence/source indicators, and
   evidence-safe public records.
2. Implement `contextRecoveryService.js` over recent events, decisions, linked
   document metadata/citations, open commitments/proposals, workflow results,
   device availability, and last continuation point.
3. Separate verified facts, inferred links, and suggested next steps in every
   context response.
4. Add deterministic truncation and stable ordering tests.

Verification:

```powershell
cd server
node --test test/lifeTimeline.test.js test/contextRecovery.test.js
```

Acceptance fixture: "continue Life OS" returns the latest verified work result,
open commitment, linked document, and next step with provenance and without
unrelated owner/project data.

## Phase 6 — explainable proposals and safe proactivity

1. Implement `proposalService.js` with evidence validation, cooldown keys,
   expiry, origin binding, immutable frozen confirmation payloads, and lifecycle
   mapping to workflows.
2. Implement `proactivityWorker.js` with atomic claims and only the approved
   rules: due/overdue commitment, dormant unfinished project, linked document,
   terminal workflow, and user-requested follow-up.
3. Add per-rule confidence, lookback, cooldown, open-proposal, expiry, and action
   limits.
4. Delegate confirmed changing proposals to Action Orchestrator; never dispatch
   from the worker or HTTP route.
5. Deliver proposal availability to Desktop and Telegram without leaking
   evidence content across channels.

Verification:

```powershell
cd server
node --test test/lifeProposalService.test.js test/lifeProactivityWorker.test.js
node --test test/actionOrchestrator.test.js test/commandService.test.js
```

Security gate: another user, chat, channel, or device cannot confirm; expired or
mutated proposals fail; unknown outcomes never retry; success requires a
schema-valid persisted Tool Gateway result.

## Phase 7 — authenticated Life OS API

1. Add `lifePublic.js` for redacted public envelopes and uniform not-found
   behavior.
2. Add `lifeRoutes.js` and register it with the existing Desktop authenticator
   and rate limiter.
3. Implement bootstrap, Timeline, projects, project context, Mission Control,
   feedback, confirm, and dismiss endpoints from the approved design.
4. Add route-specific body, query, page, and response limits.
5. Add API tests for authentication, ownership, validation, revision conflicts,
   cursor tampering, rate limits, response redaction, and disabled flags.

Verification:

```powershell
cd server
node --test test/lifeRoutes.test.js test/desktopRoutes.test.js
```

## Phase 8 — Mission Control and Living Timeline Desktop UI

1. Add `renderer/life-os/` with a focused responsive shell, Mission Control,
   Timeline, project context, commitment, proposal, evidence, feedback, and
   offline/error/empty states.
2. Add a narrow local controller/transport module under `cloud/` for authenticated
   API calls, caching only bounded non-sensitive view state through
   `runtimeDataPath.js`.
3. Add explicit preload methods and IPC handlers. Renderers cannot construct
   arbitrary paths, headers, commands, or proposal actions.
4. Add entry points from Cloud Chat and tray while keeping Quantum Core as the
   visible Jarvis identity.
5. Use existing assets and dependencies. Implement keyboard navigation, visible
   focus, accessible names/live regions, WCAG AA contrast, responsive 1440/390/
   320 layouts, and reduced motion.

Verification:

```powershell
node scripts/testLifeOsIpc.js
node scripts/testLifeOsRenderer.js
node scripts/testRuntimeDataPath.js
node scripts/testTrayMenu.js
node scripts/testQuantumCore.js
node scripts/testLifeOsBrowser.cjs
```

Visual gate: inspect captured populated, empty, loading, stale, error, proposal,
and project-context states at all required widths with no overflow or inaccessible
control.

## Phase 9 — integrated end-to-end acceptance

1. Add deterministic multi-source fixtures correlating Telegram, Desktop Voice,
   Vision, documents, memory references, device lifecycle, workflows, and Tool
   Gateway results in one owner Timeline.
2. Exercise the approved complete scenario from commitment phrase through
   proposal, origin confirmation, verified action, Timeline update, and context
   recovery.
3. Exercise cross-owner, replay, malformed source, prompt injection, provider
   failure, device offline, server restart, and unknown-outcome cases.
4. Run all affected and adjacent regression suites.

Required checks:

```powershell
cd server
npm test
cd ..
node scripts/testToolGateway.js
node scripts/testRemoteProtocol.js
node scripts/testToolPolicyMapping.js
node scripts/testVoiceServiceSttProvider.js
node scripts/testQuantumCore.js
node scripts/testVisionTransport.js
node scripts/testVisionRuntime.js
node scripts/testVisionIpc.js
node scripts/testVisionMediaPermission.js
node scripts/testObjectReconciler.js
node scripts/testSceneState.js
node --test cloud/*.test.js voice/cloudVoiceService.test.js tts/windowsSapiService.test.js
cd ops-ui
npm test
npm run build
```

If PostgreSQL and the Host Agent are available, run the explicit isolated-schema
Operations acceptance plus a Life OS PostgreSQL acceptance. Telegram delivery
remains opt-in and raw client data must not appear in output.

## Phase 10 — documentation, package, install, push

1. Update `README.md`, `docs/README.md`, `AGENTS.md`, and relevant deployment
   documentation to state only verified capability and remaining manual gates.
2. Compare the installed Jarvis Desktop with current sources.
3. Build the current installer only after code and regression gates pass:

```powershell
npm run dist:win
```

4. Install the resulting NSIS build on this PC as explicitly requested by the
   owner, preserving user data, and run an installed-runtime smoke check.
5. Inspect installer contents and verify no server, docs, `.superpowers`, data,
   secrets, models outside declared resources, or local state leaked into it.
6. Review `git diff`, preserve unrelated user changes unless they are explicitly
   part of the final documentation update, create focused commits matching
   repository style, and push `main` to its configured upstream.
7. Verify the pushed commit exists on the remote before declaring completion.

## Completion audit

Before marking the goal complete, map every requirement in the approved design
to current evidence: migration, repository, API, source adapter, worker, UI,
test, packaged application, installed application, documentation, commit, and
remote state. Missing or indirect evidence means the goal remains active.
