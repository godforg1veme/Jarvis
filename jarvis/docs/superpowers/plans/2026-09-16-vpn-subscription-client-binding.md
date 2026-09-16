# VPN Subscription Client Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind every subscription to four dedicated client IDs while keeping its Happ URL stable across normal refreshes.

**Architecture:** A new confirmed `subscription.repair` VPN action issues dedicated DE/NL VLESS and Hysteria clients and persists only protocol-to-client-ID JSON in the existing subscription fields. Subscription export accepts only complete persisted bindings and fails closed otherwise. Telegram exposes repair only for incomplete profiles.

**Tech Stack:** Node.js 20 CommonJS, Fastify, PostgreSQL, Host Agent closed operations, node:test, Telegram inline callbacks.

**Spec:** `docs/superpowers/specs/2026-09-16-vpn-subscription-client-binding-design.md`

## Global Constraints

- Normal Happ refreshes must keep the subscription URL, token, and client IDs unchanged.
- Client issue and revoke remain origin-bound owner-confirmed Host Agent mutations.
- Never send or persist a VLESS/Hysteria URI, UUID, password, or token in action metadata, logs, database rows, or Telegram text.
- Persist only validated opaque `vpn-<12 hex>` client IDs in `client_id_de` and `client_id_nl`.
- An unbound subscription must fail closed; never export a guessed or first client.

---

### Task 1: Persist and validate complete subscription bindings

**Files:**
- Modify: `server/src/vpn/vpnSubscriptionRepository.js`
- Modify: `server/src/vpn/vpnSubscriptionService.js`
- Test: `server/test/vpnSubscriptionRepository.test.js`
- Test: `server/test/vpnSubscriptionService.test.js`

**Interfaces:**
- Produces `bindClients({ id, userId, clientIdDe, clientIdNl })` and `hasCompleteClientBinding(record)`.
- `resolveSubscription()` returns `SUBSCRIPTION_CLIENT_BINDING_REQUIRED` without exporting credentials when either node mapping lacks `hy2` or `vless`.

- [ ] **Step 1: Add failing repository and export tests**

```js
await repo.bindClients({ id: 'sub-1', userId: 'owner', clientIdDe: { hy2: 'vpn-aaaaaaaaaaaa', vless: 'vpn-bbbbbbbbbbbb' }, clientIdNl: { hy2: 'vpn-cccccccccccc', vless: 'vpn-dddddddddddd' } });
assert.equal(await service.resolveSubscription('sub_unbound'), { status: 503, code: 'SUBSCRIPTION_CLIENT_BINDING_REQUIRED' });
```

- [ ] **Step 2: Implement exact ID persistence and fail-closed export**

```js
await this.pool.query('UPDATE vpn_subscriptions SET client_id_de=$1,client_id_nl=$2 WHERE id=$3 AND user_id=$4 AND revoked_at IS NULL', [JSON.stringify(clientIdDe), JSON.stringify(clientIdNl), id, userId]);
```

Validate `hy2` and `vless` IDs before writing. Remove `clients[0]` and label-match export fallbacks; export only mapped IDs.

- [ ] **Step 3: Run binding service tests**

Run: `node --test server/test/vpnSubscriptionRepository.test.js server/test/vpnSubscriptionService.test.js`

### Task 2: Implement confirmed four-client repair workflow

**Files:**
- Modify: `server/src/vpn/vpnCommandService.js`
- Modify: `server/src/vpn/vpnSubscriptionService.js`
- Test: `server/test/vpnSubscriptionCommand.test.js`

**Interfaces:**
- Consumes a confirmed `vpn:sub:repair:<subscription UUID>` callback.
- Produces one `subscription.repair` action record, four dedicated Host Agent `client.issue` calls, and one complete stored binding.

- [ ] **Step 1: Add failing confirmation and repair tests**

```js
const prompt = await service.handleCallback({ data: `vpn:sub:repair:${subscriptionId}`, userId: '100', originChannel: 'telegram' });
assert.equal(prompt.buttons[0][0].data.startsWith('vpn:confirm:'), true);
const result = await service.handleCallback({ data: prompt.buttons[0][0].data, userId: '100', originChannel: 'telegram' });
assert.equal(result.answer.includes('обновите подписку в Happ'), true);
assert.deepEqual(boundIds, { de: { hy2: 'vpn-aaaaaaaaaaaa', vless: 'vpn-bbbbbbbbbbbb' }, nl: { hy2: 'vpn-cccccccccccc', vless: 'vpn-dddddddddddd' } });
```

- [ ] **Step 2: Add closed callback/action support**

Parse only `vpn:sub:repair:<UUID>`, add it to Telegram callback validation, and create an owner/origin-scoped request whose action is `subscription.repair` and argument is only `subscriptionId`.

- [ ] **Step 3: Issue dedicated clients after approval**

```js
const clientId = await issueBoundClient({ node, protocol, label, requestId });
// node/protocol: de/hysteria2, de/vless, nl/hysteria2, nl/vless
await subscriptionService.bindClientIds({ subscriptionId, userId, clientIds });
```

Use one unique Host Agent request ID per operation. Derive a non-secret unique label from the subscription ID. Record only operation/node/protocol/client-ID progress in the action request result.

- [ ] **Step 4: Compensate known partial work and preserve unknown outcomes**

On a definite later failure, call closed `client.revoke` only for client IDs created in this action; mark the parent request failed. On transport/unknown result, mark the parent request unknown and do not create a replacement client.

- [ ] **Step 5: Run command tests**

Run: `node --test server/test/vpnSubscriptionCommand.test.js`

### Task 3: Clarify Telegram UX and verify all routes

**Files:**
- Modify: `server/src/vpn/vpnCommandService.js`
- Test: `server/test/vpnSubscriptionCommand.test.js`
- Test: `server/test/telegramBot.test.js` when present, otherwise `server/test/telegramFormatting.test.js`

**Interfaces:**
- Complete profiles show Happ refresh guidance.
- Incomplete profiles show only `Восстановить доступы` and do not promise usable servers.

- [ ] **Step 1: Add failing detail-view tests**

```js
assert.equal(unbound.buttons[0][0].data, `vpn:sub:repair:${subscriptionId}`);
assert.match(bound.answer, /обновите подписку в Happ/i);
```

- [ ] **Step 2: Implement precise copy and buttons**

Render ordinary Happ refresh separately from repair. Keep URL/token rotation as a distinct intentional action.

- [ ] **Step 3: Run focused route tests**

Run: `node --test server/test/vpnSubscriptionCommand.test.js server/test/vpnSubscriptionRoutes.test.js`

### Task 4: Document, regress, deploy, and repair the owner profile

**Files:**
- Create: `docs/updates/2026-09-16-vpn-subscription-client-binding.md`
- Test: `server/test/vpnSubscriptionCommand.test.js`
- Test: `server/test/vpnSubscriptionService.test.js`

- [ ] **Step 1: Record the stable-Happ and bound-client contract**

```markdown
Happ refreshes the same subscription URL. Repair is an explicit owner-confirmed
four-client provisioning workflow; it preserves the URL and stores only opaque
client IDs.
```

- [ ] **Step 2: Run full server tests and inspect the staged diff**

Run: `cd server; npm test`

Expected: PASS with no URI, token, password, UUID, or production credential in the diff.

- [ ] **Step 3: Commit, push, and deploy only the server source changes**

```powershell
git commit -m "fix(vpn): bind subscription clients explicitly"
git push origin main
```

Create a rollback archive of the exact changed server modules on `jarvis-vps`, copy only those modules, rebuild `docker compose up -d --build server`, and verify `/health/ready`.

- [ ] **Step 4: Request the owner confirmation in Telegram**

Open `/vpn` → subscription list → `Мой телефон` → `Восстановить доступы` and confirm from that same Telegram client. Then refresh the unchanged subscription in Happ and verify traffic manually.

## Self-review

- Tasks 1–2 enforce exact binding and safe mutation; Task 3 covers all visible paths; Task 4 covers docs, regression, deployment, and required manual owner confirmation.
- All interfaces and operation names are explicit; no untrusted client selection remains.
