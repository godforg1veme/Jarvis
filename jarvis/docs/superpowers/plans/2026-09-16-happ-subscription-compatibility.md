# Happ Subscription Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one Jarvis URL import and update all Happ-compatible servers, and make Telegram subscription navigation coherent.

**Architecture:** `GET /sub/:token` will return the ordinary Base64 subscription by default; Sing-box JSON becomes explicit through `?format=sing-box`. The Happ landing action uses the documented `happ://add/<encoded-url>` form. Telegram always renders a list of profiles before details.

**Tech Stack:** Node.js 20 CommonJS, Fastify, node:test, Telegram inline keyboards.

**Spec:** `docs/superpowers/specs/2026-09-16-happ-subscription-compatibility-design.md`

## Global Constraints

- Keep CommonJS and add no production dependency.
- Store only token hashes; do not put a production token or credential in output, tests, or docs.
- Preserve callback grammar and owner scoping.
- Do not select a response representation from an inferred User-Agent.
- Deploy committed code using the established staging/archive deploy path, never `git pull` in the dirty VPS tree.

---

### Task 1: Explicit profile representation

**Files:**
- Modify: `server/src/vpn/vpnSubscriptionService.js`
- Test: `server/test/vpnSubscriptionService.test.js`
- Test: `server/test/vpnSubscriptionRoutes.test.js`

**Interfaces:**
- Consumes: `resolveSubscription(token, { format })`.
- Produces: Base64 `text/plain` for the normal endpoint; Sing-box JSON only for `format: 'sing-box'`.

- [x] **Step 1: Add failing assertions**

```js
const plain = await service.resolveSubscription('sub_fixture', {});
assert.match(plain.contentType, /text\/plain/);
assert.ok(Buffer.from(plain.body, 'base64').toString('utf8').includes('vless://'));
const singbox = await service.resolveSubscription('sub_fixture', { format: 'sing-box' });
assert.equal(JSON.parse(singbox.body).outbounds[0].type, 'url-test');
```

- [x] **Step 2: Confirm current behavior fails**

Run: `node --test server/test/vpnSubscriptionService.test.js server/test/vpnSubscriptionRoutes.test.js`

Expected: a Happ-like User-Agent still causes JSON.

- [x] **Step 3: Implement explicit format handling**

```js
const wantsSingBox = String(format || '').toLowerCase() === 'sing-box';
return {
  status: 200,
  contentType: wantsSingBox ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
  body: wantsSingBox
    ? JSON.stringify(this.buildSingboxProfile({ nodes, probeSnapshots }))
    : this.buildBase64Profile({ nodes, probeSnapshots }),
};
```

- [x] **Step 4: Verify focused service and route tests pass**

Run: `node --test server/test/vpnSubscriptionService.test.js server/test/vpnSubscriptionRoutes.test.js`

### Task 2: Correct Happ landing URI

**Files:**
- Modify: `server/src/vpn/vpnSubscriptionService.js`
- Test: `server/test/vpnSubscriptionService.test.js`
- Test: `server/test/vpnSubscriptionRoutes.test.js`

**Interfaces:**
- Consumes: `renderHappLandingHtml({ token, label })`.
- Produces: the anchor and auto-launch target `happ://add/${encodeURIComponent(subUrl)}`; the manual field remains `subUrl`.

- [x] **Step 1: Add failing encoding assertion**

```js
assert.ok(html.includes('happ://add/https%3A%2F%2Fjarvis.rilora.ru%2Fsub%2Fsub_fixture'));
assert.equal(html.includes('happ://add/sub?url='), false);
```

- [x] **Step 2: Confirm current route test fails**

Run: `node --test server/test/vpnSubscriptionRoutes.test.js`

Expected: old `happ://add/sub?url=` string is present.

- [x] **Step 3: Implement correct URI generation**

```js
const subUrl = `${this.publicUrl}/sub/${encodeURIComponent(token)}`;
const happDeeplink = `happ://add/${encodeURIComponent(subUrl)}`;
```

- [x] **Step 4: Re-run landing tests**

Run: `node --test server/test/vpnSubscriptionRoutes.test.js`

### Task 3: Always-list Telegram navigation and copy

**Files:**
- Modify: `server/src/vpn/vpnCommandService.js`
- Test: `server/test/vpnSubscriptionCommand.test.js`

**Interfaces:**
- Consumes: `_renderSubscriptionMenu(context)` and `_renderSubscriptionView(id, context, existingSub)`.
- Produces: profile-selection buttons for one or more subscriptions; create/view/rotate text explains a single auto-refreshing profile URL.

- [x] **Step 1: Add failing one-profile menu test**

```js
const menu = await service.handleCallback({ data: 'vpn:sub:menu', userId: '100' });
assert.match(menu.answer, /Ваши умные подписки/i);
assert.equal(menu.buttons[0][0].data, 'vpn:sub:view:11111111-2222-3333-4444-555555555555');
```

- [x] **Step 2: Confirm direct-card behavior fails**

Run: `node --test server/test/vpnSubscriptionCommand.test.js`

Expected: one profile currently returns its detail card.

- [x] **Step 3: Implement always-list menu and shared copy**

```js
answer: `📲 **Ваши умные подписки (${subs.length}):**\n\n` +
  'Каждая ссылка добавляет все совместимые серверы одного профиля. Happ обновляет этот список по той же ссылке.',
buttons: [
  ...subs.map((sub) => [{ text: `📱 ${sub.label}`, data: `vpn:sub:view:${sub.id}` }]),
  [{ text: '➕ Новая подписка', data: 'vpn:sub:new' }],
  [{ text: '« Главное меню', data: 'vpn:menu' }],
],
```

Update the creation, detail, and rotation copy to name the HTTPS URL “ссылка для Happ”, say it includes all compatible servers, and say token rotation invalidates the previous URL.

- [x] **Step 4: Verify command regression tests**

Run: `node --test server/test/vpnSubscriptionCommand.test.js`

### Task 4: End-to-end contract review, docs, and deployment

**Files:**
- Create: `docs/updates/2026-09-16-happ-subscription-compatibility.md`
- Test: `server/test/vpnSubscriptionCommand.test.js`
- Test: `server/test/vpnSubscriptionRoutes.test.js`
- Test: `server/test/vpnSubscriptionService.test.js`

**Interfaces:**
- Consumes: `/vpn`, `/vpn_sub`, `/vpn_subscriptions`, `vpn:sub:*`, `/sub/:token`, and `/happ-sub/:token`.
- Produces: tested, documented, committed, pushed, deployed behavior.

- [x] **Step 1: Add command-entry regression coverage**

```js
for (const text of ['/vpn_sub', '/vpn_subscriptions']) {
  const result = await service.handle({ text, userId: '100' });
  assert.match(result.answer, /подписк/i);
}
```

- [x] **Step 2: Run focused tests**

Run: `node --test server/test/vpnSubscriptionCommand.test.js server/test/vpnSubscriptionRoutes.test.js server/test/vpnSubscriptionService.test.js server/test/vpnSubscriptionRepository.test.js`

Expected: PASS.

- [x] **Step 3: Write a verified update entry**

```markdown
`/sub/:token` is one auto-refreshing Happ subscription URL containing all
Happ-compatible endpoints; `/happ-sub/:token` opens it using
`happ://add/<encoded-url>`. Telegram always opens the profile list first.
```

- [x] **Step 4: Run full server regression and inspect staged diff**

Run: `cd server; npm test`

Expected: PASS. Confirm `git diff --cached` contains no real token, URI credential, or deployment secret.

- [x] **Step 5: Commit, push, deploy, and verify**

```powershell
git commit -m "fix(vpn): make Happ subscriptions importable"
git push origin main
```

Deploy the commit through the existing staging/archive mechanism on `jarvis-vps`, then run `docker compose ps` in `/home/deploy/apps/jarvis/deploy` and `curl --fail --silent --show-error https://jarvis.rilora.ru/health/ready`.

## Self-review

- Tasks 1–2 implement the response and deeplink contract; Task 3 covers all Telegram subscription states; Task 4 covers commands, docs, test suite, commit, push, and deployment.
- No placeholder or inconsistent interface remains.
