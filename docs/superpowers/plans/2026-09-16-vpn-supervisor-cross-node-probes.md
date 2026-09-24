# VPN Supervisor Cross-Node Client Probes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Obtain bounded real client-level VLESS and Hysteria2 reachability results for DE and NL from the opposite VPS, without changing device keys or enabling repairs.

**Architecture:** A non-root systemd timer on each runner uses dedicated owner-approved test credentials and official client binaries to send a small HTTPS request through the opposite node. A closed, read-only Host Agent operation returns only the last result. Jarvis Server validates freshness and runner/target binding and treats stale/setup/network ambiguity as `unknown`; it does not promote an uncorroborated probe failure into an automatic repair.

**Tech Stack:** Python 3 standard library, existing Xray/Hysteria2 binaries, systemd credentials/timers, Host Agent authenticated Unix socket, Node.js CommonJS/Zod.

**Spec:** `docs/superpowers/specs/2026-09-16-vpn-supervisor-cross-node-probes-design.md`.

## Global Constraints

- No new production dependency or public endpoint.
- Keep probe credentials out of Git, database, prompts, conversation history, telemetry, and logs.
- Use dedicated test identities issued only by the existing Telegram owner-confirmed path; do not read or reuse device credentials.
- Probe execution is read-only from the target VPN perspective and has hard process/network/traffic bounds.
- Probe runner unavailable, stale result, invalid credential, or egress-check outage means `unknown`, not a target VPN failure.
- Real repair playbooks remain disabled; no autonomous key rotation or service restart.

---

### Task 1: Pure client configuration and result contracts

**Files:**
- Create: `host-agent/jarvis_host_agent/vpn_external_probe.py`
- Create: `host-agent/tests/test_vpn_external_probe.py`

**Interfaces:**
- `parse_vless_uri(uri: str, *, expected_host: str) -> dict`: strict bounded, target-bound, protocol-specific fields for a client-only config.
- `parse_hysteria_uri(uri: str, *, expected_host: str) -> dict`: strict bounded, target-bound Hysteria2 auth/TLS/obfs fields.
- `build_xray_client_config(parsed: dict, local_port: int) -> dict` and `build_hysteria_client_config(parsed: dict, local_port: int) -> dict`.
- `validate_probe_result(value: object, expected_target: str, now: datetime) -> dict`: closed result with `targetNode`, `sampledAt`, and three listener statuses.

- [x] Write fixture tests using synthetic URI values, including malformed URI, unexpected security fields, control characters, missing public key, missing Hysteria auth/obfs, swapped target host, and secret-shaped result fields. Assert exception text never echoes URI contents.
- [x] Run `PYTHONPATH=host-agent python3 -m unittest host-agent/tests/test_vpn_external_probe.py`; observed expected import failure before implementation.
- [x] Implement exact URI allowlists and result schema with `urllib.parse`/`ipaddress`; reject duplicate query keys.
- [x] Run the focused test: 6/6 passed. Commit as `feat(vpn): define external client probe contracts`.

### Task 2: Bounded non-root probe runner and Linux unit

Implementation note: the runner is a separate `vpn_external_probe_runner.py` module;
the units are `jarvis-vpn-probe@.service` and `jarvis-vpn-probe@.timer` so the
opposite target is fixed by the instance name. Both remain disabled until
owner-approved credentials are installed.

**Files:**
- Modify: `host-agent/jarvis_host_agent/vpn_external_probe.py`
- Create: `deploy/vpn/jarvis-vpn-probe.service`
- Create: `deploy/vpn/jarvis-vpn-probe.timer`
- Modify: `host-agent/tests/test_vpn_external_probe.py`

**Interfaces:**
- CLI `python3 -m jarvis_host_agent.vpn_external_probe --target de|nl --credential-dir PATH --result PATH` writes one atomic JSON result, never a share URI or raw client output.
- Credential files `vless.uri` and `hysteria2.uri` are root-owned source files exposed only through systemd `LoadCredential` to the non-root process.

- [x] Add synthetic fake-process/fake-HTTPS tests for three loopback clients, expected egress IP, no-proxy bypass, private config cleanup, missing credentials, and unavailable egress.
- [x] Implement bounded process lifecycle, no shell, suppressed child output, and atomic result write.
- [x] Add disabled-by-default templated oneshot/timer with `DynamicUser`, systemd credentials, filesystem/network restrictions, and a hard runtime cap. `systemd-analyze verify` passed on DE; neither unit is enabled.
- [ ] Production validation of both official client configs using owner-approved test credentials remains pending.

### Task 3: Read-only Host Agent result operation

**Files:**
- Modify: `host-agent/jarvis_host_agent/protocol.py`, `host-agent/jarvis_host_agent/actions.py`
- Modify: `server/src/operations/hostAgentProtocol.js`
- Test: `host-agent/tests/test_actions.py`, `server/test/operationsHostAgentProtocol.test.js`

**Interfaces:**
- Closed operation `vpn.external_probe.snapshot` takes `{}` and returns only validated `targetNode`, `sampledAt`, and status/failure-code fields; source file is runner-owned and read-only to Host Agent.

- [x] Tests reject extra arguments and secret-bearing result fields; stale or missing result is `unknown`.
- [x] Wire only the new read-only operation; it reads only the bounded result file.
- [x] Full local Host Agent suite passed 93/93; server protocol tests passed.

### Task 4: Control-plane binding and safe classification

**Files:**
- Create: `server/src/operations/vpnSupervisor/externalProbeMonitor.js`
- Modify: `server/src/operations/operationsRuntime.js`, `server/src/vpn/vpnCommandService.js`
- Test: `server/test/vpnExternalProbeMonitor.test.js`, `server/test/vpnCommandService.test.js`

**Interfaces:**
- The monitor reads NL runner results for target DE and DE runner results for target NL using authenticated clients; it validates target identity and five-minute freshness.
- `/vpn_health` adds closed external-probe statuses separately from the Host Agent's local `protocolProbe`, preserving the distinction until corroborated.

- [x] Validate swapped runner/target, stale result, runner outage, and DE/NL isolation; no mutation is requested.
- [x] Add a read-only on-demand view to `/vpn_health`, explicitly separate from local `protocolProbe`. No external result creates a repair proposal.
- [x] Full local server suite passed 463/463.
- [ ] Debounced owner notification and incident corroboration are deferred until real client probes have been accepted on both VPSs; a lone external failure currently appears as "requires verification" in `/vpn_health` only.

### Task 5: Gated production acceptance

**Files:**
- Modify: `AGENTS.md`, `README.md`, `docs/README.md`, `docs/updates/2026-09-16-vpn-supervisor-multinode-rollout.md` after verification.

**Interfaces:**
- Four dedicated test identities (VLESS/Hysteria2 × DE/NL) issued by existing Telegram owner buttons; one-time exports installed as root-owned systemd credential sources on the opposite runner.

- [x] Run full local suites (93 Host Agent, 463 server) and 21 production-image focused tests. Record pre-change VPN service timestamps/restart counters and public smoke; direct client/key acceptance remains pending.
- [x] Deploy Host Agent read-only operation on DE/NL and server health view with probe timers **disabled**; verify healthy snapshots, public smoke, and retained rollback copies/image.
- [ ] Ask owner to approve each of four dedicated test-client issuance requests in Telegram. Do not bypass the button via SSH or test script. Install each one-time export without printing it, enable one probe at a time, and compare with a manual client-level external check.
- [ ] After all protocols pass, verify read-only cross-node status, stale/runner-down behavior, no VPN restart, zero unintended key changes, and owner notification semantics. Update docs with measured results, commit and push.
