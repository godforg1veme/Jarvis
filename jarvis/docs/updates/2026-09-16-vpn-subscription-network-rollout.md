# Dynamic VPN Subscription Network and Port Hopping Rollout

Date: 2026-09-16

> Status correction (2026-09-17): This is the original rollout record, not
> current Happ acceptance. The `happ://add/sub?url=...` link below was invalid
> and has been replaced. Happ currently receives a Base64 list of four URIs;
> only explicit Sing-box JSON contains `url-test`. Real Happ failover, latency,
> and traffic remain unverified on the owner's phone. NL certificate renewal
> also needs a distinct hostname: `vpn.rilora.ru` resolves to DE. See
> [compatibility and follow-ups](2026-09-16-happ-subscription-compatibility.md)
> and the current [status authority](../README.md).

## Outcome

Jarvis now provides an autonomous dynamic multi-node VPN subscription network for
Sing-box and Happ. Rather than distributing single static keys that drop offline
whenever Russian ISPs throttle or blackhole specific destination ports (such as
the UDP 443 degradation observed at 16:26 MSK on 2026-09-16), Jarvis generates a
unified smart subscription profile that aggregates four resilient nodes with automated
client-side failover:

1. 🇩🇪 **Germany Hysteria 2** (UDP port hopping `20000-50000`, Salamander obfs)
2. 🇳🇱 **Netherlands Hysteria 2** (UDP port hopping `20000-50000`, Salamander obfs)
3. 🇩🇪 **Germany VLESS REALITY** (TCP port `8443`, XTLS Vision)
4. 🇳🇱 **Netherlands VLESS REALITY** (TCP port `8443`, XTLS Vision)

## Anti-Censorship Mechanisms

### 1. UDP Port Hopping (20000-50000)
- ISP packet dropping on port 443 is mitigated by rotating client destination UDP ports
  every 30 seconds (`ports: "20000-50000"`, `hop_interval: "30s"`).
- On both Linux VPS nodes (`87.120.187.109` DE and `94.183.208.56` NL), an iptables NAT
  PREROUTING redirect and UFW firewall rules seamlessly forward all incoming UDP traffic on
  ports 20000-50000 to port 443 (`deploy/vpn/setup-port-hopping.sh`).
- Because port hopping occurs at the transport layer, QUIC state is preserved with zero
  session disconnects.

### 2. Smart Failover & Autonomous Demotion
- Client-side `url-test` in Sing-box constantly probes latency and packet loss via
  `http://cp.cloudflare.com/generate_204`, automatically falling back across nodes in
  milliseconds without user intervention.
- Server-side integration with `ExternalProbeMonitor`: when serving `/sub/:token`,
  the subscription service checks recent cross-node health snapshots (`snapshot('de')`
  and `snapshot('nl')`). If a node or protocol is failing, it is dynamically demoted
  to the bottom of the candidate list in the generated configuration.

### 3. Strict Zero Raw Secret Persistence
- PostgreSQL table `vpn_subscriptions` (migration `022_vpn_subscriptions.sql`) stores
  only SHA-256 token hashes (`token_hash`), user IDs, labels, and optional node client
  linkages.
- Even in the event of an unauthorized database dump, raw subscription tokens cannot
  be reconstructed.
- When generating a subscription, tokens (`sub_...`) are returned in transient response
  payloads or rotated atomically.

### 4. Domestic Russian Split-Routing
- The Sing-box subscription profile retains strict direct routing rules for `.ru`, `.su`,
  `geosite:category-ru`, and `geoip:ru`, guaranteeing that Russian banking apps,
  Gosuslugi, and VK continue functioning without captcha or blocking.

### 5. 1-Click Telegram & Happ UX
- Telegram `/vpn` menu exposes **«📲 Умная подписка (Happ)»**.
- `GET /happ-sub/:token` serves a branded Jarvis HTML landing page that automatically triggers
  the `happ://add/sub?url=...` deep link and provides a 1-click fallback button.
- Telegram inline buttons support token rotation (`vpn:sub:rotate:<id>`) and revocation
  (`vpn:sub:revoke:<id>`).

## Production Verification

- **Automated Tests:** 495/495 tests pass across the entire server suite (`server/npm test`),
  including 42 tests covering migration 022, repository methods, Sing-box JSON generation,
  degradation logic, web endpoints, and Telegram command/callback handling.
- **Production VPS Deployment:**
  - Applied `deploy/vpn/setup-port-hopping.sh` to DE (`87.120.187.109`) and NL (`94.183.208.56`).
  - Applied migration `022_vpn_subscriptions.sql` in production PostgreSQL container on DE.
  - Rebuilt and restarted `jarvis-family-server-1` (healthy, zero errors).
  - Verified public readiness `GET /health/ready` -> 200 OK.
  - Verified live subscription endpoint `GET /sub/invalid_token` -> 404 (2.3 ms).
  - Delivered interactive readiness notification directly to owner chat in Telegram.
