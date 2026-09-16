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

The production no-op proposal was delivered to the owner in Telegram. Until the
owner presses its approval button, PostgreSQL correctly retains the workflow as
`awaiting_owner`; no VPN or key mutation is possible in that state.

Real repair execution and key rotation remain future milestones. Any future key
rotation must identify the affected node/device and reason in Telegram and must
receive a separate owner button confirmation.
