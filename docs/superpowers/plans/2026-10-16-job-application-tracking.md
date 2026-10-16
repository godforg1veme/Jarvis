# HH application tracking implementation plan

> Execute inline in `codex/job-application-tracking` using executing-plans; the owner approved the written scenario including historical imports and explicit refresh.

**Goal:** Merge observed HH history and Jarvis submission operations into a truthful owner-only application tracker.
**Architecture:** A bounded browser history reader exposes a closed read RPC. A PG repository stores observations/events and resumable sync runs, independently from the submission ledger. A server worker processes explicitly requested jobs and Telegram renders the merged records.
**Tech Stack:** CommonJS, PostgreSQL, Playwright, Zod, node:test; no new dependencies.
**Spec:** `docs/superpowers/specs/2026-10-16-job-application-tracking-design.md`

## Global constraints

- No HH mutations, chat reads, AI requests, new public ports or scope expansion.
- All available old resumes; preserve the selected sending resume and original-operation unknown recovery.
- Explicit initial open / refresh only; no periodic account sync or unsolicited notifications.
- At most 100 records/page, 5 MB initial state, 1000 pages/pass, two unstable passes, 2000 pages total per run.
- No publish without a new owner instruction; no Desktop changes.

## Task 1: Bounded HH reader and transport

Files: new `job-browser/src/hhHistoryReader.js`, server `server/src/jobs/jobHistorySchema.js`; existing `hhBrowser.js`, `rpcProtocol.js`, `rpcServer.js`, `networkPolicy.js`, `pageSignals.js`, `applicationProof.js`; `server/src/jobs/jobBrowserClient.js`; tests `job-browser/test/hhHistoryReader.test.js`, `server/test/jobHistory.test.js`.
Interfaces: `history({section,page}) -> {section,page,pages,total,items}`; each item contains topicId, vacancyId, resumeId, resumeHash nullable, title, company, url, appliedAt nullable, status, archived. No arbitrary URLs or private messages cross RPC.

- [x] Verify the actual topic shape with a read-only account probe; retain only schema metadata, no raw state or account contents.
- [x] Add failing synthetic parser tests for pagination, known statuses, missing dates, foreign URLs and ambiguous/missing identity.
- [x] Implement `normalizeHistory(raw,{section,page})` with exact bounds and closed item validation mirrored by the strict server schema.
- [x] Add owner-authenticated `history` RPC accepting only `{section,page}`; use the existing browser queue, account/primary-resume check, GET-only policy and CAPTCHA handover.
- [x] Replace existing-application detection based on selector count with explicit identity evidence; map the confirmed outcome without a new send.
- [x] Run `npm test --prefix job-browser` and focused server transport tests.

Core test:
```js
assert.equal(normalizeHistory(fixture, {section:"active",page:0}).items[0].status, 'viewed');
assert.throws(() => normalizeHistory({...fixture, total: 100001}, {section:"active",page:0}));
```

## Task 2: Observations, events and durable sync

Files: migration `server/src/db/migrations/035_job_application_tracking.sql`; new `jobHistoryRepository.js`, `jobHistoryWorker.js`; existing `jobRuntime.js`, `jobApplicationService.js`; fixture helper migration list.
Interfaces: repository `request({scope})`, `claim()`, `applyPage({run,leaseId,result})`, `fail({run,leaseId,code})`, `list({scope,page})`, `get({scope,id})`; worker `tick/start/close` with injected history client and clock.

- [x] Create owner-scoped observations keyed by native topic ID, change-only status events and a per-owner sync row with run/lease/checkpoint/seen IDs.
- [x] Preserve operations untouched; link only exact external topic, owner, vacancy and compatible resume identity. Keep unknown operations independent until their existing proof succeeds.
- [x] Make per-page upsert/events/checkpoint atomic and single-owner leased; never hold a transaction during RPC. Compare cumulative unique IDs to total before completing; retry one unstable pass, then incomplete.
- [x] Preserve previously known fields/statuses when new values are unknown; never delete an absent row. Retry transient read failures with bounded delay and preserve checkpoint through CAPTCHA and restart.
- [x] Start the worker only for explicit requests; first-open inserts one request and duplicate buttons reuse the active run. Do not require enabled vacancy search for status checks.
- [x] Verify with `node --test server/test/jobHistoryAcceptance.cjs` against a disposable local PostgreSQL fixture.

Core test:
```js
await repository.applyPage({run, leaseId, result: firstPage});
assert.equal((await repository.list({scope,page:0})).items.length, firstPage.items.length);
assert.equal((await repository.request({scope})).run_id, run.run_id);
```

## Task 3: Telegram tracker and acceptance

Files: new `server/src/jobs/jobHistoryTelegram.js`; existing `jobTelegramCallbacks.js`, `jobTelegramService.js`, `jobRuntime.js`; tests `server/test/jobHistoryAcceptance.cjs`, `job-browser/test/historyAcceptance.cjs`; docs menu contract/verification/status and bilingual local result.

- [x] `job:applications:<page>` displays merged history/local operations and refresh progress. Add bounded `applications_sync`, `application:<uuid>` and `application_refresh:<uuid>` controls.
- [x] Render independent submission/employer states, source, known dates versus discovery dates, selected resume label and known own approved letter. Use safe public HH links only.
- [x] Route actual message/menu handlers through owner/private scope; foreign IDs cannot be read or refreshed. Existing send/confirm/cancel paths retain their invariants.
- [x] Test historical-only vacancies, duplicates, multiple resumes, unknown outcomes, stale/missing fields, expiry/scope, restart, incomplete pages and refresh concurrency with real PG and actual handlers.
- [x] Run Chromium fixtures with all mutations blocked and verify no chat navigation. Run Telegram regression gate, full server/browser suites and focused PG acceptance.
- [x] Finish bilingual results/status and exact menu contract, review diff and commit locally. Publication remains separately authorized.

Core test:
```js
const view = await cb('job:applications:0');
assert.match(view.answer, /Отклики/);
assert.equal(modelCalls, 0);
assert.equal(submissionCalls, 0);
```

## Actual verification

Real account read-only probe confirmed active and archived filters and distinct first/second/last archive pages; no full production import. Server 649/649, PostgreSQL 24/24, Telegram gate 65/65, Chromium fixtures 4/4. Browser unit suite: 44 passed, four Linux-only skips. See the bilingual development result for scope and rollout limits.
