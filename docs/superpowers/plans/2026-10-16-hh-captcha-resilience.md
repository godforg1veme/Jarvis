# HH CAPTCHA resilience implementation plan

**Goal:** Recover HH CAPTCHA preparation after browser failures without losing requests or replaying uncertain operations.

**Architecture:** Local Chromium health and page lifecycle protect the existing persistent profile. Durable request acknowledgement and the existing Telegram delivery outbox preserve owner scope and notification deduplication.

**Tech Stack:** CommonJS, Node.js 22.12+, Playwright, PostgreSQL, existing grammy bot.

**Spec:** [Approved design](../specs/2026-10-16-hh-captcha-resilience-design.md).

## Global constraints

- No new production dependencies; no publication without a separate owner instruction.
- Preserve owner/private conversation/chat, callback grammar, 10 minute expiry and one native answer POST.
- Never replay uncertain answer/application/photo sends or print private state.
- Preserve profile, progress, journal and claims; do not enable paused search.
- Implement in the current clean checkout on `codex/hh-captcha-resilience`; no parallel writers.

## Task 1: Chromium recovery and health

Выполнено. Linux unit/HTTP 45/45; реальное падение renderer и restart проверены.

Files: `job-browser/src/{browserMain,captchaTelegramBrowser,rpcServer}.js`, new
`job-browser/src/browserHealth.js`, browser unit and Chromium acceptance tests.

- [x] Add failing tests for fresh-page recovery and health failure/timeout.
- [x] Implement `BrowserHealth.check()` with bounded local evaluation and single-flight;
  authenticated `/health` returns 503 when Chromium cannot execute. Context loss/watchdog
  failure invokes runtime fatal shutdown; normal shutdown suppresses fatal handling.
- [x] Replace CAPTCHA page on open; retain explicit refresh requirement for expired,
  used or crashed issued images: `challenge(false)` returns `{outcome:'refresh_required'}`.
- [x] Run browser unit tests and real HTTPS acceptance including renderer crash.

## Task 2: Durable requests, photo states and notifications

Выполнено. Unit regressions прошли; PostgreSQL/message/menu 9/9.

Files: migration `033_job_captcha_resilience.sql`, server `jobCaptchaRepository.js`,
`jobCaptchaWorker.js`, `jobCaptchaClient.js`, `jobRuntime.js`, `jobDeliveryWorker.js`,
new `jobCaptchaNotices.js`, real PostgreSQL/message/menu acceptance fixtures.

- [x] Write failing tests for retained request after error and conditional acknowledgement.
- [x] Add request UUID/time and photo attempts/available_at. Add
  `getRequest(scope)`, `ackRequest(scope,requestId)`, `recover(scope)` and scoped notice enqueue.
- [x] Worker keeps request until ready/idle/refresh_required is durable; newer UUID is
  untouched. Backend exceptions use exponential backoff capped at 120 seconds.
- [x] Convert expired sending lease to unknown before checking blockers. Only explicit
  refresh supersedes unknown photo/answer; stale pictures cannot be consumed.
- [x] Bound send wait; classify Bot 429 into same-record queued retry, explicit rejection
  into failed and missing ACK into unknown. Never send a different ID automatically after unknown.
- [x] Queue fixed scoped notices on preparation delay, expired image, failed/unknown delivery,
  and explicit idle query. Deduplicate in existing `job_deliveries`.
- [x] Run focused server tests and isolated PostgreSQL/menu/message tests.

## Task 3: Documentation and complete verification

Files: `docs/{README,runtime-context,telegram-menu-contract,verification}.md`,
`deploy/README.md`, `job-browser/README.md`, dated development result.

- [x] Describe the approved failure messages and actual local-only status.
- [x] Run required Telegram gate and full server/browser unit suites, PostgreSQL,
  Chromium HTTPS/runtime fixtures and Compose policy. Check `git diff --check`.
- [x] Review the complete diff for stale request races, unknown sends, scope leaks,
  shutdown hangs and double POST. Record actual results and remaining live checks.
- [x] Preserve local branch; propose publication to update DE runtime and verify live delivery.
