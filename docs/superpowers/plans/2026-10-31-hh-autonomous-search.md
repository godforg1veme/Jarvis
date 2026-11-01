# HH autonomous search implementation plan

**Goal:** Implement personal, reversible autonomous vacancy evaluation and applications.

**Architecture:** Existing collection and manual application paths remain. Dedicated
consent and work records drive a background worker. The two clients use one scoped
automation service; model output never grants submission authority.

**Tech Stack:** CommonJS, Fastify, PostgreSQL, existing Mini App JavaScript/CSS.

**Spec:** [Approved behavior](../specs/2026-10-31-hh-autonomous-search-design.md).

## Constraints

- No new production dependencies; no push, deployment or real external applications.
- Personal current jobs permission, private Telegram scope, explicit resume-bound consent.
- No daily application quota; no routine auto-mode card notifications.
- $2 monthly notification without stopping; preserve uncertain outcomes and original IDs.

## Tasks

- [x] Backend: migration 054, automation repository/service/worker and automatic
  application claim. Own files `server/src/jobs/jobAutomation*.js`,
  `jobApplicationRepository.js`, `jobApplicationService.js` and focused tests.
  Produce `get({scope})`, `setEnabled({scope,enabled,expectedRevision})`, worker
  `start/stop/tick` and `submitAutomatic({scope,draftId,automationRevision})`.
- [x] Clients: job Telegram views/callbacks/service, Mini App self routes and jobs
  controls. Consume the automation service, explicit on/off target and revision.
  Test callback grammar, denied/foreign scope, stale/replay and screen states.
- [x] Model and integration: fixed GLM 5.3 Flash via OpenRouter, decision-only evaluation prompt,
  config/env, usage cost basis migration 055, $2 defaults, runtime wiring and
  quiet delivery with scoped manual handoff. Consume backend/client interfaces.
  Run provider fixtures without network, unit suite and isolated PostgreSQL checks.
- [x] Review and local acceptance: independent security review of consent/submit boundary,
  inspect integrated diff, run Mini App build and browser fixtures, update menu,
  verification and bilingual current status. Record live checks as pending.

## Verification commands

`node --test server/test/jobGlmAdapter.test.js server/test/jobVacancyPrompt.test.js`

`npm test --prefix server`

`npm run build --prefix mini-app`

`node --test server/test/jobAutomationAcceptance.cjs server/test/jobAutomationIntegrationAcceptance.cjs`

Focused client and worker tests are run by their owners; final acceptance records
the exact commands and results. All external model, HH and Telegram sends in tests
use fixtures. Never use a production database for these checks.
