# VPN Supervisor Observation and Safe E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete one bounded read-only diagnostic follow-up and prove the fail-closed behavior on DE and NL with simulated faults.

**Architecture:** The existing Supervisor evidence collector owns a closed snapshot-based check round. The service invokes it only after a strict `need_observation` answer, passes bounded typed facts to the isolated planner once more, and stops on stale or repeated requests. Fixture E2E uses distinct node clients and no live mutation path.

**Tech Stack:** Node.js 20+, CommonJS, `node:test`, Zod, existing Host Agent `vpn.health.snapshot` protocol.

**Spec:** `docs/superpowers/specs/2026-09-16-vpn-supervisor-cross-node-probes-design.md` (Diagnostic follow-up and Safe failure E2E); existing advisory contract in `docs/superpowers/specs/2026-09-16-vpn-supervisor-llm-advisory-design.md`.

**Status:** Core read-only follow-up and two-node synthetic fault E2E
implemented and deployed on 2026-09-16. Cross-node authenticated client probes
remain separate pending work. Existing owner approval/replay/unknown-outcome
regression tests passed in the full server suite; no live VPN fault was injected.

This is the first of two independent implementation plans from the approved
spec. Cross-node client probes, credential provisioning, and probe rollout get
their own plan and test cycle after this server-only milestone.

## Global Constraints

- No real repair playbook, autonomous mutation, device-key rotation, or emergency shell execution.
- A second `need_observation`, changed incident revision, timeout, or invalid answer ends in `stop`.
- No raw Host Agent output, credentials, client identifiers, or logs in model input or durable data.
- One read-only `vpn.health.snapshot` call per requested check batch, always against the incident's existing node client.
- `plannerContextSchema` caps facts at 30 and evidence at 40; preserve those caps.
- Synthetic failures must not stop/restart Xray, Hysteria2, Host Agent, Docker, firewall, or network services.

---

### Task 1: Closed second-round check collector

**Files:**
- Create: `server/src/operations/vpnSupervisor/observationRound.js`
- Modify: `server/src/operations/vpnSupervisor/contracts.js`
- Test: `server/test/vpnSupervisor.test.js`

**Interfaces:**
- Consumes: `REQUIRED_CHECKS`, `parseVpnHealth`, existing Host Agent client `request(envelope)`.
- Produces: `collectObservationRound({ client, checks, originalHealth, originalFacts, clock })` returning `{ state: 'ready'|'stale'|'unavailable', facts }`. `facts` is a new immutable array with statuses only, no raw snapshot.

- [ ] **Step 1: Write failing tests** for the seven closed checks, duplicate/empty list rejection, one Host Agent request, invalid snapshot, and changed diagnosis. Use a valid `XRAY_SERVICE_FAILURE` fixture and assert:

```js
const result = await collectObservationRound({
  client: fakeClient, checks: ['xray_config'], originalHealth,
  originalFacts: [{ id: 'F1', name: 'xray.service', status: 'unavailable' }],
  clock: () => new Date('2026-09-16T12:00:00Z'),
});
assert.equal(result.state, 'ready');
assert.deepEqual(result.facts.at(-1), { id: 'F2', name: 'check.xray_config', status: 'healthy' });
assert.deepEqual(requests.map((x) => x.operation), ['vpn.health.snapshot']);
```
- [ ] **Step 2: Run** `node --test server/test/vpnSupervisor.test.js`; expect the new collector import/test to fail.
- [ ] **Step 3: Implement** a frozen mapping:

```js
const CHECK_PATHS = Object.freeze({
  xray_config: ['xray', 'config'], xray_listener: ['xray', 'listener'],
  hysteria2_config: ['hysteria2', 'config'], hysteria2_listener: ['hysteria2', 'listener'],
  hysteria2_auth: ['hysteria2', 'auth'], host_dns: ['network', 'dns'],
  host_outbound: ['network', 'outbound'],
});
```

  Validate a unique nonempty subset of `REQUIRED_CHECKS`; send exactly one `vpn.health.snapshot` envelope; parse with `parseVpnHealth`; compare the original/current primary `code`, `scope`, and `likelyCause`; map only requested statuses into `check.<id>` facts; cap total facts at 30. Return `unavailable` with typed unavailable facts on transport/parse failure. Never forward or log raw snapshot/output.
- [ ] **Step 4: Run** `node --test server/test/vpnSupervisor.test.js`; expect pass.
- [ ] **Step 5: Commit** only the collector, contract/test files as `feat(vpn): add bounded observation round`.

### Task 2: Planner follow-up and fail-closed service state

**Files:**
- Modify: `server/src/operations/vpnSupervisor/service.js`
- Test: `server/test/vpnSupervisor.test.js`

**Interfaces:**
- Consumes: `collectObservationRound` from Task 1 and existing `planner.plan(context)`.
- Produces: `analyzeIncident()` returns the final proposal, or `null` on unavailable/stale; `repository.fail(id, closedReasonCode)` records a safe terminal reason.

- [ ] **Step 1: Write failing tests** with a fake planner returning `need_observation` then `propose`; assert exactly two planner calls, only one snapshot call, final model context contains only requested `check.*` facts, and no owner execution button. Add second `need_observation`, empty checks, unsupported checks (planner schema rejection), changed diagnosis, and transport timeout. The core assertion is:

```js
assert.equal(plannerContexts.length, 2);
assert.deepEqual(hostAgentOperations, ['service.logs.read', 'vpn.health.snapshot']);
assert.deepEqual(plannerContexts[1].facts.filter((x) => x.name.startsWith('check.')),
  [{ id: 'F12', name: 'check.xray_config', status: 'healthy' }]);
assert.equal(forbiddenMutationCount, 0);
assert.equal(sentMessages.some((x) => x.buttons?.length), false);
```
- [ ] **Step 2: Run** `node --test server/test/vpnSupervisor.test.js`; expect failures showing the current `DECISION_NEED_OBSERVATION` stop.
- [ ] **Step 3: Implement** the branch after first `planner.plan(context)`:

```js
if (proposal.decision === 'need_observation') {
  const followUp = await collectObservationRound({
    client: this.evidenceCollector.client,
    checks: proposal.requiredChecks,
    originalHealth: health,
    originalFacts: context.facts,
    clock: this.clock,
  });
  if (followUp.state !== 'ready') {
    await this.repository.fail(id, followUp.state === 'stale' ? 'INCIDENT_STALE' : 'OBSERVATION_UNAVAILABLE');
    return null;
  }
  proposal = await this.planner.plan({ ...context, facts: followUp.facts });
  if (proposal.decision === 'need_observation') {
    await this.repository.fail(id, 'OBSERVATION_LIMIT');
    return proposal;
  }
}
```

  Keep the existing real-playbook-disabled branch and notification rules. Catch planner/collector errors with safe closed reason codes, no raw error text.
- [ ] **Step 4: Run** `node --test server/test/vpnSupervisor.test.js`; expect pass.
- [ ] **Step 5: Commit** as `feat(vpn): bound supervisor diagnostic follow-up`.

### Task 3: Two-node simulated fault E2E

**Files:**
- Create: `server/test/vpnSupervisorFaultE2e.test.js`
- Modify: `docs/updates/2026-09-16-vpn-supervisor-multinode-rollout.md`

**Interfaces:**
- Consumes: public `VpnSupervisorService` constructor and the production `VpnSupervisorPlanner` contract with fake provider transport.
- Produces: executable fixture test with independent `de`/`nl` repositories and clients; no production key or Host Agent mutation operation.

- [ ] **Step 1: Write** table-driven `node:test` cases for DE Xray and NL Hysteria2 fault snapshots, injection-shaped journal lines, `need_observation` then `propose`, repeated `need_observation`, invalid model schema, and duplicate incident observation. Probe-runner cases belong to the separate cross-node plan. Fake clients allow only `service.logs.read` and `vpn.health.snapshot`:

```js
const allowed = new Set(['service.logs.read', 'vpn.health.snapshot']);
const client = { async request(envelope) {
  if (!allowed.has(envelope.operation)) {
    forbiddenMutationCount += 1;
    throw new Error('production mutation forbidden in fixture E2E');
  }
  return fixtureResponse(nodeCode, envelope.operation);
} };
```
- [ ] **Step 2: Run** `node --test server/test/vpnSupervisorFaultE2e.test.js`; expect all cases pass after Tasks 1–2. Assert `forbiddenMutationCount === 0`, model prompt has no `vless://`, `hy2://`, Bearer token, or client UUID, and no approval button appears for real playbooks.
- [ ] **Step 3: Run** `npm test` in `server/`, then the existing Host Agent unit suite on DE/NL before deployment. Record actual counts and limitations in the rollout doc; do not claim a live fault was injected.
- [ ] **Step 4: Commit** test and verified status doc as `test(vpn): cover two-node supervisor faults`.

### Task 4: Deployment and non-disruption acceptance

**Files:**
- Modify: `docs/README.md`, `AGENTS.md`, `docs/updates/2026-09-16-vpn-supervisor-multinode-rollout.md` only if verified product/status text changes.

**Interfaces:**
- Consumes: production image and deploy scripts already used by the project.
- Produces: deployed server-only diagnostic follow-up, with all real repair playbooks still disabled.

- [ ] **Step 1: Run** `deploy/scripts/preflight.sh` and built-image focused tests; stop on failure.
- [ ] **Step 2: Deploy** only the server image with existing backup/rollback flow; no Host Agent replacement is needed for this plan.
- [ ] **Step 3: Check** Compose health, public `/health/ready`, DE/NL Operations host and four VPN service states, zero unintended VPN restarts, and unchanged real incident count. Run `deploy/scripts/smoke.sh`.
- [ ] **Step 4: Document** exact test counts and deployed version, commit status changes, and push `main` only after a clean diff check.
