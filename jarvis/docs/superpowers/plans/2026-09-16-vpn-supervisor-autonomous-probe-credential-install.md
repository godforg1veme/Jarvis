# Autonomous VPN Probe Credential Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install DE↔NL probe credentials without exposing their URIs outside a transient authenticated handoff, then run client probes autonomously after owner approval.

**Architecture:** An owner/origin-bound record stores only a fixed probe client id, source node, runner node and protocol. The Server exports an URI transiently from the source Host Agent, forwards it to a strict opposite-node installer, then drops the value. A separate confirmed action enables the reviewed systemd timers only after four successful one-shot probes.

**Tech Stack:** Node.js CommonJS/Zod, Python 3 standard library, PostgreSQL migrations, authenticated Unix Host Agent protocol, systemd.

**Spec:** `docs/superpowers/specs/2026-09-16-vpn-supervisor-autonomous-probe-credential-install-design.md`.

## Global Constraints

- Do not persist, log, render, return, or include a VLESS/`hy2://` URI in prompts, Telegram, audit metadata, PostgreSQL, tests, or Git.
- Only `Probe NL to DE VLESS`, `Probe NL to DE Hysteria`, `Probe DE to NL VLESS`, and `Probe DE to NL Hysteria` can enter this workflow.
- Credential install/rotation and timer enable/disable require a fresh existing owner confirmation bound to the request origin.
- Unknown source mutation outcomes are reconciled and never retried with a new identifier.
- Missing, stale, invalid, or externally ambiguous results remain `unknown`; no repair, rotation, or VPN restart follows.
- Add no dependency and no public endpoint.

---

### Task 1: Strict destination credential store

**Files:**
- Create: `host-agent/jarvis_host_agent/vpn_probe_credentials.py`
- Modify: `host-agent/jarvis_host_agent/config.py`
- Modify: `host-agent/jarvis_host_agent/protocol.py`
- Modify: `host-agent/jarvis_host_agent/actions.py`
- Modify: `host-agent/jarvis_host_agent/server.py`
- Modify: `server/src/operations/hostAgentProtocol.js`
- Test: `host-agent/tests/test_vpn_probe_credentials.py`
- Test: `host-agent/tests/test_protocol.py`
- Test: `host-agent/tests/test_actions.py`
- Test: `server/test/operationsHostAgentProtocol.test.js`

**Interfaces:**
- Consumes: `parse_vless_uri`, `parse_hysteria_uri`, and root-managed `HostAgentConfig.node_code` plus `probe_target`.
- Produces: `install_probe_credential(config, *, target_node, protocol, credential) -> dict` and operation `vpn.external_probe.credential.install` with `{targetNode, protocol, credential}`.

- [ ] **Step 1: Write failing credential-store tests**

```python
def test_installs_only_an_opposite_node_validated_credential(tmp_path):
    result = install_probe_credential(config_for(tmp_path, node_code="nl"), target_node="de", protocol="vless", credential=VLESS_DE)
    assert result["targetNode"] == "de"
    assert (tmp_path / "probe-de-vless.uri").stat().st_mode & 0o777 == 0o600

def test_rejects_same_node_symlink_and_mismatched_uri(tmp_path):
    with self.assertRaises(ProbeCredentialError):
        install_probe_credential(config_for(tmp_path, node_code="de"), target_node="de", protocol="vless", credential=VLESS_DE)
```

- [ ] **Step 2: Run the test before implementation**

Run: `PYTHONPATH=host-agent python3 -m unittest host-agent/tests/test_vpn_probe_credentials.py -q`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement closed parsing and atomic write**

```python
def install_probe_credential(config, *, target_node, protocol, credential):
    if target_node == config.node_code or protocol not in {"vless", "hysteria2"}:
        raise ProbeCredentialError()
    parser = parse_vless_uri if protocol == "vless" else parse_hysteria_uri
    parser(credential, expected_host=PROBE_HOSTS[target_node][protocol])
    _atomic_root_file(credential_path(target_node, protocol), credential)
    return {"targetNode": target_node, "protocol": protocol, "installedAt": utc_now()}
```

Require this root-owned configuration shape, with public hosts discovered from
the current generated VPN state but never copied from a URI into source:

```json
{
  "nodeCode": "nl",
  "probeTarget": {"node": "de", "vlessHost": "public-de-host", "hysteriaHost": "public-de-hysteria-host"}
}
```

The DE config uses the reciprocal `nodeCode: "de"` / `probeTarget.node: "nl"`.
The installer accepts only `targetNode == config.probe_target.node`, then uses
the matching public host for parser validation. Write only an allowlisted
filename with sibling `mkstemp`, `fsync`, mode `0600`, root ownership,
`O_NOFOLLOW`, and `os.replace`. Input errors must be closed uppercase codes and
must not echo the URI.

- [ ] **Step 4: Declare the mutation-only operation and test it**

```python
assert validate_request(request(operation="vpn.external_probe.credential.install", arguments={
    "targetNode": "de", "protocol": "vless", "credential": VLESS_DE,
}))["arguments"]["targetNode"] == "de"
```

Reject extra fields, non-string/oversize credentials, invalid protocol and same-node target. Add the operation to Host Agent mutation claiming in `server.py`; its response includes no credential.

- [ ] **Step 5: Verify and commit**

Run:
```powershell
$env:PYTHONPATH='host-agent'; python -m unittest host-agent/tests/test_vpn_probe_credentials.py host-agent/tests/test_protocol.py host-agent/tests/test_actions.py -q
cd server; node --test test/operationsHostAgentProtocol.test.js
```
Expected: PASS.
Commit: `git add host-agent server && git commit -m "feat(vpn): install bounded probe credentials"`.

### Task 2: Closed probe lifecycle operations

**Files:**
- Modify: `host-agent/jarvis_host_agent/protocol.py`
- Modify: `host-agent/jarvis_host_agent/actions.py`
- Modify: `host-agent/jarvis_host_agent/server.py`
- Modify: `server/src/operations/hostAgentProtocol.js`
- Create: `deploy/vpn/install-probe-units.sh`
- Test: `host-agent/tests/test_actions.py`
- Test: `host-agent/tests/test_protocol.py`
- Test: `server/test/operationsHostAgentProtocol.test.js`

**Interfaces:**
- Consumes: installed root-only credential files and `read_probe_result`.
- Produces: `vpn.external_probe.run`, `.monitor.enable`, and `.monitor.disable`, each accepting `{targetNode}` only.

- [ ] **Step 1: Write failing lifecycle tests**

```python
def test_probe_run_uses_only_fixed_target_instance(run):
    execute(config_for(node_code="nl"), "vpn.external_probe.run", {"targetNode": "de"})
    run.assert_called_with(["/usr/bin/systemctl", "start", "jarvis-vpn-probe@de.service"], timeout=75)
```

- [ ] **Step 2: Run the test before implementation**

Run: `PYTHONPATH=host-agent python3 -m unittest host-agent/tests/test_actions.py -q`
Expected: FAIL because the operation is undeclared.

- [ ] **Step 3: Implement the fixed systemd calls**

```python
def _probe_unit(target_node):
    return f"jarvis-vpn-probe@{target_node}"

def run_probe(config, target_node):
    _require_opposite(config, target_node)
    started = _run(["/usr/bin/systemctl", "start", f"{_probe_unit(target_node)}.service"], timeout=75)
    return {"state": "succeeded", "data": read_probe_result(target_node)} if started["state"] == "succeeded" else {"state": "unknown", "errorCode": "PROBE_RUN_UNKNOWN"}
```

Enable uses exactly `systemctl enable --now jarvis-vpn-probe@<target>.timer`; disable uses exactly `systemctl disable --now ...`. Verify both state values. Do not invoke Xray/Hysteria2 units or accept a caller-provided unit name. The installer copies reviewed templates into `/etc/systemd/system`, reloads systemd, verifies templates, and never enables a timer.

- [ ] **Step 4: Verify and commit**

Run:
```powershell
$env:PYTHONPATH='host-agent'; python -m unittest host-agent/tests/test_actions.py host-agent/tests/test_protocol.py -q
cd server; node --test test/operationsHostAgentProtocol.test.js
```
Expected: PASS.
Commit: `git add host-agent server deploy/vpn && git commit -m "feat(vpn): add probe lifecycle operations"`.

### Task 3: Owner-confirmed transient handoff

**Files:**
- Create: `server/src/vpn/vpnProbeCredentialWorkflow.js`
- Modify: `server/src/vpn/vpnCommandService.js`
- Modify: `server/src/vpn/vpnRecoveryWorker.js`
- Create: `server/src/db/migrations/021_vpn_probe_credentials.sql`
- Test: `server/test/vpnProbeCredentialWorkflow.test.js`
- Test: `server/test/vpnCommandService.test.js`
- Test: `server/test/vpnRecoveryWorker.test.js`

**Interfaces:**
- Consumes: `{sourceNode, runnerNode, protocol, clientId, label}` and two Host Agent clients.
- Produces: `ProbeCredentialWorkflow.install(record)`, `.rotate(record)`, `.enable(record)`, `.disable(record)` and VpnCommandService actions `probe.install`, `probe.rotate`, `probe.enable`, `probe.disable`.

- [ ] **Step 1: Write a failing no-secret workflow test**

```javascript
test('installation forwards a transient export only to the opposite Host Agent', async () => {
  const { workflow, deCalls, nlCalls, persisted } = harness();
  await workflow.install(binding({ sourceNode: 'de', runnerNode: 'nl', protocol: 'vless' }));
  assert.deepEqual(deCalls.map((x) => x.operation), ['vpn.client.export']);
  assert.deepEqual(nlCalls.map((x) => x.operation), ['vpn.external_probe.credential.install', 'vpn.external_probe.run']);
  assert.doesNotMatch(JSON.stringify(persisted), /vless:\/\//i);
});
```

Cover fixed-label/client mismatch, same node, failed/unknown export, failed destination install, failed one-shot probe, timer enable before four verified bindings, and rotation unknown outcome.

- [ ] **Step 2: Run the test before implementation**

Run: `cd server; node --test test/vpnProbeCredentialWorkflow.test.js`
Expected: FAIL because the workflow module does not exist.

- [ ] **Step 3: Implement the binding registry and handoff**

```javascript
const PROBE_BINDINGS = Object.freeze({
  'de:vless': { runnerNode: 'nl', label: 'Probe NL to DE VLESS' },
  'de:hysteria2': { runnerNode: 'nl', label: 'Probe NL to DE Hysteria' },
  'nl:vless': { runnerNode: 'de', label: 'Probe DE to NL VLESS' },
  'nl:hysteria2': { runnerNode: 'de', label: 'Probe DE to NL Hysteria' },
});
```

Choose the protocol-specific export operation. Keep the URI in a lexical variable solely while calling the destination installer and clear it in `finally`; never log request/response objects. Persist only target/runner/protocol/timestamp. Call the one-shot probe only after install succeeds.

Add migration 021 extending `vpn_action_requests.action` with the four `probe.*` values. The recovery worker leaves install/rotate as unknown because they span hosts and must never replay either side. Telegram exposes install only for an exact binding; confirmation text names source, runner and protocol. Enable is offered only after four fresh successful installs; disable is always owner-only.

- [ ] **Step 4: Verify and commit**

Run:
```powershell
cd server
node --test test/vpnProbeCredentialWorkflow.test.js test/vpnCommandService.test.js test/vpnRecoveryWorker.test.js test/operationsHostAgentProtocol.test.js
npm test
```
Expected: PASS.
Commit: `git add server && git commit -m "feat(vpn): confirm probe credential handoff"`.

### Task 4: Safe deployment and live acceptance

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/updates/2026-09-16-vpn-supervisor-multinode-rollout.md`
- Modify: `docs/superpowers/plans/2026-09-16-vpn-supervisor-cross-node-probes.md`
- Test: `server/test/vpnExternalProbeMonitor.test.js`

**Interfaces:**
- Consumes: deployed owner-confirmed workflow and `nodeCode=de`/`nodeCode=nl` Host Agent config.
- Produces: fresh external results distinct from local `protocolProbe`; only owner-approved timers run recurrently.

- [ ] **Step 1: Add cross-node safety regression**

```javascript
test('an unavailable probe result cannot create a repair approval', async () => {
  const snapshot = await monitor.snapshot('de');
  assert.equal(snapshot.checks.vless_tcp_443.status, 'unknown');
  assert.equal(hostMutationCalls.length, 0);
});
```

- [ ] **Step 2: Verify the regression**

Run: `cd server; node --test test/vpnExternalProbeMonitor.test.js`
Expected: PASS with no Host Agent mutation.

- [ ] **Step 3: Deploy with timers disabled**

Record VPN active timestamps/restarts on both VPSs. Read only the current public
VLESS/Hysteria host fields from generated state, then deploy Host Agent code and
root configs with the reciprocal `nodeCode`/`probeTarget` values. Write the
matching non-secret `probe-<target>.env` used by the unit, run
`install-probe-units.sh`, and assert both timers disabled. Build the DE server
image, run focused production-image tests, retain prior image, replace only
`server`, and run `deploy/scripts/smoke.sh https://jarvis.rilora.ru`.

- [ ] **Step 4: Perform owner-gated live acceptance**

For each binding request its Telegram install confirmation, wait for approval, verify one-shot result and expected exit IP, then continue. Stop on the first unhealthy/unknown result and do not activate timers. After four successes request the separate enable confirmation, wait one interval, verify fresh `/vpn_health` results and unchanged VPN service timestamps/restart counters.

- [ ] **Step 5: Document, commit, and publish**

Update actual outcomes and confirmation boundaries. Run:
```bash
git add AGENTS.md README.md docs
git commit -m "docs(vpn): record autonomous probe acceptance"
git fetch origin
git rev-list --left-right --count 'HEAD...@{u}'
git push
```
Expected: clean tree and `0 0` ahead/behind after push.
