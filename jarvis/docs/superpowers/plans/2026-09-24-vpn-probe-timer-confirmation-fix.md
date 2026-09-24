# VPN Probe Timer Confirmation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing owner-only timer enable/disable Telegram buttons reach normal confirmation with empty action arguments.

**Architecture:** Keep the closed callbacks and strict `validateAction` unchanged. In `VpnCommandService._create`, special-case timer actions before adding protocol/node defaults. Test the real callback-to-confirmation creation path, then deploy only the server source and test.

**Tech Stack:** Node.js CommonJS, built-in `node:test`, Docker Compose server on DE.

**Spec:** `docs/superpowers/specs/2026-09-24-vpn-probe-timer-confirmation-fix-design.md`

## Global Constraints

- Preserve owner authorization and originating Telegram conversation/channel/device confirmation.
- Keep `probe.enable` and `probe.disable` arguments exactly `{}`; reject non-empty arguments.
- Do not change menu labels, callbacks, visibility, Host Agent operations, credentials, or timer cadence.
- Do not enable timers from SSH; only an owner-confirmed Telegram action may do so.

---

### Task 1: Repair timer confirmation creation

**Files:**
- Modify: `server/test/vpnCommandService.test.js`
- Modify: `server/src/vpn/vpnCommandService.js` (`_create`)

**Interfaces:**
- Consumes: `VpnCommandService.handleCallback(context)` and `validateAction(action, args)`.
- Produces: `probe.enable`/`probe.disable` action records with empty `arguments` and normal `vpn:confirm:<uuid>` controls.

- [ ] **Step 1: Write the failing test.** For each callback `vpn:probe:enable` and `vpn:probe:disable`, call `handleCallback` in an owner private Telegram context. Assert `record.arguments` is `{}`, a confirmation button is returned, and no Host Agent `request` call occurs.
- [ ] **Step 2: Run `node --test test/vpnCommandService.test.js`.** The new test must fail with `VPN_ACTION_INVALID` before the fix.
- [ ] **Step 3: In `_create`, set `rawArgs = { ...command.arguments }` for the two timer actions; keep the existing protocol/node enrichment for all other actions.** Do not change `validateAction`.
- [ ] **Step 4: Run the focused test, required Telegram suite from `docs/telegram-menu-contract.md`, and full `npm test` in `server/`.** All must pass. Check `git diff --check`.
- [ ] **Step 5: Commit only the narrow source/test change.** Preserve unrelated dirty-worktree edits.

### Task 2: Deploy and accept the owner action

**Files:**
- Modify: `docs/updates/2026-09-24-vpn-hysteria2-probe-button-fix.md` or add a dedicated timer-fix rollout record.
- Modify: `docs/README.md` and `AGENTS.md` only if verified status changes.

**Interfaces:**
- Consumes: fixed server image, existing `hasVerifiedProbeBindings()` gate, existing `ProbeCredentialWorkflow.enable()`.
- Produces: healthy production server and, after owner confirmation, two active/enabled timer units.

- [ ] **Step 1: Verify running image/source match and preserve the prior source/image for rollback.** Stage only the changed source/test and run production preflight.
- [ ] **Step 2: Build the candidate server image, run focused tests inside it, deploy via Compose, and verify Compose health plus public smoke.** No timer action during deployment.
- [ ] **Step 3: Ask owner for one fresh private Telegram enable confirmation.** Query the durable `probe.enable` row and inspect `jarvis-vpn-probe@de.timer` on NL and `jarvis-vpn-probe@nl.timer` on DE. If outcome is unknown, reconcile original request; never blindly retry.
- [ ] **Step 4: Record actual production and owner-client results, including both timer states.** Keep any unverified Supervisor repair or NL certificate work explicitly pending.
