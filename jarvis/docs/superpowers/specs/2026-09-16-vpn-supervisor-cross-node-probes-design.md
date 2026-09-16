# VPN Supervisor: cross-node client probes and bounded diagnostic follow-up

**Date:** 2026-09-16

**Status:** Design approved in conversation; implementation pending written-spec review.

## Goal and boundary

Make the DE and NL VPN health signals reflect a real external client connection,
then complete the already specified one-round `need_observation` path and test
failure handling without disrupting production VPN traffic. This milestone does
not enable any real repair playbook, autonomous mutation, device-key rotation,
or emergency shell execution.

## Architecture

Each VPS runs a small, bounded client probe against the *other* VPS. DE probes
NL; NL probes DE. This is an external path for each target without a third
host. The probe runs under a dedicated non-root identity with only the
minimum credential files needed for its target. There is no inbound probe
listener and no new public management endpoint. The probe uses the installed,
version-pinned official Xray/Hysteria2 clients, a loopback-only local proxy,
and a bounded HTTPS request through that proxy. The probe reports only a
closed status, target node, protocol/listener, timing bucket, and failure code.
It never returns client configuration, credential material, share URI, raw
client output, or arbitrary HTTP content.

Separate synthetic test clients are issued for VLESS and Hysteria2 on each
target node using Jarvis's existing owner-confirmed VPN mutation path. Their
labels clearly identify them as Supervisor probes. Existing device identities
and keys are untouched. The one-time exports are installed into root-owned
secret storage on the opposite runner node through a controlled setup step.
The non-root probe process receives only its target credentials through a
systemd credential mount. Existing Telegram exports are transient owner-visible
artifacts; their contents are never copied into Jarvis conversation history,
the model, database, telemetry, general logs, or Git. The owner must approve
each issuance in the originating Telegram client. A missing or
expired probe credential yields `unknown`, not a repair proposal. Rotation or
revocation of a probe identity also requires owner confirmation.

Probe coverage is per target node: VLESS REALITY on each configured listener
(including the managed TCP 8443 fallback and TCP 443 where present), and
Hysteria2 over UDP 443. A successful probe must demonstrate a completed
proxied HTTPS request and expected egress identity; TCP reachability alone is
insufficient. The client retains strict REALITY/TLS validation; disabling
certificate verification or accepting arbitrary certificates is forbidden.
Probes have fixed intervals, concurrency one per runner/target, small traffic
budgets, hard process/network timeouts, and no retry storm.

The control plane ingests a versioned, authenticated, allowlisted result
through the existing node transport. It binds each result to runner and target,
checks freshness, and distinguishes `healthy`, `failed`, `unavailable`, and
`unknown`. A runner outage, stale result, credential/setup error, or public
egress-test outage cannot by itself establish that the target VPN is broken.
Only a fresh protocol failure corroborated by independent target-side facts
may raise a target incident. Existing deterministic classification and
debounce stay authoritative. The LLM sees only safe status facts and sanitized
logs, never probe secrets or raw client diagnostics.

## Diagnostic follow-up

For a real incident, the first planner answer may request `need_observation`.
The server validates every requested check against the closed read-only
catalog, collects only those checks from the incident's node, appends bounded
typed facts with fresh evidence IDs, and calls the same isolated planner once
more. Empty, unsupported, duplicate, cross-node, or failed checks are recorded
as unavailable safe facts; they never become arbitrary Host Agent operations.
A second `need_observation`, changed incident revision, timeout, or invalid
answer ends in `stop`. The total evidence/prompt byte budget remains capped.
Real playbooks remain disabled even if the model returns high confidence.

## Safe failure E2E

Test fixtures exercise DE and NL independently and together: protocol failure,
runner outage, stale probe, invalid credential, timeout, misleading/prompt-
injection log, unavailable diagnostic check, second observation request,
approval rejection/expiry/replay/stale revision, and unknown Host Agent
mutation outcome. Assertions cover node binding, incident deduplication,
owner-only notifications, redaction, and zero production mutation calls.
Production acceptance uses synthetic fault injection into an isolated test
runtime and read-only live baselines before/after. It must not stop/restart
Xray, Hysteria2, Host Agent, Docker, firewall, or network services, and must
not issue/revoke/rotate real device keys.

## Rollout and acceptance

Implement and test contracts locally first, then deploy the probe runner
disabled. After production-image and Host Agent tests pass, issue the four
dedicated test identities via owner-confirmed Telegram operations and install
their one-time exports without displaying or persisting them in ordinary
application data. Enable one target/protocol at a time, check the client-level
result against a manual external test, and only then wire it into incident
classification. If any stage fails, disable the probe and retain the existing
`unknown` protocol signal; do not guess a repair. Compare DE/NL VPN service
timestamps, restarts, keys, public health, and real open incidents before and
after. Document verified outcomes, update status docs, and commit/push.

## Deferred

- Real repair playbook enablement and autonomous repair execution.
- Key changes for user devices. If later necessary, Telegram must name the
  affected device and reason and require a separate owner button approval.
- Independent third-location monitoring and recovery when both VPSs fail.

## Source notes

The official Hysteria2 client guide documents local SOCKS5/HTTP modes and
credential-based client setup. The official Xray REALITY example documents
the VLESS client ID, flow, server name, public key, and short ID needed for a
real authenticated client probe:

- https://v2.hysteria.network/docs/getting-started/Client/
- https://github.com/XTLS/Xray-examples/blob/main/VLESS-TCP-XTLS-Vision-REALITY/REALITY.ENG.md
