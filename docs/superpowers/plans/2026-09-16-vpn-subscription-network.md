# Jarvis VPN Smart Subscription Network Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a resilient dynamic VPN subscription service for Jarvis that serves client-aware Smart Sing-box JSON with Hysteria 2 Port Hopping (`20000-50000`), multi-node failover (DE + NL), Russian split-routing, and 1-click Happ onboarding.

**Architecture:** Fastify exposes tokenized endpoints (`/sub/:token` and `/happ-sub/:token`). The controller verifies high-entropy token hashes in PostgreSQL (`vpn_subscriptions`), queries real-time node reachability from the newly deployed `ExternalProbeMonitor`, retrieves active credentials from Host Agent, and compiles a Sing-box JSON profile featuring an automatic `url-test` failover group (DE Hysteria 2 -> NL Hysteria 2 -> DE VLESS 8443 -> NL VLESS 8443) with fallback to Base64 URI lists for generic clients. Linux kernel DNAT/REDIRECT rules on DE and NL VPS nodes enable continuous UDP port hopping across ports 20000–50000.

**Tech Stack:** Node.js (CommonJS, Fastify, Zod, pg/PostgreSQL), Python 3 (Host Agent), iptables/UFW, Sing-box / Happ wire format.

**Spec:** [`docs/superpowers/specs/2026-09-16-vpn-subscription-network-design.md`](file:///f:/test/jarvis/docs/superpowers/specs/2026-09-16-vpn-subscription-network-design.md)

## Global Constraints

- Never persist raw tokens, VLESS URIs, or Hysteria passwords in PostgreSQL, git, logs, or chat messages.
- Subscriptions are strictly owner- and device-scoped; family members access only their own subscriptions.
- Keep CommonJS in Node.js server modules.
- Preserve Russian direct routing (`.ru`, `.su`, `geosite:category-ru`, `geoip:ru`, private IPs).
- Existing direct key issuance and cross-node probe workflows must remain intact.

---

## File Structure

- Create: `server/src/db/migrations/022_vpn_subscriptions.sql` — PostgreSQL migration for subscription records.
- Modify: `server/test/migrations.test.js` — validates migration 022 execution and rollback.
- Create: `server/src/vpn/vpnSubscriptionRepository.js` — data access layer for `vpn_subscriptions`.
- Create: `server/test/vpnSubscriptionRepository.test.js` — unit tests for subscription repository.
- Create: `server/src/vpn/vpnSubscriptionService.js` — profile builder (Sing-box JSON, Base64 URI list), landing bridge, and probe status integration.
- Create: `server/test/vpnSubscriptionService.test.js` — unit tests for profile generation, priority hierarchy, port hopping syntax, and probe downgrades.
- Modify: `server/src/vpn/vpnCommandService.js` — Telegram bot `/vpn` menu handler with «📲 Моя подписка» navigation.
- Modify: `server/test/vpnCommandService.test.js` — unit tests for Telegram subscription callbacks and views.
- Create: `deploy/vpn/setup-port-hopping.sh` — root script to configure iptables DNAT/REDIRECT and UFW rules on DE and NL nodes.

---

### Task 1: Database Migration for Subscriptions (`022_vpn_subscriptions.sql`)

**Files:**
- Create: `server/src/db/migrations/022_vpn_subscriptions.sql`
- Modify: `server/test/migrations.test.js`

**Interfaces:**
- Consumes: PostgreSQL schema migrations runner.
- Produces: `vpn_subscriptions` table with `id`, `user_id`, `label`, `token_hash`, `client_id_de`, `client_id_nl`, `created_at`, `revoked_at`, `last_accessed_at`, `created_by`.

- [ ] **Step 1: Write migration `022_vpn_subscriptions.sql`**

```sql
CREATE TABLE IF NOT EXISTS vpn_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    label TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    client_id_de TEXT,
    client_id_nl TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    last_accessed_at TIMESTAMPTZ,
    created_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vpn_subscriptions_token_hash 
    ON vpn_subscriptions(token_hash) 
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vpn_subscriptions_user 
    ON vpn_subscriptions(user_id, created_at DESC);
```

- [ ] **Step 2: Update `server/test/migrations.test.js`**

Add `022_vpn_subscriptions.sql` to the migration files list and assert table existence.

- [ ] **Step 3: Run migration tests**

Run: `node --test server/test/migrations.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/src/db/migrations/022_vpn_subscriptions.sql server/test/migrations.test.js
git commit -m "feat(vpn): add subscription persistence migration 022"
```

---

### Task 2: Subscription Repository Layer (`vpnSubscriptionRepository.js`)

**Files:**
- Create: `server/src/vpn/vpnSubscriptionRepository.js`
- Create: `server/test/vpnSubscriptionRepository.test.js`

**Interfaces:**
- Consumes: `pg.Pool` or mock client.
- Produces: `VpnSubscriptionRepository` with methods:
  - `create({ userId, label, tokenHash, clientIdDe, clientIdNl, createdBy }) -> Promise<SubscriptionRecord>`
  - `findActiveByTokenHash(tokenHash) -> Promise<SubscriptionRecord | null>`
  - `listByUser(userId) -> Promise<SubscriptionRecord[]>`
  - `touchLastAccessed(id) -> Promise<void>`
  - `revoke({ id, userId }) -> Promise<boolean>`

- [ ] **Step 1: Write unit tests in `server/test/vpnSubscriptionRepository.test.js`**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { VpnSubscriptionRepository } = require('../src/vpn/vpnSubscriptionRepository');

test('VpnSubscriptionRepository creates and finds active subscription by hash', async () => {
  const rows = [];
  const pool = {
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO vpn_subscriptions')) {
        const record = { id: 'test-sub-1', user_id: params[0], label: params[1], token_hash: params[2], client_id_de: params[3], client_id_nl: params[4], created_by: params[5], created_at: new Date(), revoked_at: null, last_accessed_at: null };
        rows.push(record);
        return { rows: [record] };
      }
      if (sql.includes('SELECT') && sql.includes('token_hash = $1')) {
        const found = rows.find(r => r.token_hash === params[0] && !r.revoked_at);
        return { rows: found ? [found] : [] };
      }
      return { rows: [] };
    }
  };
  const repo = new VpnSubscriptionRepository({ pool });
  const created = await repo.create({ userId: 'u1', label: 'iPhone', tokenHash: 'hash123', clientIdDe: 'c-de', clientIdNl: 'c-nl', createdBy: 'u1' });
  assert.equal(created.id, 'test-sub-1');
  const active = await repo.findActiveByTokenHash('hash123');
  assert.equal(active.label, 'iPhone');
  const missing = await repo.findActiveByTokenHash('unknown');
  assert.equal(missing, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/vpnSubscriptionRepository.test.js`
Expected: FAIL ("cannot find module")

- [ ] **Step 3: Implement `server/src/vpn/vpnSubscriptionRepository.js`**

Implement parameterized queries with strict field validation and zero credential leaks.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test/vpnSubscriptionRepository.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/vpn/vpnSubscriptionRepository.js server/test/vpnSubscriptionRepository.test.js
git commit -m "feat(vpn): implement subscription repository layer"
```

---

### Task 3: Subscription Generator & Probe Integration (`vpnSubscriptionService.js`)

**Files:**
- Create: `server/src/vpn/vpnSubscriptionService.js`
- Create: `server/test/vpnSubscriptionService.test.js`

**Interfaces:**
- Consumes: `VpnSubscriptionRepository`, `ExternalProbeMonitor`, `hostAgentProtocol`.
- Produces: `VpnSubscriptionService` methods:
  - `generateToken() -> { token: string, tokenHash: string }`
  - `buildSingboxProfile({ deHy2, nlHy2, deVless, nlVless, probeSnapshot }) -> object`
  - `buildBase64Profile({ deHy2, nlHy2, deVless, nlVless }) -> string`
  - `renderHappLandingHtml({ token, label }) -> string`
  - `resolveSubscription(token, userAgent) -> Promise<{ status: number, contentType: string, body: string }>`

- [ ] **Step 1: Write comprehensive unit tests in `server/test/vpnSubscriptionService.test.js`**

Test cases:
1. Token generation produces 32-byte hex string with `sub_` prefix and SHA-256 hash.
2. `buildSingboxProfile` generates `url-test` outbound group with exact priority:
   - Index 0: `🇩🇪 DE Hysteria 2` with `ports: "20000-50000"`, `hop_interval: "30s"`.
   - Index 1: `🇳🇱 NL Hysteria 2` with `ports: "20000-50000"`, `hop_interval: "30s"`.
   - Index 2: `🇩🇪 DE VLESS 8443`.
   - Index 3: `🇳🇱 NL VLESS 8443`.
3. In-profile routing rules route `.ru`, `.su`, `geosite:category-ru`, `geoip:ru` to `direct`.
4. If `ExternalProbeMonitor` reports a check as `failed`, the node is appropriately demoted or excluded.
5. Base64 profile output contains correct URI schemes and port ranges.
6. User-Agent detection routes Happ/Sing-box to JSON and others to Base64.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/vpnSubscriptionService.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `server/src/vpn/vpnSubscriptionService.js`**

Implement builder functions, landing HTML template, and probe-aware profile assembler.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test/vpnSubscriptionService.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/vpn/vpnSubscriptionService.js server/test/vpnSubscriptionService.test.js
git commit -m "feat(vpn): implement smart subscription builder and probe integration"
```

---

### Task 4: Fastify Endpoints & Public Routes

**Files:**
- Modify: `server/src/vpn/vpnRoutingService.js` (or register routes in server root)
- Create: `server/test/vpnSubscriptionRoutes.test.js`

**Interfaces:**
- Consumes: Fastify instance, `VpnSubscriptionService`.
- Produces:
  - `GET /sub/:token` -> returns Sing-box JSON or Base64 URI list.
  - `GET /happ-sub/:token` -> returns HTML landing page for 1-click import.

- [ ] **Step 1: Write route integration tests in `server/test/vpnSubscriptionRoutes.test.js`**

Verify `200 OK` with `application/json` for Happ User-Agent, `text/plain` for generic User-Agent, and `404 Not Found` for invalid/revoked tokens.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/vpnSubscriptionRoutes.test.js`
Expected: FAIL

- [ ] **Step 3: Wire Fastify route handlers**

Register `/sub/:token` and `/happ-sub/:token` in the Fastify server application.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test/vpnSubscriptionRoutes.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/vpn/vpnSubscriptionRoutes.js server/test/vpnSubscriptionRoutes.test.js server/src/app.js
git commit -m "feat(vpn): register public subscription and landing routes"
```

---

### Task 5: Telegram Bot «📲 Моя подписка» Integration (`vpnCommandService.js`)

**Files:**
- Modify: `server/src/vpn/vpnCommandService.js`
- Modify: `server/test/vpnCommandService.test.js`

**Interfaces:**
- Consumes: Telegram button callbacks (`vpn:sub:menu`, `vpn:sub:create`, `vpn:sub:rotate`, `vpn:sub:revoke`).
- Produces: Inline keyboards with «🚀 Активировать в Happ» URL buttons, subscription status, and token lifecycle management.

- [ ] **Step 1: Write test cases in `server/test/vpnCommandService.test.js`**

Verify that:
1. `/vpn` menu renders the top-level button «📲 Моя подписка (1 клик)».
2. Callback `vpn:sub:menu` displays active subscriptions and action buttons.
3. Callback `vpn:sub:create` issues tokens across DE & NL nodes.
4. Revocation action disables the token immediately.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/vpnCommandService.test.js`
Expected: FAIL

- [ ] **Step 3: Implement subscription handlers in `vpnCommandService.js`**

Wire `_subscriptionMenu`, `_subscriptionCreate`, `_subscriptionRevoke` handlers and button schemas.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test/vpnCommandService.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/vpn/vpnCommandService.js server/test/vpnCommandService.test.js
git commit -m "feat(vpn): add telegram subscription button controls and lifecycle"
```

---

### Task 6: Linux Kernel Port Hopping Deployment Script

**Files:**
- Create: `deploy/vpn/setup-port-hopping.sh`

**Interfaces:**
- Consumes: Node VPN IP (`87.120.187.109` for DE, `94.183.208.56` for NL).
- Produces: Active iptables DNAT/REDIRECT rule and persistent UFW allowance for UDP `20000:50000`.

- [ ] **Step 1: Write `deploy/vpn/setup-port-hopping.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

VPN_IP="${1:-87.120.187.109}"
PORT_RANGE="20000:50000"
TARGET_PORT="443"

echo "Configuring Hysteria 2 Port Hopping for IP ${VPN_IP}..."

# 1. Allow UDP port range in UFW
ufw allow proto udp from any to "${VPN_IP}" port ${PORT_RANGE} comment "Hysteria2 Port Hopping"

# 2. Add iptables PREROUTING REDIRECT rule if not already present
if ! iptables -t nat -C PREROUTING -d "${VPN_IP}" -p udp --dport ${PORT_RANGE} -j REDIRECT --to-ports ${TARGET_PORT} 2>/dev/null; then
    iptables -t nat -A PREROUTING -d "${VPN_IP}" -p udp --dport ${PORT_RANGE} -j REDIRECT --to-ports ${TARGET_PORT}
    echo "Added iptables REDIRECT rule for ${PORT_RANGE} -> ${TARGET_PORT}"
else
    echo "iptables REDIRECT rule already exists"
fi

# 3. Persist iptables rules
if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save
fi

echo "Port Hopping setup complete."
```

- [ ] **Step 2: Commit deployment script**

```bash
git add deploy/vpn/setup-port-hopping.sh
git commit -m "feat(vpn): add port hopping kernel setup script"
```

---

### Task 7: End-to-End Regression & Acceptance

**Files:**
- Run full server test suite.
- Verify `docs/README.md` and `AGENTS.md` documentation alignment.

- [ ] **Step 1: Run full server test suite**

Run: `cd server && npm test`
Expected: ALL PASS

- [ ] **Step 2: Verify preflight checks**

Run: `bash deploy/scripts/preflight.sh` (or local equivalent)

- [ ] **Step 3: Update documentation**

Update `AGENTS.md` and `docs/README.md` with the new subscription service capability, port hopping range, and migration 022.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs/README.md
git commit -m "docs(vpn): record smart subscription network and port hopping capability"
```
