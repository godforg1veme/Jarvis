# Jarvis VPN Resilience Runbook

## Scope and safety boundaries

This runbook covers the Happ subscription, Hysteria2 and VLESS/REALITY on the DE and NL VPN nodes. A subscription URL and client credentials are not changed when a node is demoted or its public Hysteria port pool changes. Do not enable probe timers, alter firewall rules, rotate credentials, restart Hysteria2, or modify DNS as part of diagnosis. Those are separate owner-confirmed operations.

Current operational state (2026-09-24): all four owner-confirmed external
test-device bindings have fresh healthy proofs. Both ~15-minute probe timers
were separately enabled by the owner and have completed healthy scheduled
runs. NL `vpn-nl.rilora.ru` resolves to its own address and has a DNS-01
certificate while retaining the old `vpn.rilora.ru` TLS path; both names
passed strict-TLS real-client probes. An owner-approved NL Xray service-failure
drill passed live on 2026-09-24 after a host-bound callback routing fix; this
is the only production repair path exercised on a real failure so far. The
other node/service combinations have code and simulated-test coverage but not
their own live outage acceptance. Unattended certificate renewal has not yet
been observed, and these checks do not establish 99.9% availability. Dated
rollout notes below describe earlier states and must not be treated as current.

## Monitoring, notifications, and repair scope

Two cross-node systemd timers run at an approximately 15-minute cadence: the
NL runner probes DE and the DE runner probes NL. The four credential bindings
are NL→DE VLESS, NL→DE Hysteria2, DE→NL VLESS, and DE→NL Hysteria2. Each
target snapshot reports VLESS TCP 443 and 8443 plus Hysteria2 UDP fixed-443 and
port-hopping checks. These are data-plane reachability observations, not
Operations incidents. A failed timer result does not currently trigger its own
Telegram push alert and does not authorize restarting a service, rotating a
credential, or changing configuration. `/vpn_health` displays the external
results. Subscription generation may lower a node's priority when its VLESS
8443 or Hysteria2 hopping result is explicitly failed; missing/unknown results
are not treated as failed. Client-side failover depends on the client/profile.

Separately, Operations polls each node's local Host Agent health snapshot at
`JARVIS_OPERATIONS_POLL_INTERVAL_MS` (30 seconds by default). Three consecutive
observations with the same primary VPN diagnosis open an Operations incident
and send the owner a Telegram alert. This covers local host/network/service,
configuration, listener, and Hysteria2 auth health, not each external path as
a distinct push-notified incident.

After an incident opens, the Supervisor may propose only:

| Diagnosis on that VPS | Permitted action | Boundary |
| --- | --- | --- |
| `XRAY_SERVICE_FAILURE` | Restart that VPS's Xray service | Only with healthy host/network, valid Xray config, healthy Hysteria2 stack/auth, no failed protocol probes, and a high-confidence matching proposal. |
| `HYSTERIA2_SERVICE_FAILURE` | Restart that VPS's Hysteria2 service | Only with healthy host/network, valid Hysteria2 config/auth, healthy Xray stack, no failed protocol probes, and a high-confidence matching proposal. |

The alert/proposal is not a restart. The owner must approve in the originating
private Telegram chat within ten minutes. The server rechecks the incident and
health before dispatch, restarts only the selected service, and verifies both
stacks. It does not retry an uncertain restart or automatically roll back a
configuration. Config/listener/DNS/outbound/auth failures, host loss,
multi-stack failure, and unknown diagnosis can produce Operations incidents
and diagnostics but do not authorize repair. External-probe failures are
visible in `/vpn_health` and do not currently trigger their own push alert.
Restore playbooks remain disabled.

## Protocol contracts: Happ, Hysteria2, VLESS/REALITY, split routing

Happ receives a normal Base64 subscription. It can refresh endpoint metadata from the same URL but its automatic selection is not claimed. Explicit Sing-box JSON alone has `url-test` automatic selection. Hysteria2 uses a bounded public port list and native UDP hopping; a fixed UDP 443 success proves only the basic path. VLESS/REALITY over TCP 8443 is the independent fallback when an access network blocks UDP broadly. Russian split routing is client-side routing only; reconnect Happ after changing it and never use it as evidence of a transport repair.

## Normal subscription lifecycle

1. Create and bind a profile through the existing owner-confirmed flow.
2. Import the one subscription URL in Happ; do not copy individual node credentials into chat or tickets.
3. Happ refreshes the same URL. A valid Hysteria node is emitted only when the server has a validated active public pool for that node.
4. A failed hopping probe places Hysteria after healthy alternatives; VLESS entries remain available.

## Diagnostic decision tree

```text
Happ shows n/a or traffic fails
  -> check Hysteria fixed UDP 443 and the hopping tunnel separately
  -> fixed healthy, hopping failed/unknown: hopping path is not accepted; use VLESS and investigate the public pool
  -> both Hysteria checks fail: likely UDP reachability/path issue; use VLESS
  -> Hysteria healthy, traffic fails only with split routing: reconnect after the routing change and test direct RU/proxied international paths separately
  -> VLESS also fails: inspect node health and external probe results; do not rotate keys automatically
```

## Hysteria2 port-pool and hop-probe procedure

The pool has exactly a node code, generation UUID, four to twelve unique increasing UDP ports inside 20000–50000, and a 5–45 second interval. It never has a hostname, URI, key, password, client ID, or routing rule. The server only publishes a validated pool. The cross-node probe starts a private loopback SOCKS client, completes one proxied HTTPS request, waits one configured interval, and completes a second request. Both must use the expected exit. A fixed-443 result alone cannot publish or restore Hysteria priority.

The corrected Host Agent `probeTarget` schema keeps the VLESS and Hysteria2
connection endpoints separate from `expectedExitIp`, the target node's public
egress address. Its generated root-only probe environment takes
`VPN_PROBE_EXPECTED_EXIT_IP` only from that explicit field. The runner compares
proxied HTTPS responses against it but never stores or returns the observed IP.
The expected egress must be independently confirmed and stable; missing or
invalid configuration fails closed. Do not infer an exit address from either
service's listener address. This source/config correction was deployed to both
production nodes on 2026-09-24 and verified against each peer's independent
egress. The production Host Agent regression suite and health snapshot passed;
both VPN stacks stayed active and both probe timers stayed disabled. This does
not accept any credential-backed path.

## Recovery paths and owner confirmation

For a per-port restriction, retain the subscription URL and use the active port list after its refresh. For a broad UDP restriction, choose a VLESS 8443 entry; a server-side port change cannot bypass an access network that blocks all QUIC/UDP. A changed pool, credentials, DNS, firewall, or probe scheduling requires the existing owner-confirmation boundary. Timers stay disabled until the documented dedicated-credential acceptance has succeeded.

In the deployed server source, each owner-confirmed credential installation counts only after a fresh, node-matched authenticated `vless_tcp_8443` or `hysteria2_udp_hop` check is healthy. Timer activation requires four distinct matching proofs from the latest attempts within 24 hours. Legacy success records without this closed proof, failed rotations, and unknown results do not qualify. The following paragraphs retain dated acceptance history; the current state is at the top of this runbook.

Earlier intermediate acceptance snapshot (2026-09-24; superseded by the
current status above and the dated rollout records below): one owner-confirmed
NL-to-DE VLESS test credential was installed at that point. Its original
install/probe action remained
`unknown`; the systemd attempt failed while loading credentials. A separate
owner-confirmed recheck at 20:30 UTC returned `EXIT_MISMATCH` for VLESS TCP 443
and 8443, before the expected-egress correction. The correction was deployed
on both nodes, and the configured baseline and generated public environment
were verified to match on each node. A new owner-confirmed recheck at 23:26 UTC
was actually the reverse DE-to-NL VLESS direction; it returned `unknown`
(`PROBE_RUN_UNKNOWN`) without a probe result. Read-only DE diagnostics found
systemd exit 243/CREDENTIALS and no NL VLESS test-key file. This is not a
result for the installed NL-to-DE route. Do not replay the uncertain reverse
action. After the recheck availability and Host Agent metadata gate were
deployed, the owner confirmed a new **Нидерланды → Германия VLESS** test-key
installation at 03:00 Moscow. Its durable action succeeded with a fresh
`vless_tcp_8443` proof. This is one accepted binding out of four. The nearby
generic Telegram errors came from a callback route that omitted `chatType`;
  the route was fixed, but a real owner tap of that recheck button after the fix
remains unverified. Three other fixed bindings still need separate installation
and owner-confirmed checks. Both timers remain disabled. See
[`2026-09-23 VPN probe recheck rollout`](updates/2026-09-23-vpn-probe-credential-recheck-rollout.md)
for live deployment evidence and
[`VPN probe egress baseline design`](superpowers/specs/2026-09-23-vpn-probe-egress-baseline-design.md)
for the correction. Both production timers were disabled at that stage.

Later on 2026-09-24, DE-to-NL VLESS also passed a fresh owner-confirmed
installation and recheck. The corrected Telegram recheck button was exercised
live. The count at that stage was two of four, with both Hysteria2 directions still
pending. The first live `Установить: 🇳🇱 → 🇩🇪 Hysteria2` tap failed before a
durable action was created: confirmation creation replaced its protocol with
the VLESS default. The selected protocol is now preserved in the deployed
server, with focused and full-suite verification. A new owner tap is still
required; the failed tap installed no credential. Both timers remain disabled.
See [`Hysteria2 probe button fix`](updates/2026-09-24-vpn-hysteria2-probe-button-fix.md).

The next owner-confirmed NL-to-DE Hysteria2 tap reached Host Agent but failed
with `PROBE_INSTALL_FAILED`: the credential file remained empty because its
URI parser incorrectly required the node IP endpoint to equal the certificate
DNS name in `sni`. The parser fix is deployed on both nodes and verified by
synthetic parser/install tests and full Host Agent suites. A fresh owner
confirmation is required for another installation; both Hysteria2 proofs are
still pending and both timers remain disabled.

Timer activation enables the NL-to-DE timer first and the DE-to-NL timer second. A first-side failure stops before the second command. If the second command fails or has an unknown outcome, the server sends one closed disable command for the confirmed first timer. A failed or uncertain compensation, or an uncertain second enable, leaves the overall state unknown: inspect both actual systemd timer states before a later owner-confirmed action. Never retry an uncertain enable under a new request ID. This behavior was deployed on 2026-09-23; live owner activation succeeded on 2026-09-24.

The external probe timer source schedules the next run 15 minutes after the previous activation, with up to 30 seconds of randomized delay and 15 seconds of systemd accuracy. A previously enabled timer may first run about two minutes after boot. This is an approximate cadence, not an exact quarter-hour wall-clock schedule. Four separate owner-approved one-shot checks passed before both production timers were enabled.

## What never enters logs, databases, callbacks, or chat

Never write subscription tokens, full subscription URLs, VPN URIs, credentials, obfuscation values, packet captures, local temp paths, Host Agent payloads, or raw process output. Probe and Operations output is limited to node, check name, timestamp, closed status, and closed failure code.

## Pre-activation one-shot acceptance checklist (historical procedure)

1. Run one owner-approved cross-node hop probe for each node; require `hysteria2_udp_hop=healthy`.
2. Confirm the deployed unit has no enabled timer.
3. On the owner phone, refresh the unchanged subscription URL.
4. Verify DE Hysteria carries HTTPS traffic through at least three hop intervals.
5. Reconnect after enabling and after disabling split routing; test a domestic direct path and an international proxied path separately.
6. Verify DE and NL VLESS 8443 independently.

Record only pass/fail, timestamp, node, transport, and next action. The owner-phone steps remain required acceptance evidence.

## Source links and version observations

- [Hysteria2 URI scheme](https://v2.hysteria.network/docs/developers/URI-Scheme/)
- [Hysteria2 port hopping](https://v2.hysteria.network/docs/advanced/Port-Hopping/)
- [Hysteria2 Mimic limitations](https://v2.hysteria.network/docs/advanced/Mimic/)
- [Happ Hysteria2 FAQ](https://github.com/HappDev/happ_su/blob/main/faq/hysteria2.md)
- [Happ routing documentation](https://github.com/HappDev/happ_su/blob/main/dev-docs/routing.md)

Hysteria2 native hopping supports a multi-port server value and `transport.udp.hopInterval`. Happ compatibility with the emitted list is an owner-device acceptance requirement. Its multi-port import uses the client default 30-second hop interval, so the active public pools and hop probe use 30 seconds; the project does not depend on an undocumented URI interval parameter.
