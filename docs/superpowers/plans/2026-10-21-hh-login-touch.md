# HH Login and Touch Implementation Plan

**Goal:** Repair personal HH sign-in, deliver private links and support phone input.
**Architecture:** Extend the closed auth policy; share a recipient-bound link
delivery service between Mini App and Telegram; extend the existing browser
frame protocol with bounded field metadata and keep serialized input.
**Tech Stack:** CommonJS/Fastify/PostgreSQL, Playwright, vanilla browser modules.
**Spec:** [Approved design](../specs/2026-10-21-hh-login-touch-design.md).

## Constraints

No new production dependencies. Preserve separate user profiles, jobs access,
private-chat checks, TTL, sequence consumption and resume confirmation. No
credentials or bearer URLs in history/logs. Local work only until release approval.

### Task 1: Authentication and mobile input

Owner: frontend/browser implementer. Files: `job-browser/src/networkPolicy.js`,
`hhBrowser.js`, a bounded input metadata helper; `mini-app/job-connect.html`,
`src/jobConnect.js`, `src/style.css`, build/assets allowlists if a module is added;
relevant job-browser tests and a dedicated client browser fixture.

- [x] Add the two verified POST paths and test rejection of unrelated writes.
- [x] Return `inputFields` metadata with frame responses: bounded rectangles,
  closed input kind, no values or arbitrary DOM strings.
- [x] Add touch selection and native input with one serialized sequence stream,
  reconciliation after unknown and no keyboard for non-editable targets.
- [x] Preserve existing fallback controls and clear transient input on exit.
- [x] Run focused job-browser and mobile/desktop browser fixtures.

### Task 2: Private link delivery

Owner: backend implementer. Files: `server/src/jobs/jobConnectionSession*`,
new scoped link helper/delivery service, `jobRuntime.js`, `jobTelegramService.js`,
`miniAppSelfRoutes.js`, `runtime.js`, Telegram URL validator and focused tests;
forward-only migration only if required for durable delivery claims.

- [x] Create a private link flow using the existing request/session IDs.
- [x] Bind Telegram recipient on the server; send link text and URL button once.
- [x] Use closed sent/failed/unknown states, never replay uncertain delivery;
  preserve usable Mini App link when Telegram delivery fails.
- [x] Reuse flow from Telegram connect and Mini App without changing callback grammar.
- [x] Test scope, revocation, hostile URL, duplicate/concurrent/unknown delivery.

### Task 3: Integration and acceptance

Owner: main agent. Files: `mini-app/src/jobConnection.js` if delivery status needs
copy, `mini-app/README.md`, `docs/telegram-menu-contract.md`, `docs/README.md`,
`docs/verification.md` and a bilingual development record.

- [x] Review both diffs and run combined browser fixtures and server tests.
- [x] Run Telegram regression gate, full server and job-browser tests, build,
  source/asset checks and `git diff --check`.
- [ ] Independent final review: unavailable because worker usage limits were reached. The main agent reviewed scope, delivery, keyboard handling and integration.
- [x] Document verified results and remaining live acceptance; propose release
  of server/browser/Mini App only after local checks pass. Desktop is unchanged.
