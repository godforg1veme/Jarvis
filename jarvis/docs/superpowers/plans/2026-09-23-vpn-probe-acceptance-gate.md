# VPN Probe Acceptance Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permit recurring external VPN probes only after four fresh, authenticated, protocol-matched one-shot checks actually pass.

**Architecture:** The credential workflow validates the closed Host Agent probe result immediately after installation. It returns only a public accepted-check identifier. The VPN action result persists that identifier, and the repository counts only four matching, recent accepted records before offering timer activation. Existing records without the proof cannot unlock monitoring.

**Tech Stack:** Node.js 20/CommonJS, PostgreSQL JSONB, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-16-vpn-supervisor-autonomous-probe-credential-install-design.md`; Hysteria hopping acceptance is refined by `docs/superpowers/specs/2026-09-18-happ-resilient-dynamic-subscription-design.md`.

## Global Constraints

- Do not enable timers, create/rotate credentials, restart VPN services, or alter VPS firewall/DNS during this code change.
- VLESS acceptance is a fresh `vless_tcp_8443=healthy` result; Hysteria2 acceptance is a fresh `hysteria2_udp_hop=healthy` result. A fixed-443 Hysteria result alone is insufficient.
- Invalid, stale, wrong-node, missing, failed, or unknown probe output never counts as accepted.
- Persist only node, protocol, closed accepted check, and installation timestamp; never persist or log a URI, password, token, raw Host Agent response, or process output.
- Four distinct source-node/protocol pairs must have owner-confirmed, successful installs with accepted proof recorded in the last 24 hours before enabling the timers.

---

### Task 1: Validate each one-shot probe before accepting an install

**Files:**
- Modify: `server/src/vpn/vpnProbeCredentialWorkflow.js`
- Modify: `server/test/vpnProbeCredentialWorkflow.test.js`

**Interfaces:**
- Consumes: `vpn.external_probe.run` result data and `validateExternalProbe(value, sourceNode, now)`.
- Produces: `{ targetNode, runnerNode, protocol, installedAt, acceptedCheck }` or a closed `ProbeWorkflowError`.

- [ ] **Step 1: Write failing tests** for fresh VLESS 8443 success, fresh Hysteria hop success, and rejection of failed/unknown/stale/wrong-node/malformed results. A successful fixture must include all four closed checks, `version: 1`, matching `targetNode`, and `sampledAt` equal to the injected clock.
- [ ] **Step 2: Run** `node --test server/test/vpnProbeCredentialWorkflow.test.js`; expect the unsafe current implementation to accept at least one failure fixture.
- [ ] **Step 3: Implement** a closed mapping `{ vless: 'vless_tcp_8443', hysteria2: 'hysteria2_udp_hop' }`, validate the whole snapshot with `validateExternalProbe`, reject `unknown` as `PROBE_ACCEPTANCE_UNKNOWN` and `failed` as `PROBE_ACCEPTANCE_FAILED`, and return no raw probe object.
- [ ] **Step 4: Re-run** the focused test; require pass.
- [ ] **Step 5: Commit** the workflow and its tests.

### Task 2: Persist only accepted proof and guard timer activation

**Files:**
- Modify: `server/src/vpn/vpnCommandService.js`
- Modify: `server/src/vpn/vpnRepository.js`
- Modify: `server/test/vpnCommandService.test.js`
- Modify: `server/test/repositories.test.js`

**Interfaces:**
- Consumes: Task 1's `acceptedCheck`.
- Produces: a bounded JSONB action result with a matching accepted check; `hasVerifiedProbeBindings()` returns true only for four recent, distinct and matched proofs.

- [ ] **Step 1: Write failing tests** showing a legacy `succeeded` install without `acceptedCheck` does not unlock timers, four correctly paired proof rows do, and the sanitized action result contains no URI or raw probe body.
- [ ] **Step 2: Run** `node --test server/test/vpnCommandService.test.js server/test/repositories.test.js`; expect failure on the new proof assertions.
- [ ] **Step 3: Implement** closed serialization of `acceptedCheck` and a parameter-free SQL predicate requiring `result->>'acceptedCheck'` to match the protocol's required check, while matching result node/runner/protocol to the confirmed action arguments. Keep the existing 24-hour and distinct-pair bounds.
- [ ] **Step 4: Run** the focused tests, then `npm test` in `server/`, the Host Agent suite, and `git diff --check`.
- [ ] **Step 5: Commit** the repository/service changes and tests. Do not deploy or enable timers without separate owner acceptance.
