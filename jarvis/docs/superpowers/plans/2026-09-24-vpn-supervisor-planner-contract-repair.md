# VPN Supervisor Planner Contract Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the isolated Supervisor model produce schema-valid closed VPN proposals for an Xray service failure without weakening any execution gate.

**Architecture:** The prompt lists the existing enum values explicitly. `parsePlannerResponse` attaches only bounded, locally generated schema issue paths/kinds to a private error; the existing one corrective call sees those hints, and a second invalid answer still fails. No model output is normalized or promoted into authority.

**Tech Stack:** Node.js 20 CommonJS, Zod, Node test runner, production Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-24-vpn-supervisor-planner-contract-repair-design.md`

## Global Constraints

- Keep the seven-field schema, closed enums, evidence-reference validation, deterministic policy, owner-origin confirmation, and one-retry limit unchanged.
- Never log or persist raw model output, prompts, evidence, credentials, or provider errors.
- No playbook, Host Agent, VPN-service, callback, or provider-configuration change.
- Run the synthetic deployed-model contract before another controlled NL Xray stop.

---

### Task 1: Closed prompt and bounded issue hints

**Files:**
- Modify: `server/src/operations/vpnSupervisor/prompt.js`
- Modify: `server/src/operations/vpnSupervisor/planner.js`
- Test: `server/test/vpnSupervisor.test.js`

**Interfaces:** `parsePlannerResponse(value, context)` still returns a parsed proposal or throws `VpnSupervisorPlannerError`. The error gains private `issueHints: Array<{path:string,kind:string}>` using only known Zod issue paths/kinds. `buildPlannerMessages(context, {correction:true, issueHints})` accepts those hints only for its existing fourth system message.

- [ ] Add a test where the first seven-field JSON uses invented `reasonCode` and `requiredChecks` values, and the second is a valid `restart_xray` proposal. Assert exactly two provider calls; the corrective message includes allowed `SERVICE_FAILED` and `xray_config`, safe issue paths, but not invented values or raw response text.
- [ ] Add a test where both responses are invalid; assert `VPN_SUPERVISOR_RESPONSE_INVALID` and exactly two calls. Keep existing invented-evidence and provider-failure tests.
- [ ] Run `node --test test/vpnSupervisor.test.js` from `server/` and confirm the new tests fail before implementation.
- [ ] Import `REASON_CODES` and `REQUIRED_CHECKS` from `contracts.js` in `prompt.js`, enumerate them in the trusted system policy and corrective message, and state that a `propose` response requires `requiredChecks:[]`.
- [ ] In `planner.js`, turn Zod failures into at most eight distinct hints: paths built only from schema issue path segments matching a fixed identifier or array index; kinds chosen from a closed local whitelist. Never include `issue.message`, `received`, raw JSON, evidence, or arbitrary schema values. Invalid JSON gets a fixed `response:invalid_json` hint. Pass only these hints to the existing second attempt.
- [ ] Run focused tests, then `npm test` from `server/`; inspect the diff for changes to action policy, trust boundaries, secrets, and unrelated dirty files.

### Task 2: Production verification and live acceptance

**Files:**
- Modify: `docs/updates/2026-09-24-vpn-probe-timers-and-nl-dns-acme.md` (append the controlled-drill outcome and rollout)

**Interfaces:** Production image retains the existing catalog; only planner prompt/retry implementation changes. The controlled drill uses the existing `restart_xray` playbook and owner Telegram confirmation.

- [ ] Run `deploy/scripts/preflight.sh`, build a candidate server image, run focused tests inside it, deploy with an exact previous-image rollback tag, and verify Compose health and public smoke. Never display or alter model credentials.
- [ ] Invoke the deployed provider with a synthetic Xray-failure-shaped context; print only schema validation status, decision, and closed playbook ID. If invalid, stop before any VPN fault injection.
- [ ] Immediately before live drill, verify zero open VPN incidents, healthy DE/NL services and scheduled probes, healthy NL Hysteria2, and current NL Xray established-connection count. If risk increased, stop and inform owner.
- [ ] Schedule a seven-minute `systemd-run` one-shot `systemctl start xray.service` watchdog on NL, verify timer active, then stop only NL Xray. Observe three 30-second classifications, one Supervisor proposal, and the exact owner-origin Telegram approval. If no valid proposal promptly appears, manually restore Xray, cancel watchdog, and record the failure.
- [ ] After owner approval, verify the durable Supervisor run selected `restart_xray` and succeeded, NL Xray/Hysteria2 and DE services are healthy, the incident resolved, both probes resume healthy, and the watchdog is cancelled. Do not replay an uncertain restart under a new ID.
- [ ] Record evidence, timings, limits, and any remaining availability or renewal caveats in the rollout document; update `AGENTS.md` and `docs/README.md` only if operational status materially changed.
