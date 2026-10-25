# HH Fresh Vacancies Implementation Plan

**Goal:** Collect fresh HH vacancies every five minutes while historical collection continues, and reconcile the full selected range daily.

**Architecture:** Reuse JobCollector with lane-specific JobSearchRepository instances and a shared user lease. Interleave bounded passes, retain one outbox, and promote queued fresh cards.

**Tech Stack:** CommonJS, PostgreSQL, existing Chromium/RPC.

**Spec:** [Approved design](../specs/2026-10-25-hh-fresh-vacancies-design.md).

## Global Constraints

- Same queries, filters, Telegram UI and current jobs scope.
- No production dependencies, push or production changes.
- Keep history progress and sent/unknown deliveries intact.
- Moscow calendar windows; UTC timestamps in storage.

## Task 1: Independent durable state

Files: `server/src/jobs/jobSearchRepository.js`, migration `047_job_fresh_collection.sql`,
`server/test/helpers/jobPostgresFixture.js`, `server/test/jobFreshRepositoryAcceptance.cjs`.

- [x] Add fresh checkpoint/progress/due columns and card priority with a forward-only migration.
- [x] Select the lane through `new JobSearchRepository(pool, { accessService, lane: 'fresh' })`;
  existing construction defaults to history. Keep one lease and return lane aliases to the collector.
- [x] Reset fresh state on settings edits; pause/resume retains partial state. Validate lane and batch limits.
- [x] Add scoped `matchedVacancies({ userId, externalIds, filterRevision, publishedFrom, publishedTo })`
  returning a Map of already sent/sending/unknown user matches within the exact time bounds.
- [x] Run PostgreSQL checks for lanes, leases, settings, access and bounded due selection.

## Task 2: Collection and scheduling

Files: `jobCollector.js`, `collectorMain.js`, new `jobCollectionScheduler.js` under
`server/src/jobs`, focused unit and PostgreSQL acceptance tests.

- [x] Reuse collection with explicit fresh interval/history/priority options; retain default history behavior.
- [x] Resolve sent/sending/unknown matched IDs once per page to skip repeat detail reads;
  reread queued cards before promotion so an old snapshot cannot grant priority.
- [x] Prepend a new head every five minutes during incomplete fresh runs, preserving stable
  notice identity and partial cursors. Read accessible saturated pages without completing the gap.
- [x] Bound progress at 256 windows/96 KiB using conservative query unions; retain every
  unchecked range with cursor replay and no checkpoint advancement.
- [x] Give fresh passes 12 requests/15 seconds; history passes remain bounded and receive regular turns.
- [x] Test fresh arrivals during unfinished history, pagination, overlap, restart and failures.
- [x] Test scheduler ordering, user fairness, stop and per-user error isolation using controlled clocks.

## Task 3: Shared delivery and acceptance

Files: `jobDeliveryRepository.js`, `jobDeliveryWorker.js`, delivery/collection acceptance tests.

- [x] Add `enqueue({ userId, vacancyId, priority = 0 })`; promote only queued conflicts.
- [x] Order attention before fresh cards before ordinary cards, preserving scope and unknown handling.
- [x] Bind existing incomplete-run notices to lane-specific progress with legacy history compatibility.
- [x] Test promotion, dedup, sent/unknown preservation, stale lane notices and priority using PostgreSQL.
- [x] Run full server tests, affected PostgreSQL suites and Telegram regression gate.
- [x] Independently review the diff, resolve findings, and document actual checks in Russian and English.

## Task 4: Daily full-range reconciliation (user-approved extension)

Files: migration `048_job_reconciliation.sql`, `jobSearchRepository.js`,
`jobCollector.js`, `collectorMain.js`, `jobCollectionScheduler.js`,
`jobReconciliationProgress.js`, `jobCollectionWindows.js`,
`jobDeliveryRepository.js`, `jobDeliveryWorker.js`, job fixture and dedicated
reconciliation unit/PostgreSQL/browser scenarios.

- [x] Add independent reconciliation state and lane aliases, preserving the common lease.
- [x] Start each new full cycle at `now - historyDays`; resume partial windows across budgets/errors.
- [x] Schedule the first/new successful cycle after 24 hours; preserve overdue work on resume.
- [x] Retain compact inaccessible gap summaries with `cycleFinished:true` and no successful checkpoint, then retry the whole range the next day.
- [x] Alternate historical/reconciliation background passes, checking fresh work before each.
- [x] Keep normal delivery priority, existing scope and one incomplete notice per cycle.
- [x] Test a previously missed old vacancy, late indexing, restart, settings/access, daily repetition and incomplete-cycle retries with real PostgreSQL and browser/RPC fixtures.
- [x] Independently review and run the full server/Telegram/affected acceptance checks; update Russian and English status and verification docs.

## Execution notes

User requested implementation in this session. Main agent owns integration and
documentation; a bounded backend task owns durable repository state. Review follows
the completed diff. Publication is proposed only after local checks are complete.
