# VPN probe timers and NL DNS-01 acceptance — 2026-09-24

## Verified production outcome

- Four distinct cross-node test-device bindings had fresh owner-confirmed
  healthy proofs before timer activation. The production database gate counted
  4/4; no earlier unknown installation was replayed.
- The owner used a fresh private Telegram confirmation for `probe.enable`.
  The durable action succeeded at 01:36:24 UTC. DE and NL systemd timers are
  enabled and active. Their next scheduled activations followed the expected
  approximately 15-minute cadence. Scheduled results around 01:52 UTC on
  both nodes reported healthy VLESS TCP 443/8443 and Hysteria2 UDP 443/hopping
  checks. The timers do not establish a 99.9% availability guarantee.
- The generic Telegram error on earlier `probe.enable` taps was traced to
  unsupported `protocol` and `node` arguments passed to an action requiring
  `{}`. The focused regression failed before the fix and passed after it;
  focused, Telegram, complete server, production-image, preflight, Compose
  health, and public-smoke checks passed before the owner retried. The live
  owner tap then succeeded. The server rollback image is
  `jarvis-family-server:rollback-before-probe-timer-button-20260924`; backup
  materials are under `/root/jarvis-probe-timer-button-rollback-20260924/` on DE.
- Cloudflare DNS-only `vpn-nl.rilora.ru` resolves to NL `94.183.208.56`.
  The owner authorized a token limited to DNS Write and Zone Read on
  `rilora.ru`, requests from the NL IP, expiring 2027-09-25. On NL its value
  is in the root-owned mode-0600 settings file and generated mode-0640
  root:`hysteria` configuration needed by the daemon; it is not in Git or
  this record.
- The Host Agent accepts that optional strict settings file and generates
  dual-name Cloudflare DNS-01 ACME configuration. Without the file, the old
  HTTP-01 behavior remains. Full staged Host Agent tests passed on both nodes
  (DE 118, NL 117); each installed Host Agent was restarted and healthy.
- NL Hysteria2 restarted once with the generated configuration. Let's Encrypt
  issued `vpn-nl.rilora.ru` (issuer YE1; notBefore 2026-09-24 00:53:06 UTC;
  notAfter 2026-12-23 00:53:05 UTC). The retained
  `vpn.rilora.ru` certificate expires 2026-12-12 20:24:57 UTC. Strict-TLS
  Hysteria2 clients from DE reached the expected NL egress through both SNI
  values before and after changing NL's advertised `serverName` to
  `vpn-nl.rilora.ru`. The six existing client credentials, address, ports,
  obfuscation, and generated Hysteria config stayed unchanged at that state
  switch. NL host acceptance and both Xray/Hysteria2 services passed.

## Rollback and remaining evidence

Exact pre-migration NL state/config and Host Agent sources are retained under
`/root/jarvis-nl-acme-rollback-20260924/` on NL. Exact pre-migration DE Host
Agent sources are under the same root-only path on DE. Do not blindly restore
the old NL certificate mode after its 2026-12-12 expiry; inspect the current
state and preserve any subsequently issued clients first. A later confirmed
renewal is still needed to establish unattended renewal in practice. At the
final read-only audit on 2026-09-24, there were zero open `vpn.%`
Operations incidents. The running container's catalog enabled only
`restart_xray`, `restart_hysteria2`, and the synthetic no-op; both restore
playbooks were disabled. `vpn_supervisor_runs` contained one succeeded and
one expired synthetic no-op, three failed records without a selected playbook,
and no real restart run at that audit point. Do not fabricate an outage to
clear this gate.

## Update — 2026-09-24 13:55 UTC: Supervisor acceptance

The subsequent controlled NL Xray drill first exposed a host-routing defect:
the owner approval reached DE and safely dispatched no restart. After deploying
the host-bound callback router and its independent service guard, the drill was
repeated under a seven-minute conditional restore watchdog. The owner-approved
NL `vpn.restart` completed with `POSTCHECK_PASSED`; both VPN stacks on both
nodes were healthy, zero VPN incidents remained open, and the watchdog was
canceled while inactive. The same scheduled post-repair runs passed all four
cross-node VLESS/Hysteria2 checks toward DE at 13:53:25 UTC and NL at
13:54:35 UTC. The earlier read-only database audit above remains a historical
snapshot; the updated acceptance record is
`2026-09-24-vpn-supervisor-host-bound-callback-routing.md`.

The DNS-01 hostname and certificate are provisioned and live, but automatic
certificate renewal has not yet been observed. Neither this drill nor the
probe timers establish a 99.9% availability guarantee.
