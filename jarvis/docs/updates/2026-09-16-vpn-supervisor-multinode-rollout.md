# Multi-node VPN Supervisor rollout

Date: 2026-09-16

## Outcome

Jarvis now treats the Germany and Netherlands VPN servers as separate managed
nodes. Telegram exposes an explicit country-first VPN menu. Read and changing
operations route to the selected node, confirmation records retain that node,
and recovery of an interrupted operation queries only the original Host Agent.

Operations stores both hosts. The DE control-plane collector remains unchanged;
NL has a VPN-only collector over the authenticated OpenSSH StreamLocal forward.
Each node has its own deterministic incident adapter, bounded log collector,
and isolated LLM advisory service. A real recommendation may notify the owner,
but every real repair playbook is still disabled. The only executable playbook
is the synthetic `supervisor_acceptance_noop`, which requires a fresh owner
Telegram confirmation and never calls Host Agent.

## Production verification

- Full server suite: 452/452 passed.
- Host Agent suite: 79/79 passed on DE and 79/79 passed on NL.
- Built production image focused suite: 83/83 passed.
- Public preflight, Compose health, and HTTPS smoke passed.
- The authenticated Host Agent path returned healthy host, DNS, outbound,
  Xray, Hysteria2, and local Hysteria auth checks for both nodes.
- External TCP 443 and 8443 were reachable on both public node addresses.
- PostgreSQL contains distinct healthy `vps` and `vpn-nl` Operations hosts,
  with healthy Xray and Hysteria2 service rows and zero open `vpn.*` incidents.
- The configured OpenRouter model returned the exact strict no-op proposal after
  the system policy was strengthened with the literal seven-field contract.
- Xray, Hysteria2, and the NL tunnel retained their original active timestamps
  and reported zero restarts during deployment and acceptance preparation.
- Recent warning-level journals for both VPN stacks and Host Agents were empty.

## Owner acceptance

The first production proposal expired without approval. A fresh proposal was
delivered to the owner in Telegram, who approved it before its deadline.
PostgreSQL records the exact `supervisor_acceptance_noop` / `TEST_ACCEPTANCE`
workflow as `succeeded` at 2026-09-16 08:36:00 UTC, with no pending Supervisor
run. The only executable step was the no-op; Host Agent was not called by the
playbook, and no VPN state or key was changed. The acceptance flag was then set
to `false` in the running server container. Public HTTPS smoke passed after
that server-only restart; both Operations hosts and all four VPN services
remained healthy, with zero open `vpn.*` incidents. Xray and Hysteria2 active
timestamps remained unchanged on both VPSs.

Real repair execution and key rotation remain future milestones. Any future key
rotation must identify the affected node/device and reason in Telegram and must
receive a separate owner button confirmation.

## Bounded diagnostic follow-up (later on 2026-09-16)

The server now handles one LLM `need_observation` request by taking a fresh,
validated, read-only `vpn.health.snapshot` from the affected node. It passes
only requested allowlisted status facts to one additional model call. Empty or
duplicate requests, a changed incident revision, invalid/unavailable snapshot,
or a second `need_observation` stop without executing any repair.

Local server tests passed 461/461. Host Agent tests passed 79/79 on each VPS.
The production image passed 33/33 focused VPN tests, including simulated
DE/Xray and NL/Hysteria2 end-to-end faults, hostile log evidence, and a
repeated observation request. The first smoke check immediately after the
server-only container replacement received a transient 502 while health was
starting. The subsequent checks passed, and the container became healthy.
Both Operations hosts and all four VPN services were healthy, with zero open
`vpn.*` incidents. Xray, Hysteria2, and Host Agent activation timestamps and
restart counters remained unchanged on both nodes. The rollback source files
and pre-change server image were retained on DE.

This deployment does **not** include the cross-node authenticated client
probes. `protocolProbe` remains `unknown` until separate test identities and
the probe runner are safely provisioned and verified. No VPN key or service was
changed by this rollout.

## Cross-node client probe staging (later on 2026-09-16)

The next code increment adds strict URI/config/result contracts, a bounded
non-root runner for official Xray and Hysteria2 clients, disabled systemd
template units, and a closed read-only Host Agent result operation. The server
reads DE results only from NL and NL results only from DE; it validates target
identity and freshness and shows the external status separately in
`/vpn_health`. A missing or ambiguous result stays `unknown`. This code does
not create repair approvals, restart VPN services, or issue/rotate keys.

Local Host Agent tests passed 93/93 and server tests passed 463/463. DE
`systemd-analyze verify` accepted both unit files. The runner has not yet been
accepted with dedicated live test credentials. Timers must remain disabled
until four owner-confirmed test identities are issued and installed as
root-owned systemd credential sources, one target at a time.
