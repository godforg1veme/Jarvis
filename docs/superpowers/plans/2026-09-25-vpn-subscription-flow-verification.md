# VPN subscription create and rename verification Implementation Plan

> **For agentic workers:** Execute inline, one task at a time. Do not issue real VPN credentials or change a real subscription during tests.

**Goal:** Prove that Telegram creates and renames Happ subscription profiles correctly, preserve the closed owner-scoped flow, and deploy the already committed migration if production is missing it.

**Architecture:** The current source contains the create/rename interaction kinds, bounded context validation, PostgreSQL migration 028, contract tests, and a Telegram-path fixture test. First cover the remaining invalid-rename retry case, then verify the real production schema and deploy the source through a clean staged checkout.

**Tech Stack:** Node.js 20+, CommonJS, PostgreSQL, Telegram update handlers, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-25-github-jarvis-cleanup-design.md`

**Status:** Source regression, production schema rollout, and automated verification completed 2026-09-25. A real owner Telegram client tap remains manual acceptance.

## Global constraints

- Preserve owner, conversation, and chat scoping and consume an interaction only after the label passes validation.
- A rename changes only the profile label; the token hash and bound DE/NL client IDs stay unchanged.
- Do not create, rename, revoke, rotate, or issue access for a real production VPN profile in a test.
- Do not duplicate migration 028; add a migration only if source or live schema has an actual discrepancy.
- Preserve Telegram menu labels, order, callback grammar, and visibility.
- Never expose secrets, raw subscription tokens, or user data in test output or telemetry.

---

### Task 1: Preserve the passing baseline

**Files:** `server/src/telegram/telegramInteractionRepository.js`, `server/src/db/migrations/028_telegram_subscription_interaction_kinds.sql`, `server/src/telegram/telegramMenuService.js`, existing tests.

- [x] Confirm both interaction kinds are in the repository allowlist and rename `subscriptionId` is UUID-validated.
- [x] Confirm migration 028 includes the same closed kinds as the repository set.
- [x] Run seven focused test files: 59 passed, including `telegramSubscriptionGuidedFlowE2e.test.js`.
- [x] Run the entire server suite: 590 passed, zero failed or skipped.
- [x] Confirm the existing E2E test uses an isolated in-memory database fixture; do not present it as evidence that production has applied migration 028.

### Task 2: Cover invalid rename and retry without changing profile data

**Files:** Test `server/test/telegramSubscriptionGuidedFlowE2e.test.js`.

- [x] In the existing create-bind-rename test, after the rename prompt, send an overlong label using the existing `messageUpdate` helper:

```js
const invalidRename = await telegram.handle(messageUpdate(8, 'Слишком длинное имя подписки для Happ'));
assert.equal(invalidRename.status, 'answered');
assert.match(invalidRename.answer, /25/);
assert.equal([...database.interactions.values()].at(-1).status, 'active');
assert.equal(database.findSubscription(SUBSCRIPTION_ID).label, 'Мой iPhone');
assert.equal(database.findSubscription(SUBSCRIPTION_ID).token_hash, tokenHash);
assert.deepEqual(JSON.parse(database.findSubscription(SUBSCRIPTION_ID).client_id_de), boundDe);
assert.deepEqual(JSON.parse(database.findSubscription(SUBSCRIPTION_ID).client_id_nl), boundNl);
```

- [x] Change the following valid rename update ID from `8` to `9` and shift later IDs by one so every synthetic update remains unique.
- [x] Run the focused test and confirm the invalid retry does not consume the interaction or alter the profile:

```powershell
node --test test/telegramSubscriptionGuidedFlowE2e.test.js
```

Expected: PASS. If it fails, inspect the exact failure before changing runtime code; preserve the current validation-before-consume ordering.

### Task 3: Keep the source, context, and SQL contract tied together

**Files:** Root `AGENTS.md` after flattening; existing contract test `server/test/migrations.test.js`; existing validator tests `server/test/telegramInteractionRepository.test.js`.

- [x] Add the guided-input invariant to root `AGENTS.md`: every new emitted kind must be added to the exported allowlist, its context validation, the final `telegram_interactions_kind_check`, and a regression test in one change.
- [x] Verify the existing migration test compares the exported repository kind set with the final migration and checks kinds emitted by VPN guided flows. Extend it only if the flattened-path contract test or review shows a missing check.
- [x] Run the migration, repository, menu-service, and full Telegram guided-flow tests:

```powershell
node --test test/migrations.test.js test/telegramInteractionRepository.test.js test/telegramMenuService.test.js test/telegramSubscriptionGuidedFlowE2e.test.js
```

Expected: PASS; the menu and callback contract remains unchanged.

### Task 4: Verify production migration state and supervisor deployment boundary

**Files:** Read-only production checks; no source changes.

- [x] Confirm production Compose services are healthy and public `/health/ready` returns HTTP 200.
- [x] Query the production `schema_migrations` table and live constraint without printing environment values. Migration 028 is absent; the PostgreSQL constraint excludes both subscription label kinds.
- [x] Read safe Supervisor state: Operations is enabled; the synthetic acceptance flag is disabled; the two service-restart playbooks are enabled in current source and restore playbooks are disabled. PostgreSQL has a succeeded synthetic no-op and a succeeded non-synthetic `restart_xray` run. The 2026-09-24 rollout record identifies the latter as the owner-approved NL Xray drill.
- [x] Repeat those read-only checks immediately before deployment. Preserve the accepted Supervisor boundary; do not change playbook flags or execute a Host Agent operation.

### Task 5: Deploy the verified server tree and check the live schema

**Files:** Production staged source checkout, server image, PostgreSQL schema migration record.

- [x] Use the clean checkout and deployment procedure in `2026-09-25-vps-and-desktop-rollout.md`. Do not reset or clean `/home/deploy/apps/jarvis`, which contains mixed tracked/untracked files, backups, `.env`, and a pending operation marker.
- [x] Back up the database with the documented one-time procedure, preserving the existing Compose project name `jarvis-family`, PostgreSQL volume, app `.env`, host-agent socket, and operations secret file.
- [x] Build and start only the reviewed `server` service from the clean staged tree. Do not recreate PostgreSQL or VPN nodes.
- [x] Verify Compose health and confirm `028_telegram_subscription_interaction_kinds.sql` appears in `schema_migrations` and the live constraint contains both subscription label kinds.
- [x] Verify the public readiness endpoint returns HTTP 200 and the server log contains no migration, schema, or Telegram interaction failure code. Limit logs to safe status lines.
- [x] Update the current rollout record and `docs/README.md` only with observed results; do not claim a real owner Telegram button tap if only automated fixtures were run.

### Task 6: Close the feature verification

**Files:** Test results, rollout record, final report.

- [x] Re-run `npm test` in `server/` after the root move and test addition.
- [x] Confirm no test touched a real VPN profile or sent a token to history/logs.
- [x] Report separately: automated callback path, real PostgreSQL constraint, public readiness, and any owner-device tap that remains unverified.
