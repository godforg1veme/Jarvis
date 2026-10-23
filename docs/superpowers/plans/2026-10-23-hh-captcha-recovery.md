# HH CAPTCHA recovery implementation plan

> **For agentic workers:** Execute the approved repair task-by-task; the primary agent accepts the specialist result and runs integration checks. Do not create nested agents.

**Goal:** Recover exact-target verification for HH branded vacancies and preserve actionable, private CAPTCHA diagnostics.

**Architecture:** Keep the existing CAPTCHA state machine and exactly-once answer guard. Extend only the branded-description reader and closed preparation failure codes. Exercise the actual reader/controller together in Chromium.

**Tech Stack:** Node.js 22.12+, CommonJS, Playwright, existing PostgreSQL/Telegram clients.

**Spec:** [Approved design](../specs/2026-10-23-hh-captcha-recovery-design.md).

## Global constraints

- No new production dependencies, raw errors, private URLs, answers or image keys in diagnostics.
- Preserve owner/user scope, exact target/200/security checks, revisions, claims and unknown/no-repeat behavior.
- No push/deploy without the owner's release instruction; preserve unrelated Mini App work.

### Task 1: Branded vacancy reader and browser regression

Files: `job-browser/src/hhPageReader.js`, `job-browser/test/hhBrandedRecovery.test.js`.

- [ ] Reproduce hidden HH branded description with one valid JobPosting and the actual readVacancyPage function; confirm the baseline fails.
- [ ] Prefer visible text; narrowly admit a unique branded static description with bounded text-node traversal excluding active/style/template content. Reject ambiguous, missing, unrelated hidden and oversized content.
- [ ] Use the actual ManualCoordinator/CaptchaTelegramBrowser verification path with in-memory durable state, unknown receipt and restart. Assert idle only after exact-target proof and zero answer POSTs.
- [ ] Cover challenge page, wrong-target redirect, non-200, invalid structured data, ordinary visible description and fallback rejection cases in a real browser.

### Task 2: Closed preparation diagnostics

Files: `job-browser/src/captchaTelegramBrowser.js`, `job-browser/src/captchaBroker.js`, `server/src/jobs/jobCaptchaClient.js`, `server/src/jobs/jobCaptchaWorker.js`, focused tests.

- [ ] Add tests showing generic/private exceptions never escape, while closed known preparation reasons survive authenticated broker/client and reach the worker report.
- [ ] Classify preparation stage failures without changing public outcome shapes, navigation/answer permissions or notice text. Keep generic fallback for unknown errors and preserve retry/backoff.
- [ ] Test malformed/extra failure fields and an attacker-controlled error code fall back to a generic safe error.
- [ ] Run browser and server focused tests, then complete suites; record Linux-only skips separately.

### Task 3: Acceptance and documentation

- [ ] Run the changed reader in an isolated read-only browser on DE against the exact saved owner target, printing only verification outcome and closed failure fields. Do not load or mutate the live profile or send answers.
- [ ] Independently review the diff for hidden-content/security and retry regressions.
- [ ] Update the primary browser guide, Russian/English development result and current status with actual evidence, remaining personal-session acceptance and deployment status.
- [ ] Present the ready local result and propose browser/server rollout to resolve the live incident.
