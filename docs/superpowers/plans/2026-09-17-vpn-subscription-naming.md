# VPN Subscription Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner name a Happ subscription when creating it, rename it later in Telegram, and deliver that title to Happ during refresh.

**Architecture:** Keep `vpn_subscriptions.label` as the sole stored name. `VpnCommandService` validates the label and exposes closed callback actions; `TelegramMenuService` owns one-time, owner/conversation/chat-scoped text input. `VpnSubscriptionService` emits Happ management headers from the persisted label without changing its URI-list or Sing-box JSON output.

**Tech Stack:** Node.js 20 CommonJS, Fastify, PostgreSQL, native `node:test`, Telegram Bot API callbacks.

**Spec:** `docs/superpowers/specs/2026-09-17-vpn-subscription-naming-design.md`

## Global Constraints

- New and renamed labels: trimmed, allowed characters only, 1–25 Unicode code points.
- Never rotate a subscription token or alter client IDs while naming or renaming.
- Update only `id + user_id + revoked_at IS NULL` with parameterized SQL.
- No subscription token, URL, password, or credential enters callback data, guided-input state, history answer, or logs.
- Happ metadata appears only on successful ordinary Base64 responses; `?format=sing-box` remains JSON.

---

### Task 1: Repository and Happ metadata

**Files:**
- Modify: `server/src/vpn/vpnSubscriptionRepository.js`
- Modify: `server/src/vpn/vpnSubscriptionService.js`
- Modify: `server/src/app.js`
- Test: `server/test/vpnSubscriptionService.test.js`
- Test: `server/test/vpnSubscriptionRoutes.test.js`

**Interfaces:**
- Produces `rename({ id, userId, label }) -> subscription | null`.
- Produces successful ordinary subscription results with `headers: { 'profile-title', 'profile-update-interval' }`.

- [x] Write tests that assert an owner-scoped rename updates only the label and that a Base64 subscription result has the Base64-encoded UTF-8 title and one-hour interval.
- [x] Run the focused tests and observe the missing method/header failure.
- [x] Implement `rename`, label helpers, and metadata propagation through the Fastify route.
- [x] Run `node --test test/vpnSubscriptionService.test.js test/vpnSubscriptionRoutes.test.js` from `server`.

### Task 2: Telegram creation and rename flow

**Files:**
- Modify: `server/src/vpn/vpnCommandService.js`
- Modify: `server/src/telegram/telegramMenuService.js`
- Test: `server/test/vpnSubscriptionCommand.test.js`
- Test: `server/test/telegramMenuService.test.js`

**Interfaces:**
- Consumes `validateSubscriptionLabel(value) -> string` and `renameSubscription({ id, userId, label }) -> subscription | null`.
- Produces `requestInput` kinds `vpn_subscription_create_label` and `vpn_subscription_rename_label`.

- [x] Write tests for closed rename callbacks, create/rename guided input, invalid retry, cancellation, and foreign/revoked rejection.
- [x] Run focused tests and observe the missing action/input failure.
- [x] Implement callbacks, view buttons, input consumption, validation, and human-readable Russian replies.
- [x] Run `node --test test/vpnSubscriptionCommand.test.js test/telegramMenuService.test.js` from `server`.

### Task 3: Regression verification and documentation

**Files:**
- Modify: `docs/README.md`
- Modify: `AGENTS.md`
- Test: `server/test/vpnSubscriptionService.test.js`
- Test: `server/test/vpnSubscriptionRoutes.test.js`
- Test: `server/test/vpnSubscriptionCommand.test.js`
- Test: `server/test/telegramMenuService.test.js`

- [x] Update current status documentation to state the confirmed subscription naming behavior and remaining Happ-device acceptance.
- [x] Run `npm test` from `server` and inspect `git diff --check`.
- [x] Commit the tested implementation with a conventional `feat(vpn)` message, push normally, deploy the server, and verify health plus safe production title-header code.
