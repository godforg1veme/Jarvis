# Job settings panel implementation plan

> Execute inline using executing-plans in `codex/job-settings-panel`.

**Goal:** Replace the command-like settings screen with the owner-approved button panel.
**Architecture:** A focused settings panel module owns views, callbacks and one-field input. Existing settings schema and confirmations remain the write boundary. Migration 036 adds one strictly scoped input kind.
**Tech Stack:** CommonJS, Zod, PostgreSQL, node:test; no new dependencies.
**Spec:** `docs/superpowers/specs/2026-10-16-job-settings-panel-design.md`

## Global constraints

- Owner/private Telegram scope, original confirmation/revision/expiry and deduplication remain.
- Callbacks ≤64 bytes; no input text, model IDs or credentials in callback data.
- No AI calls or HH mutations for settings; no push without separate authorization.
- Existing settings ranges remain; lists show eight entries; min one query.

## Task 1: Typed controls, parser and guided context

Files: new `server/src/jobs/jobSettingsControls.js`, test `server/test/jobSettingsPanel.test.js`; modify `jobTelegramCallbacks.js`, `telegramInteractionRepository.js`; migration `036_job_setting_value.sql`.

Interfaces: `fields`, `parseValue(field,text)`, `choices(field,settings,models)`, `parseSettingsCallback(value)`; closed callbacks carry field/revision/page or preset index. Input context is `{targetId,revision,field,returnPage}`.

- [x] Add parser/context tests and run `node --test server/test/jobSettingsPanel.test.js` before implementation.
- [x] Add strict field allowlist, numeric parsing, inherited model choice and settings-schema validation.
- [x] Add migration 036 and exact repository context handling; include migration in fixture and migration assertions.

```js
assert.equal(parseValue('budget','3,5'),3.5);
assert.equal(parseJobCallback('job:cfg:interval:2:0').revision,2);
assert.throws(()=>validateContext('job_setting_value',{targetId,revision:1,field:'shell',returnPage:0}));
```

## Task 2: Panel and one-field confirmations

Files: new `server/src/jobs/jobSettingsPanel.js`; modify `jobSettingsService.js`, `jobTelegramService.js`, `jobRuntime.js`.

Interfaces: panel `handle({scope,action,field,revision,page,index,targetId})`, `handlePendingText(text,{scope,interaction})`; settings preview accepts a closed optional `returnTo`, approval can return its saved destination for this panel only.

- [x] Render panel and field/preset/model/list/detail screens with bounded labels and explicit return controls.
- [x] Route callback grammar through the normal service, validate revision before indexes, and cancel scoped pending input on navigation.
- [x] Preview one field or list delta without writing; preserve whole validated settings snapshot/revision and destination in the existing confirmation row.
- [x] Consume valid input once; preserve invalid retries, scope, expiry and cancellation. Keep legacy pending `job_settings_edit` compatible.
- [x] Preserve `approve` behavior for legacy/profile flows; panel uses its own scoped confirmation route and returns to panel/list.

```js
const view=await cb('job:settings');
assert.ok(view.buttons.flat().some(b=>b.text.includes('Доход')));
assert.equal((await interactions.getActive(scope)).interaction,null);
```

## Task 3: Real-handler acceptance and completion

Files: new `server/test/jobSettingsPanelAcceptance.cjs`; fixture helper and package scripts; docs menu contract, verification, bilingual development result/status.

- [x] Use disposable PostgreSQL and actual message/menu handlers to test all fields, presets/custom input, models, list pages/add/remove/minimum, pending writes and returns.
- [x] Test CHECK/context allowlist, invalid retry, consumption, foreign scopes, revision/expiry/replay and navigation exit; ensure no model/HH calls.
- [x] Adapt existing settings acceptance to enter the new panel; explicitly cover legacy already-issued input.
- [x] Run focused acceptance, Telegram gate and full server suite; review diff and markdown links.
- [x] Update docs and commit locally; offer the server-only release with both VPS source synchronization separately.

```powershell
node --test server/test/jobSettingsPanel.test.js
npm run test:jobs:postgres --prefix server
npm test --prefix server
```

## Verification result

Server 652/652, Telegram gate 65/65, real PostgreSQL job acceptance 28/28. No AI, HH or Telegram sends; local implementation only. The dedicated temporary PostgreSQL is stopped after verification. See the bilingual development result.
