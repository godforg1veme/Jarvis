# HH hourly history implementation plan

**Goal:** Refresh all eligible users' full HH history hourly and stop presenting
historical invitations as newly confirmed current invitations.

**Architecture:** Keep the durable history queue and per-user browser profiles.
Add due scheduling before claiming history work; preserve active runs and
manual refresh. Repair status interpretation/presentation only with evidence.

**Tech stack:** CommonJS, PostgreSQL, existing browser RPC and Telegram handlers.

**Spec:** [Approved design](../specs/2026-10-22-hh-history-hourly-design.md).

## Constraints

- No production dependencies, secrets in output or production mutations.
- Current `jobs`, numeric identity and private-chat binding remain mandatory.
- Do not overwrite another user's run or in-flight checkpoint.
- Preserve manual refresh and exact application-confirmation boundaries.

## 1. Durable scheduler

Files: `server/src/jobs/jobHistorySyncRepository.js`,
`server/src/jobs/jobHistoryWorker.js`, `server/test/jobHistoryAcceptance.cjs`.

- [x] Add clock-controlled PostgreSQL tests for first refresh, two users,
  completion plus one hour, disabled search and missing search settings.
- [x] Add tests for no duplicate/reset of queued/running/paused work, terminal
  retry cooldown, revoked access, disconnection and concurrent scheduling.
- [x] Add `scheduleDue()` using the existing access transaction and scoped
  history request logic. Candidate enumeration must not depend on search
  activation or stop after an initial group of denied users.
- [x] Call scheduling from the worker before claim, without another timer.
- [x] Run focused unit and isolated PostgreSQL acceptance checks.

## 2. Invitation proof and presentation

Files: `job-browser/src/hhHistoryReader.js`, its tests,
`server/src/jobs/jobHistoryRepository.js`, `jobHistoryTelegram.js`, history tests.

- [x] Compare selected screenshot records with current owner-scoped HH status
  metadata; export no raw page, dialogue, credentials or unrelated profile data.
- [x] Reproduce verified incorrect status/date/sorting cases with fixtures.
- [x] Correct parsing and presentation so old/ambiguous observations are not
  shown as currently confirmed invitations; retain source timestamps.
- [x] Run browser reader and Telegram/history regression checks.

## 3. Integration and review

- [x] Run full server unit tests and required Telegram gate.
- [x] Run isolated PostgreSQL history and access scenarios.
- [x] Request an independent review of scheduler fairness, identity boundaries
  and status semantics; resolve confirmed findings and rerun affected checks.
- [x] Update menu contract and a bilingual development record with actual
  results; preserve pre-existing documentation edits.
- [x] Report local readiness and propose the server/browser rollout separately.
