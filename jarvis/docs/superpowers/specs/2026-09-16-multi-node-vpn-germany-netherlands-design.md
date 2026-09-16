# Multi-Node VPN: Germany (DE) and Netherlands (NL) Design

**Date:** 2026-09-16  
**Status:** In Progress (Milestone: Multi-Node Rollout)  
**Nodes:**
- **DE Node (Primary):** `87.120.187.202` (Xray) / `87.120.187.109` (Hysteria 2) — Germany 🇩🇪
- **NL Node (Secondary):** `94.183.208.56` (Xray + Hysteria 2) — Netherlands 🇳🇱

---

## 1. Context & Motivation

Jarvis currently operates a single-host VPN deployment on `jarvis-vps` (Germany) providing:
1. **Hysteria 2** (UDP 443 with Salamander obfuscation and HTTP auth via Host Agent) as the primary high-speed protocol.
2. **VLESS + REALITY + XTLS Vision** (TCP 443 / 8443) as the resilient fallback protocol for networks blocking UDP.
3. **Domestic Russian split-routing** via Happ (`https://jarvis.rilora.ru/happ-routing`) which directs Russian traffic (banks, Gosuslugi, `.ru`/`.su`, `geosite:category-ru`, `geoip:ru`) directly via local ISP and all other traffic through the active VPN.

To provide geographic redundancy, higher bandwidth, and location choice, we introduce a second managed node in the Netherlands (NL). The existing Telegram `/vpn` control surface must provide seamless country selection (`🇩🇪 Германия` vs `🇳🇱 Нидерланды`), followed by protocol selection and access key management, while sharing the identical split-routing configuration.

---

## 2. Architecture & Components

```
                ┌────────────────────────────────────────────────────────┐
                │                 Telegram Client (Owner)                │
                └───────────────────────────┬────────────────────────────┘
                                            │ /vpn (Inline Buttons)
                                            ▼
                ┌────────────────────────────────────────────────────────┐
                │           Jarvis Server (Docker on VPS-1 DE)           │
                │        - vpnCommandService.js (Multi-Node Aware)        │
                │        - telegramMenuService.js                        │
                └───────────────┬────────────────────────┬───────────────┘
                                │                        │
              /run/.../agent.sock                        │ /run/.../agent-nl.sock
           (Local Unix Domain Socket)                    │ (StreamLocal SSH Tunnel)
                                │                        │
                                ▼                        ▼
       ┌──────────────────────────────────┐    ┌──────────────────────────────────┐
       │   VPS-1 (DE - 87.120.187.202)    │    │   VPS-2 (NL - 94.183.208.56)     │
       │                                  │    │                                  │
       │  • jarvis-host-agent.service     │    │  • jarvis-host-agent.service     │
       │  • xray.service (VLESS Reality)  │    │  • xray.service (VLESS Reality)  │
       │  • hysteria-server.service       │    │  • hysteria-server.service       │
       └──────────────────────────────────┘    └──────────────────────────────────┘
```

### 2.1 Telegram UX Flow

1. **Top Level (`/vpn`):**
   * Message: `🌐 **Выберите локацию (страну) VPN:**`
   * Buttons:
     * `[ 🇩🇪 Германия (Frankfurt) ]` (`vpn:c:de`)
     * `[ 🇳🇱 Нидерланды (Amsterdam) ]` (`vpn:c:nl`)
     * `[ 🏥 Диагностика всех нод ]` (`vpn:health`)

2. **Country Level (`vpn:c:<node>`):**
   * Message: `🌐 **{Flag} {Country} — выберите протокол:**`
   * Buttons:
     * `[ ⚡ Hysteria 2 — рекомендуется ]` (`vpn:<node>:h:menu`)
     * `[ 🛡 VLESS — резерв ]` (`vpn:<node>:v:menu`)
     * `[ ← Выбор страны ]` (`vpn:menu`)

3. **Protocol Action Level (`vpn:<node>:<proto>:menu`):**
   * Action buttons:
     * `[ 🔄 Статус ]` (`vpn:<node>:<proto>:status`)
     * `[ 👥 Мои доступы ]` (`vpn:<node>:<proto>:clients`)
     * `[ ➕ Новый доступ ]` (`vpn:<node>:<proto>:new`)
     * `[ 🌐 Обход РФ (Госуслуги, банки) ]` (`vpn:<node>:<proto>:routing`)
     * `[ 💻 Настройка на ПК ]` (`vpn:<node>:<proto>:pc`)
     * `[ ♻️ Перезапустить ]` (`vpn:<node>:<proto>:restart`)
     * `[ ← Выбор протокола ]` (`vpn:c:<node>`)

4. **Backward Compatibility:**
   * Legacy callbacks like `vpn:p:h` or `vpn:h:status` automatically resolve to the default node (`de`).

---

## 3. Host-to-Host Communication Security

1. **Security Boundary:** The Jarvis Server Docker container has no public ports and no direct SSH keys to the VPS.
2. **Channel:** An encrypted OpenSSH StreamLocal forward runs on VPS-1 as a systemd service (`jarvis-host-agent-tunnel-nl.service`):
   * Local socket on VPS-1: `/run/jarvis-host-agent/agent-nl.sock`
   * Remote socket on VPS-2: `/run/jarvis-host-agent/agent.sock`
   * Mounted into `server` container via existing read-only mount `/run/jarvis-host-agent`.
3. **Authentication:** The existing Host Agent HMAC-SHA256 protocol applies to every packet transmitted over `agent-nl.sock`. The secret token `operations_host_agent_authenticator` is mirrored to VPS-2.

---

## 4. Node Provisioning on NL (`94.183.208.56`)

1. **System & Swap:**
   * Ubuntu 24.04.4 LTS.
   * 4 GB Swapfile created for memory stability.
   * Docker Engine & Compose plugin installed.
2. **Xray (VLESS Reality):**
   * Binary installed to `/usr/local/bin/xray`.
   * TCP 443 + TCP 8443 listeners.
   * Reality SNI camouflage: `www.cloudflare.com`.
   * User database isolated in `/etc/jarvis-vpn/state.json`.
3. **Hysteria 2:**
   * Binary installed to `/usr/local/bin/hysteria` (pinned v2.12.2).
   * UDP 443 listener with Salamander obfuscation.
   * HTTP dynamic auth via local Host Agent (`127.0.0.1:3211/vpn/hysteria2/auth`).
   * Valid TLS certificate for `vpn.rilora.ru` synced with automatic renewal support.
4. **Host Agent:**
   * Python package `jarvis_host_agent` deployed to `/home/deploy/apps/jarvis/host-agent`.
   * Service `jarvis-host-agent.service` active and managing local `xray.service` and `hysteria-server.service`.

---

## 5. Verification & Acceptance Plan

1. **Host Agent Unit Tests:** Run full test suite on NL host.
2. **Server Unit Tests:** Run `npm test` on Jarvis server testing multi-node routing and callbacks.
3. **E2E Probe Verification:**
   * Establish TCP connection to Xray Reality port 443 and 8443 on NL.
   * Establish UDP handshake to Hysteria 2 port 443 on NL.
   * Issue test client, verify `hy2://` and `vless://` URI generation with correct IPs.
   * Verify Telegram callback transitions from country selection down to client issue.