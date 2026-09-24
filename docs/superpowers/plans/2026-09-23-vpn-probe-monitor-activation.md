# VPN Probe Monitor Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make owner-confirmed cross-node probe timer activation fail closed when either node does not confirm success.

**Architecture:** Keep the existing four-proof gate and Host Agent operations. Enable the two timers in order, then send one closed disable compensation to the first runner if the second enable does not confirm success. Preserve `unknown` whenever actual timer state may be uncertain.

**Tech Stack:** Node.js CommonJS, `node:test`, existing Host Agent request protocol.

**Spec:** `docs/superpowers/specs/2026-09-23-vpn-probe-monitor-atomicity-design.md`

## Global Constraints

- No new production dependencies or Host Agent operations.
- No credentials, URIs, or raw Host Agent output in durable results, errors, logs, or Telegram messages.
- The existing private-chat owner confirmation and four fresh matching one-shot proofs remain mandatory.
- Never replay an uncertain enable under a new request ID. The disable compensation is a distinct closed operation.
- Production timers remain disabled during development.

---

### Task 1: Fail-closed sequential activation

**Files:**
- Modify: `server/src/vpn/vpnProbeCredentialWorkflow.js`
- Test: `server/test/vpnProbeCredentialWorkflow.test.js`
- Modify: `docs/VPN_RESILIENCE_RUNBOOK.md`

**Interfaces:**
- Consumes: `ProbeCredentialWorkflow._request(node, operation, arguments)`, `resultOrThrow(response, unknownCode, failedCode)`, and `verifiedBindings()`.
- Produces: `ProbeCredentialWorkflow.enable(): Promise<{monitoring: true}>` only after both confirmed successes; otherwise throws `ProbeWorkflowError('PROBE_MONITOR_FAILED'|'PROBE_MONITOR_UNKNOWN'|'PROBE_ACCEPTANCE_INCOMPLETE')`.

- [x] **Step 1: Write failing workflow tests**

Use a synthetic two-client harness with per-operation response queues and call recording. Assert these exact operation sequences: both success: `nl:enable(de), de:enable(nl)`; first failed or unknown: only `nl:enable(de)`; second failed: `nl:enable(de), de:enable(nl), nl:disable(de)`. Make the second unknown and compensation unknown cases assert `PROBE_MONITOR_UNKNOWN`; make a definite second failure plus confirmed compensation assert `PROBE_MONITOR_FAILED`. Verify no result claims `monitoring:true` after any partial outcome.

```js
await assert.rejects(workflow.enable(), /PROBE_MONITOR_UNKNOWN/);
assert.deepEqual(calls.map(({ node, operation }) => `${node}:${operation}`), [
  'nl:vpn.external_probe.monitor.enable',
  'de:vpn.external_probe.monitor.enable',
  'nl:vpn.external_probe.monitor.disable',
]);
```

- [x] **Step 2: Run focused tests to see the old behavior fail**

```powershell
node --test server/test/vpnProbeCredentialWorkflow.test.js
```

- [x] **Step 3: Implement sequential activation and one compensation**

After the proof gate, await NL-to-DE enable and `resultOrThrow` before sending DE-to-NL enable. Catch only the second-phase error; make one NL-to-DE disable request, validate its result, then throw `PROBE_MONITOR_FAILED` only for a definite second failure plus confirmed compensation. All other second-phase or compensation errors become `PROBE_MONITOR_UNKNOWN`. Never repeat either enable.

```js
const first = await this._request('nl', 'vpn.external_probe.monitor.enable', { targetNode: 'de' });
resultOrThrow(first, 'PROBE_MONITOR_UNKNOWN', 'PROBE_MONITOR_FAILED');
let secondError;
try {
  const second = await this._request('de', 'vpn.external_probe.monitor.enable', { targetNode: 'nl' });
  resultOrThrow(second, 'PROBE_MONITOR_UNKNOWN', 'PROBE_MONITOR_FAILED');
} catch (error) { secondError = error; }
if (secondError) {
  try {
    const compensation = await this._request('nl', 'vpn.external_probe.monitor.disable', { targetNode: 'de' });
    resultOrThrow(compensation, 'PROBE_MONITOR_UNKNOWN', 'PROBE_MONITOR_FAILED');
  } catch { throw new ProbeWorkflowError('PROBE_MONITOR_UNKNOWN'); }
  throw new ProbeWorkflowError(secondError?.code === 'PROBE_MONITOR_FAILED' ? 'PROBE_MONITOR_FAILED' : 'PROBE_MONITOR_UNKNOWN');
}
return { monitoring: true };
```

- [x] **Step 4: Run focused and adjacent tests**

```powershell
node --test server/test/vpnProbeCredentialWorkflow.test.js server/test/vpnCommandService.test.js
```

- [x] **Step 5: Update runbook and run full regression**

Document that a failed second enable triggers one first-side disable, that unknown outcomes require operator timer-state inspection, and that production timers remain off until four owner-approved checks. Then run:

```powershell
cd server
npm test
```

- [x] **Step 6: Review and commit**

```powershell
git diff --check
git add server/src/vpn/vpnProbeCredentialWorkflow.js server/test/vpnProbeCredentialWorkflow.test.js docs/VPN_RESILIENCE_RUNBOOK.md docs/superpowers/plans/2026-09-23-vpn-probe-monitor-activation.md
git commit -m "fix(vpn): compensate partial probe monitor activation"
```
