# Job cover-letter modes implementation plan

> Execute inline in the existing `codex/job-letter-modes` task branch using executing-plans. The owner authorized implementation of all four modes, including profile facts/examples in custom AI adaptation.

**Goal:** Offer four explicit cover-letter modes without requiring a facts profile.

**Architecture:** Store a base letter in the profile JSON and draft mode/source in dedicated columns. A small letter-flow handler owns mode selection and guided input; existing application confirmation and original-operation reconciliation remain authoritative.

**Tech Stack:** CommonJS, Fastify, PostgreSQL, Zod, node:test.

**Spec:** `docs/superpowers/specs/2026-10-16-job-letter-modes-design.md`

## Global constraints

- No new production dependencies or Desktop changes; no publication without a separate owner instruction.
- Existing owner/private-chat scope, revision checks, expiry, deduplication and exact-text send confirmation remain enforced.
- Source letters are limited to 10,000 characters. They are data, never model instructions.
- New guided kinds must have a forward-only PostgreSQL CHECK migration and a closed context.
- Both AI modes receive source text, facts and style examples; neither manual mode invokes AI.

## Task 1: Draft sources and optional profile

Files: `server/src/jobs/jobSchemas.js`, `jobPrompt.js`, `jobDraftService.js`, `jobDraftRepository.js`, `jobApplicationRepository.js`; migration `034_job_letter_modes.sql`; tests `jobLetterModes.test.js`, `jobModelAdapter.test.js`.

Interfaces: `generate({scope,vacancyId,requestId,parentDraftId,mode,sourceText,instruction,language})`; `createManual({scope,vacancyId,mode,text,parentDraftId})`; draft fields `letter_mode`, `source_text`. Modes: `base`, `improved`, `custom`, `custom_ai` (legacy drafts use `legacy_ai`). Profile `baseLetter` defaults to an empty string.

- [x] Add failing prompt tests for empty profiles and both source-aware AI modes, plus source/mode validation.
- [x] Add migration columns with bounded source text and closed modes; extend interaction CHECK with `job_base_letter_edit`, `job_custom_letter`, `job_custom_letter_ai`.
- [x] Preserve profile/vacancy revision SQL while removing the global profile-confirmed condition; create missing empty profiles through authorized ensure.
- [x] Build prompt data with `sourceLetter`, facts and `approvedStyleExamples`; retain legacy generation compatibility.
- [x] Preserve original source/mode on explicit regeneration/edit/translation. Manual creation writes a draft without usage/tasks/model calls.
- [x] Run `node --test server/test/jobLetterModes.test.js server/test/jobModelAdapter.test.js`.

Core regression:
```js
const messages = buildJobPrompt({ vacancy, profile: { confirmed: false, facts: [], examples: [] }, sourceText: 'Owner source' });
assert.equal(JSON.parse(messages[1].content).sourceLetter, 'Owner source');
```

## Task 2: Telegram flows and confirmed base replacement

Files: new `server/src/jobs/jobLetterFlow.js`; existing `jobTelegramService.js`, `jobTelegramViews.js`, `jobTelegramCallbacks.js`, `jobSettingsService.js`; `server/src/telegram/telegramInteractionRepository.js`.

Interfaces: mode callbacks target a vacancy UUID; base editor is a simple callback. Existing `{targetId,revision}` guided context targets a profile for base edits and a vacancy for custom letters. The base editor saves through the existing profile confirmation flow, preserving facts/examples.

- [x] Add menu label and mode chooser with base/improved/custom/custom_ai callbacks; show missing-base guidance and an explicit current-draft link.
- [x] Route base editor and custom inputs to the new flow module; validate scope, revision, size and sensitive input before single consumption.
- [x] Cancel pending send confirmations when changing mode/input; explicitly label AI draft controls.
- [x] For manual modes create exact-text drafts; for AI modes invoke source-aware generation. Do not replace the shared base with custom input.
- [x] Extend the interaction allowlist and test closed contexts. Run `node --test server/test/jobTelegram.test.js server/test/jobLetterModes.test.js`.

Core regression:
```js
for (const action of ['base', 'improved', 'custom', 'custom_ai']) {
  assert.equal(parseJobCallback(`job:${action}:${vacancyId}`).action, action);
}
```

## Task 3: Real handlers, PostgreSQL and documentation

Files: `server/test/jobLetterModesAcceptance.cjs`, `server/test/helpers/jobPostgresFixture.js`, existing Telegram acceptance callers, `server/package.json`, `docs/telegram-menu-contract.md`, `docs/verification.md`, `docs/README.md`, bilingual local result in `docs/updates/`.

- [x] Apply migration 034 in the isolated fixture. Extend real message/menu handler coverage for base replacement, all modes, empty profile, source/facts/examples, no model configuration for manual modes, invalid retry, single consumption, expiry, foreign scopes and stale revisions.
- [x] Exercise actual application repository/service confirmation and unknown-result replay without live HH submission.
- [x] Update old tests that expect immediate generation after `prepare` to explicitly choose the improved mode.
- [x] Run focused unit tests, the Telegram regression gate and full server suite; run job PostgreSQL acceptance against a dedicated disposable local database.
- [x] Record actual results, review diff for text leakage and authorization regressions, and preserve the task branch. Offer publication only after checks pass.

Core regression:
```js
await cb(`job:custom:${vacancy.id}`);
const manual = await msg('Exact owner text\nSecond line');
assert.match(manual.answer, /Exact owner text\nSecond line/);
assert.equal(modelCalls, 0);
```
