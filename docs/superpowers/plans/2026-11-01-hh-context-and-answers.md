# HH context and answers implementation plan

2 ноября: [реализовано и установлено на DE](../../updates/2026-11-02-hh-context-and-answers-release.md).
November 2: [implemented and deployed on DE](../../updates/2026-11-02-hh-context-and-answers-release.md).

**Goal:** Implement the owner-approved [design](../specs/2026-11-01-hh-context-and-answers-design.md).
**Architecture:** A shared bounded questionnaire contract joins browser discovery,
server answer generation and immutable submission identity. Existing filtering
feeds complete context to the evaluator and remains an independent hard gate.
**Tech stack:** CommonJS, Fastify, PostgreSQL, existing Playwright and Zod; no new dependencies.
**Execution:** Continue in this chat on `codex/hh-context-and-answers`; independent
file owners implement selection and browser changes, the main agent integrates
server orchestration and documentation. No nested agents or publication.

## 1. Selection and truthful letters

Files: `server/src/jobs/jobVacancyPrompt.js`, `jobModelAdapter.js`, `jobPrompt.js`,
`jobAutomationWorker.js`, `jobAutomationRepository.js`, selection/letter instructions,
focused tests and a forward-only migration for private evaluation metadata.

- [x] Build `buildSelectionContext({vacancy,profile,resumeContext,settings})` from
  all existing settings plus `evaluateVacancy`, retaining unknown annotations.
- [x] Require target direction fit before partial experience fit; persist a
  bounded rationale and input revisions. Prevent invented personal commitments.
- [x] Verify rejected unrelated sales, adjacent AI implementation, exclusions,
  uncertain salary, complete resume and full settings delivery with `node --test`.

## 2. Browser questions and stop reasons

Files: new shared questionnaire contract, `job-browser/src/hhApplicationForm.js`,
`hhApplication.js`, `hhApplicationDriver.js`, `hhBrowser.js`, `rpcProtocol.js`,
`guardedSubmission.js`, `applicationLedger.js`, `submissionProtocol.js` and tests.

- [x] Define closed bounded questions/answers with deterministic schema hash.
- [x] Read native HH text/choice controls only; reject external/unknown forms.
- [x] Bind exact answers and question hash to preparation, request validation and
  durable identity; preserve old operation identity and original-ID recovery.
- [x] Propagate closed reason codes. Exercise actual browser with network fixtures
  and Linux durable ledger checks; do not send any real application.

## 3. Server integration

Files: new question prompt/service, `jobApplicationService.js`,
`jobApplicationRepository.js`, `jobBrowserClient.js`, `jobRuntime.js`, delivery
worker, focused tests and migration for saved questionnaire payload.

- [x] Generate native answers from the same full personal context and professional
  knowledge, explicitly abstaining for missing personal facts.
- [x] Persist exact questions/answers and usage before submission; recheck current
  scope, consent, search/profile/vacancy/resume revisions after model invocation.
- [x] Carry answers through submit/reconcile and stop reasons through notices.
- [x] Verify genuine scoped server/DB integration, rollback, revocation, changed
  forms and unknown outcomes; manual confirmation stays unchanged.

## 4. Review and acceptance

- [x] Review integration and independent security boundary findings.
- [x] Run focused suites, full server/browser suites and isolated PostgreSQL checks.
- [x] Update RU/EN current status and Telegram contract with local-only state.
- [x] Report actual checks and any unverified native HH layout; offer publication
  only after reviewable implementation and tests. Desktop changes are unnecessary.
