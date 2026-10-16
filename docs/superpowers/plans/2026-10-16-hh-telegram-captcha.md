# HH Telegram CAPTCHA implementation plan

> Execute task by task using the available subagents for independent browser,
> server and deployment work. Root owns integration, review and authorized release.

**Goal:** Deliver HH CAPTCHA pictures and human replies through Telegram and
remove all HH-specific Tailscale/noVNC components.

**Architecture:** Existing owner-bound coordinator pauses collection. A headless
browser exposes a separate authenticated private CAPTCHA broker; server persists
photo/reply lifecycle and intercepts explicit replies before dialogue/AI.

**Tech Stack:** CommonJS, existing Playwright/grammy/pg, PostgreSQL migration;
no new production dependency.

**Spec:** [approved scenario and exact contracts](../specs/2026-10-16-hh-telegram-captcha-design.md).

## Global constraints

Private owner/chat/conversation binding; reply-to-photo is submit authorization.
Never resend unknown answer/delivery under a new ID. No CAPTCHA text/PNG/hidden
state in DB, dialogue, memory, prompts or diagnostics. Picture <=256KiB,
1024×256, expiry10min; manual pause has no TTL. Existing profile/claims preserved.
No host ports, VNC or HH Tailscale URL. Keep all unrelated Tailscale/VPN uses.

### Task 1: Browser broker and headless CAPTCHA interaction

**Owner/files:** browser subagent owns `job-browser/` entirely; read spec RPC.
**Consumes:** existing manualState/coordinator/captchaProtocol/dispatch guards.
**Produces:** status/challenge/answer `/rpc` on8082 with separate CAPTCHA token.

- [x] Write failing HTTP/Chromium cases for picture binding, expiry, answer
  normalization, duplicate/unknown/stale/restart, readonly success verification.
- [x] Implement bounded snapshot/native submit and durable before-POST claim;
  broker closed grammar, errors and distinct credentials. Preserve old state.
- [x] Headless runtime, no display/VNC/WS. Delete obsolete browser files/tests
  and dependency entries; adjust image/README and Linux acceptance helpers.
- [x] Run Linux unit + real Chromium/runtime acceptance, report exact results.

### Task 2: Server/photo outbox/reply routing

**Owner/files:** server subagent owns `server/` entirely, including migrations,
bot/runtime wiring and tests. Does not edit root docs/deploy/browser.
**Consumes:** spec RPC wire, existing jobs/Telegram update claim/owner policy.
**Produces:** owner-only photo delivery, scoped replies, refresh/menu control.

- [x] Write migration and real-PG tests for atomic message binding/delivery
  unknown/reply consumption/replay/foreign scope/invalid retry/stale.
- [x] Implement bounded CAPTCHA client, repository/service/worker, media send,
  pre-history reply routing and new closed callback grammar. No guided kind.
- [x] Remove manual URL settings, old URL button/gate/runtime options and tests;
  wire CAPTCHA feature/token only server+browser. Preserve other jobs behavior.
- [x] Focused Telegram gate, full server suite and real-PG acceptance.

### Task 3: Deployment packaging and retirement preparation

**Owner/files:** deploy subagent owns `deploy/` and deletion of `job-manual/`.
No edits to server/browser/root docs. Root deploys actual VPS.
**Consumes:** new env flag/token and private8082 in existing RPC network.

- [x] Compose/env remove HH manual service/network/port/settings; add CAPTCHA
  shared flag server/browser/collector and token only server/browser.
  Collector never has token.
- [x] Remove HH systemd proxy and old manual policy scripts/tests; replace
  with focused config tests for no ports/gateway and credential distribution.
- [x] Update deploy README including guarded removal of only `/hh/`, old
  HH socket/service/launcher, private gateway and empty network; no TS reset.
- [x] Run config tests and normalized Compose with placeholders/no secrets.

### Task 4: Root integration and authorized release

- [x] Reconcile exact broker/client wire and missing error/unknown paths.
  Review user text privacy and before-POST durable consumption end to end.
- [x] Update Telegram contract/change notice and living docs; mark old dated
  documents superseded. Followup regression/review only for material findings.
- [x] Fresh branches/worktrees/PR audit, tests/diff, publish accepted main.
  Immediately sync both VPS and source guards, stage immutable DE release.
- [x] Check owner/profile/env and existing Serve config privately. Install
  server/browser/collector; remove only HH gateway/proxy/Serve route/network.
  Preserve other services, original HH progress, profile and claims.
- [x] Verify hashes/health/actual no-ports/no HH TS remnants and real owner photo
  delivery. Record remaining checks candidly.
- [x] Human reply acceptance and confirmed collection resumption: owner confirmed
  success on 16 October 2026; scoped read verified solved/idle, active collection,
  page 15→18 and sent cards 583→602. See the dated release record.
