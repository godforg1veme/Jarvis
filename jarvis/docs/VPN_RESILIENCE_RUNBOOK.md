# Jarvis VPN Resilience Runbook

## Scope and safety boundaries

This runbook covers the Happ subscription, Hysteria2 and VLESS/REALITY on the DE and NL VPN nodes. A subscription URL and client credentials are not changed when a node is demoted or its public Hysteria port pool changes. Do not enable probe timers, alter firewall rules, rotate credentials, restart Hysteria2, or modify DNS as part of diagnosis. Those are separate owner-confirmed operations.

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

## Recovery paths and owner confirmation

For a per-port restriction, retain the subscription URL and use the active port list after its refresh. For a broad UDP restriction, choose a VLESS 8443 entry; a server-side port change cannot bypass an access network that blocks all QUIC/UDP. A changed pool, credentials, DNS, firewall, or probe scheduling requires the existing owner-confirmation boundary. Timers stay disabled until the documented dedicated-credential acceptance has succeeded.

## What never enters logs, databases, callbacks, or chat

Never write subscription tokens, full subscription URLs, VPN URIs, credentials, obfuscation values, packet captures, local temp paths, Host Agent payloads, or raw process output. Probe and Operations output is limited to node, check name, timestamp, closed status, and closed failure code.

## One-shot acceptance checklist

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

Hysteria2 native hopping supports a multi-port server value and `transport.udp.hopInterval`. Happ compatibility with the emitted list is an owner-device acceptance requirement; the project does not depend on an undocumented URI interval parameter.
