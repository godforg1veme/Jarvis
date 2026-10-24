# HH CAPTCHA recovery implementation plan

> **For agentic workers:** Execute the approved repair task-by-task; the primary agent accepts the specialist result and runs integration checks. Do not create nested agents.

**Goal:** Recover exact-target verification for HH branded vacancies and preserve actionable, private CAPTCHA diagnostics.

**Architecture:** Keep the existing CAPTCHA state machine and exactly-once answer guard. Extend only the branded-description reader and closed preparation failure codes. Exercise the actual reader/controller together in Chromium.

**Tech Stack:** Node.js 22.12+, CommonJS, Playwright, existing PostgreSQL/Telegram clients.

**Spec:** [Approved design](../specs/2026-10-23-hh-captcha-recovery-design.md).

**Completed October 24:** published and deployed as part of the broader
[complete-collection release](../../updates/2026-10-24-hh-complete-collection.md).
The final scope included server, collector and browser. Both checked CAPTCHA
pauses cleared. The approval-pending and browser-only statements below describe
the earlier local stage; they are superseded by the approved combined release.

## Global constraints

- No new production dependencies, raw errors, private URLs, answers or image keys in diagnostics.
- Preserve owner/user scope, exact target/200/security checks, revisions, claims and unknown/no-repeat behavior.
- No push/deploy without the owner's release instruction; preserve unrelated Mini App work.

### Task 1: Branded vacancy reader and browser regression

Files: `job-browser/src/hhPageReader.js`, `job-browser/test/hhBrandedRecovery.test.js`.

- [x] Reproduce hidden HH branded description with one valid JobPosting and the actual readVacancyPage function; confirm the baseline fails.
- [x] Prefer visible text; narrowly admit a unique branded static description with bounded text-node traversal excluding active/style/template content. Reject ambiguous, missing, unrelated hidden and oversized content.
- [x] Use the actual ManualCoordinator/CaptchaTelegramBrowser verification path with in-memory durable state, unknown receipt and restart. Assert idle only after exact-target proof and zero answer POSTs.
- [x] Cover challenge page, wrong-target redirect, non-200, invalid structured data, ordinary visible description and fallback rejection cases in a real browser.

### Task 2: Closed preparation diagnostics

Files: `job-browser/src/captchaTelegramBrowser.js`, `job-browser/src/captchaBroker.js`, new `job-browser/src/captchaPreparation.js`, `job-browser/test/captchaPreparation.test.js`.

The completed implementation logs closed reasons in the browser broker, preserving
the existing generic RPC error. Client/worker code and wire shapes need no changes.

- [x] Add tests showing generic/private exceptions never escape, while closed known preparation reasons reach the authenticated broker report.
- [x] Classify preparation stage failures without changing public outcome shapes, navigation/answer permissions or notice text. Keep generic fallback for unknown errors and preserve retry/backoff.
- [x] Test arbitrary failure fields and attacker-controlled error codes fall back to a generic safe diagnostic and unchanged RPC response.
- [x] Run browser and server focused tests, then complete suites; Linux final suite plus HTTPS fixture passes 100/100 without skips, server 792/792, Telegram gate 66/66.

### Task 3: Acceptance and documentation

- [x] Run the changed reader in an isolated read-only browser on DE against the exact saved owner target, printing only verification outcome and closed failure fields. Do not load or mutate the live profile or send answers.
- [x] Independently review the diff for hidden-content/security and retry regressions; fix both identified edge cases and add regression tests.
- [x] Update the primary browser guide, Russian/English development result and current status with actual evidence, remaining personal-session acceptance and deployment status.
- [x] Prepare the final local result and job-browser-only rollout proposal to resolve the live incident; approval and personal-session acceptance remain pending.

Actual rollout scope: job-browser only; server/collector/Desktop do not change.
Sources on both VPS must follow the approved release workflow. Personal-session
acceptance remains pending until rollout; no publication was authorized here.
