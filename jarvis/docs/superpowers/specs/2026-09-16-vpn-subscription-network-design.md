# Jarvis VPN Smart Subscription Network Design

Date: 2026-09-16
Status: approved design; ready for implementation planning

## Context and Problem Statement

On 2026-09-16 at approximately 16:26 MSK (13:26 UTC), Russian ISPs (including MGTS/MTS and Beeline) began dropping UDP packets for Hysteria 2 connections destined for port 443 of the secondary VPS IP (`87.120.187.109`). While initial QUIC handshake packets completed, all subsequent payload packets were dropped by ISP DPI/TSPU filters, causing connections to idle-timeout every 30 seconds (`timeout: no recent network activity`, `tx: 0`).

Simultaneously, client devices configured with static single-link imports (`hy2://...` or `vless://...`) were left stranded:
1. Static imports in Happ (and other proxy clients) do not support the **«Обновить» (Update)** button because they lack a remote Subscription URL.
2. If a single port or protocol is blocked by TSPU, the user loses internet access until an administrative intervention manually issues and distributes an alternative key.
3. While `Owner-iPhone` was able to manually switch to VLESS on TCP port 8443, other family members (such as `Iphone Сеня`) had only Hysteria 2 active and remained in an infinite disconnect loop.
4. Furthermore, VLESS over TCP REALITY frequently suffers from throttling, TCP reset, and packet latency spikes across Russian networks, making Hysteria 2 the preferred primary transport whenever UDP is unblocked.

To achieve continuous, zero-touch resilience against censorship, Jarvis requires a **Smart Dynamic Subscription Network** with Hysteria 2 Port Hopping, multi-node failover, and client-side automatic switching (`url-test`).

---

## Goals

1. **Dynamic Subscription Endpoint (`GET /sub/:token`):**
   * Provide an authenticated, high-entropy tokenized endpoint serving current node configurations to Happ, Sing-box, and standard proxy clients.
   * Enable the native **«Обновить» (Update)** button and background periodic refresh in Happ.
2. **1-Click Mobile Activation Bridge (`GET /happ-sub/:token`):**
   * Render a browser landing bridge that triggers `happ://add/sub?url=...` for zero-friction iOS/Android onboarding.
3. **Hysteria 2 Port Hopping (DE & NL):**
   * Configure a UDP port range (`20000:50000`) redirected to port 443 on the VPS kernel level (`iptables` / `nftables` DNAT/REDIRECT).
   * Distribute client configurations with `ports: "20000-50000"` and `hop_interval: "30s"`, preventing TSPU from locking onto any single UDP 5-tuple.
4. **Strict Protocol Priority with Zero-Touch Failover:**
   * Configure client auto-failover (`url-test` / fallback) with the exact hierarchy:
     1. `🇩🇪 Германия — Hysteria 2` (Port Hopping `20000-50000`, Salamander obfs) — Primary low-latency transport.
     2. `🇳🇱 Нидерланды — Hysteria 2` (Port Hopping `20000-50000`, Salamander obfs) — Secondary low-latency transport.
     3. `🇩🇪 Германия — VLESS REALITY` (TCP port `8443`) — Primary fallback when UDP is completely suppressed.
     4. `🇳🇱 Нидерланды — VLESS REALITY` (TCP port `8443`) — Secondary fallback.
5. **Integrated Split Routing (Обход РФ):**
   * Bake domestic Russian direct exceptions (`.ru`, `.su`, `geosite:category-ru`, `geoip:ru`, private IPs) directly into the subscription profile, eliminating the need for a separate routing file import.
6. **Client-Aware Response Formats:**
   * Return Sing-box JSON with auto-failover groups for Happ and Sing-box User-Agents.
   * Return standard Base64-encoded URI lists for third-party or legacy clients (`v2rayN`, `Shadowrocket`, `Hiddify`).
7. **Strict Security Boundaries (`AGENTS.md`):**
   * Store only SHA-256 hashes of subscription tokens in PostgreSQL; raw tokens are never persisted in the database, logs, or chat history.
   * Subscription tokens are scoped per device/user.
   * Instant revocation: revoking a subscription immediately causes the endpoint to return `404/403` and revokes node client IDs via Host Agent.

---

## Non-goals

- Deploying unrelated protocols (such as ShadowTLS v3, AmneziaWG, or OpenVPN).
- Public subscription registration or commercial billing.
- Persisting raw VLESS or Hysteria URIs in PostgreSQL or server logs.
- Breaking existing manual key issuance in `/vpn` (existing direct keys remain available in an advanced submenu for diagnostic fallback).

---

## System Architecture

```
                                  [ Telegram Client ]
                                          │
                                          ▼
                             /vpn -> "📲 Моя подписка"
                                          │
                   ┌──────────────────────┴──────────────────────┐
                   ▼                                             ▼
        [ Owner / Device Link ]                      [ Family Member Link ]
        https://jarvis.rilora.ru/                     https://jarvis.rilora.ru/
        happ-sub/sub_8f2b...                          happ-sub/sub_1c9a...
                   │                                             │
                   └──────────────────────┬──────────────────────┘
                                          │  Opens Happ App
                                          ▼
                                   [ Happ Client ]
                                          │
                                          │  GET /sub/:token
                                          │  (Header: User-Agent: Happ/Sing-box)
                                          ▼
                              [ Fastify Server (DE-4) ]
                                          │
                   ┌──────────────────────┼──────────────────────┐
                   │                      │                      │
                   ▼                      ▼                      ▼
           Verify SHA-256         Fetch Node Keys         Generate Sing-box JSON
           in PostgreSQL          via Host Agent          with URL-Test & Routes
                   │                      │                      │
                   └──────────────────────┼──────────────────────┘
                                          │
                                          ▼
                            [ Happ Remote Subscription ]
                   ┌─────────────────────────────────────────────┐
                   │ ⚡ Авто-выбор (Smart Failover - url-test)    │
                   │ ├─ [P1] 🇩🇪 DE Hysteria 2 (:20000-50000)     │
                   │ ├─ [P2] 🇳🇱 NL Hysteria 2 (:20000-50000)     │
                   │ ├─ [P3] 🇩🇪 DE VLESS REALITY (:8443)        │
                   │ └─ [P4] 🇳🇱 NL VLESS REALITY (:8443)        │
                   │                                             │
                   │ 🇷🇺 Direct Russian Routing (No VPN)         │
                   │ └─ .ru, .su, geosite:ru, geoip:ru           │
                   │                                             │
                   │ 🔄 Кнопка «Обновить» + Auto-Update 12h      │
                   └─────────────────────────────────────────────┘
```

---

## Detailed Component Specifications

### 1. Database Schema (`vpn_subscriptions`)

Migration `020_vpn_subscriptions.sql`:
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

### 2. Network & Kernel Configuration (Host Agent & Linux)

On each VPN node (DE `87.120.187.109` and NL `94.183.208.56`):
1. **Firewall Port Range:**
   ```bash
   ufw allow proto udp from any to <NODE_VPN_IP> port 20000:50000 comment "Hysteria2 Port Hopping"
   ```
2. **Kernel DNAT / Port Redirection:**
   ```bash
   iptables -t nat -A PREROUTING -d <NODE_VPN_IP> -p udp --dport 20000:50000 -j REDIRECT --to-ports 443
   ```
   *Persistent rules configured via `/etc/iptables/rules.v4` or Host Agent startup script.*
3. **Host Agent Integration:**
   * Host Agent exposes closed status for the port range in `vpn.hysteria2.status`:
     ```json
     { "portHopping": { "enabled": true, "range": "20000-50000", "targetPort": 443 } }
     ```

### 3. Subscription Endpoint Controller (`vpnSubscriptionService.js`)

Located in `server/src/vpn/vpnSubscriptionService.js`:
- `GET /sub/:token`:
  1. Computes `crypto.createHash('sha256').update(token).digest('hex')`.
  2. Queries `vpn_subscriptions` where `token_hash = hash AND revoked_at IS NULL`.
  3. If not found or revoked -> returns `404 Not Found`.
  4. Updates `last_accessed_at = NOW()`.
  5. Inspects `req.headers['user-agent']` and query parameters (`?format=base64|json`).
  6. Fetches client secrets from Host Agent for DE and NL.
  7. Formats and responds with:
     - `application/json` (Sing-box config with `url-test` and routing) for Happ/Sing-box.
     - `text/plain; charset=utf-8` (Base64 URI list) for generic clients.
- `GET /happ-sub/:token`:
  * Returns an HTML page with the branded Jarvis interface and automatic redirect to `happ://add/sub?url=https://jarvis.rilora.ru/sub/${token}`.

### 4. Sing-box JSON Subscription Structure

```json
{
  "version": 1,
  "outbounds": [
    {
      "type": "url-test",
      "tag": "⚡ Авто-выбор (Smart Failover)",
      "outbounds": [
        "🇩🇪 Германия (Hysteria 2)",
        "🇳🇱 Нидерланды (Hysteria 2)",
        "🇩🇪 Германия (VLESS 8443)",
        "🇳🇱 Нидерланды (VLESS 8443)"
      ],
      "url": "http://cp.cloudflare.com/generate_204",
      "interval": "30s",
      "tolerance": 50
    },
    {
      "type": "hysteria2",
      "tag": "🇩🇪 Германия (Hysteria 2)",
      "server": "vpn.rilora.ru",
      "server_port": 443,
      "ports": "20000-50000",
      "hop_interval": "30s",
      "up_mbps": 100,
      "down_mbps": 300,
      "password": "<DE_HY2_PASSWORD>",
      "obfs": {
        "type": "salamander",
        "password": "<DE_SALAMANDER_KEY>"
      },
      "tls": {
        "enabled": true,
        "server_name": "vpn.rilora.ru",
        "insecure": false
      }
    },
    {
      "type": "hysteria2",
      "tag": "🇳🇱 Нидерланды (Hysteria 2)",
      "server": "vpn-nl.rilora.ru",
      "server_port": 443,
      "ports": "20000-50000",
      "hop_interval": "30s",
      "up_mbps": 100,
      "down_mbps": 300,
      "password": "<NL_HY2_PASSWORD>",
      "obfs": {
        "type": "salamander",
        "password": "<NL_SALAMANDER_KEY>"
      },
      "tls": {
        "enabled": true,
        "server_name": "vpn-nl.rilora.ru",
        "insecure": false
      }
    },
    {
      "type": "vless",
      "tag": "🇩🇪 Германия (VLESS 8443)",
      "server": "jarvis.rilora.ru",
      "server_port": 8443,
      "uuid": "<DE_VLESS_UUID>",
      "flow": "xtls-rprx-vision",
      "tls": {
        "enabled": true,
        "server_name": "dl.google.com",
        "reality": {
          "enabled": true,
          "public_key": "<DE_REALITY_PUBKEY>",
          "short_id": "<DE_REALITY_SHORT_ID>"
        }
      }
    },
    {
      "type": "vless",
      "tag": "🇳🇱 Нидерланды (VLESS 8443)",
      "server": "jarvis-nl.rilora.ru",
      "server_port": 8443,
      "uuid": "<NL_VLESS_UUID>",
      "flow": "xtls-rprx-vision",
      "tls": {
        "enabled": true,
        "server_name": "dl.google.com",
        "reality": {
          "enabled": true,
          "public_key": "<NL_REALITY_PUBKEY>",
          "short_id": "<NL_REALITY_SHORT_ID>"
        }
      }
    },
    {
      "type": "direct",
      "tag": "direct"
    },
    {
      "type": "block",
      "tag": "block"
    }
  ],
  "route": {
    "auto_detect_interface": true,
    "final": "⚡ Авто-выбор (Smart Failover)",
    "rules": [
      {
        "geoip": ["private"],
        "outbound": "direct"
      },
      {
        "geosite": ["category-ru"],
        "geoip": ["ru"],
        "domain_suffix": [".ru", ".su", ".xn--p1ai"],
        "outbound": "direct"
      }
    ]
  }
}
```

### 5. Telegram Bot UI Integration

1. In `/vpn`:
   * Top-level button: **`📲 Моя подписка (1 клик)`**.
   * Shows active subscriptions for the user and family members.
   * Action buttons:
     * `🚀 Активировать в Happ (1 клик)` -> URL `https://jarvis.rilora.ru/happ-sub/:token`
     * `📋 Скопировать ссылку` -> Copies `https://jarvis.rilora.ru/sub/:token`
     * `🔄 Перевыпустить` -> Issues new token, revokes old one.
     * `🗑 Отозвать доступ` -> Soft-deletes subscription.
2. Advanced options:
   * Submenu «⚙️ Расширенные настройки / Прямые ключи» retains the legacy individual VLESS and Hysteria 2 key delivery.

---

## Verification and Rollout Plan

### Phase 1: Automated Unit & Contract Tests
* `server/test/vpnSubscriptionService.test.js`:
  * Validates token generation, SHA-256 hash checking, and revocation logic.
  * Validates Sing-box JSON generation: verifies that `url-test` outbounds match exact priority (DE Hy2 -> NL Hy2 -> DE VLESS -> NL VLESS).
  * Validates port hopping range syntax (`ports: "20000-50000"`, `hop_interval: "30s"`).
  * Validates Base64 fallback output when `User-Agent` is not Sing-box/Happ.
  * Validates Russian direct routing rules presence.

### Phase 2: Host Agent & Network Verification
* On `jarvis-vps` (DE):
  * Apply iptables port redirection rule for `20000:50000/udp` -> `443/udp`.
  * Open UFW port range `20000:50000/udp`.
  * Send test UDP probe from local test runner to port 35000 and verify arrival at Hysteria 2 listener.

### Phase 3: Live Acceptance with Happ
* Open Telegram bot -> `/vpn` -> «📲 Моя подписка».
* Generate subscription for test device and tap «🚀 Активировать в Happ».
* Verify that Happ opens and imports the subscription.
* Verify that the subscription card has the working **«Обновить»** button and updates successfully.
* Verify internet access on test phone under MGTS / Beeline with Port Hopping active.
* Manually pause DE Hysteria 2 on test port and verify Happ automatically fails over to NL Hysteria 2 and DE VLESS without user intervention.
