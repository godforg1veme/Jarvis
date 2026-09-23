# VPN probe expected-egress baseline implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task with the listed verification gates. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make cross-node VPN probes compare traffic against the target node's independently configured public egress IP, not its VLESS connection address.

**Architecture:** Extend the root-managed Host Agent `probeTarget` with a required validated `expectedExitIp`. Keep VLESS/Hysteria connection endpoints unchanged, generate the existing systemd environment from this new value, and retain exact IP matching and closed probe results. Deploy root-owned config/environment changes and Host Agent code to DE/NL one at a time; never touch probe URI files or enable timers.

**Tech Stack:** Python 3 standard library (`ipaddress`, JSON, unittest), Bash deployment scripts, systemd, SSH.

**Spec:** `docs/superpowers/specs/2026-09-23-vpn-probe-egress-baseline-design.md`

## Global Constraints

- No new production dependencies.
- `probeTarget.expectedExitIp` is a required IP literal; never infer it from `vlessHost` or `hysteriaHost`.
- Keep the observed result schema closed; never persist or return actual probe IPs, URIs, or credentials.
- Production timer units remain disabled and inactive throughout implementation and deployment.
- Do not run any credential-backed probe during implementation or deployment.
- Preserve the existing `probe.install` unknown row, the failed `probe.recheck` row, and every URI file exactly as-is.
- Stop rollout if direct egress is unstable or if a service path does not have one confirmed expected egress address.

---

### Task 1: Add a validated expected-egress field to Host Agent configuration

**Files:**
- Modify: `host-agent/jarvis_host_agent/config.py`
- Modify: `deploy/host-agent/config.example.json`
- Test: `host-agent/tests/test_config.py`

**Interfaces:**
- Consumes: JSON `probeTarget` with `nodeCode`, `vlessHost`, `hysteriaHost`, `expectedExitIp`.
- Produces: `ProbeTarget.expected_exit_ip: str`, validated by `ipaddress.ip_address` during `load_config`.

- [x] **Step 1: Write failing config tests**

Update the valid fixture with a connection address deliberately different from
its expected egress:

```python
"probeTarget": {
    "nodeCode": "nl",
    "vlessHost": "203.0.113.10",
    "hysteriaHost": "vpn.example.test",
    "expectedExitIp": "198.51.100.24",
}
```

Assert `loaded.probe_target.expected_exit_ip == "198.51.100.24"`. Add table-
driven failures for absent `expectedExitIp`, a hostname, an empty value, and an
invalid IP literal. Keep the existing exact-key validation; an unknown nested
key must remain rejected.

- [x] **Step 2: Run the focused test and verify it fails**

Run from the repository root:

```powershell
$env:PYTHONPATH = "host-agent"
python -m unittest discover -s host-agent/tests -p "test_config.py"
```

Expected: the new valid field is rejected as an unexpected nested key and the
new `expected_exit_ip` assertion cannot pass.

- [x] **Step 3: Implement the config field and validation**

Add `expected_exit_ip: str` to `ProbeTarget`; require the exact nested key set
`{"nodeCode", "vlessHost", "hysteriaHost", "expectedExitIp"}`. Validate the
new field with `ipaddress.ip_address` and raise `ProtocolError("probe target is invalid")` without echoing its value. Construct `ProbeTarget` with the validated
field. Add a documentation-only example value `"expectedExitIp": "203.0.113.11"`
to the config example; do not use a real production address there.

- [x] **Step 4: Re-run config tests**

Run the same focused unittest command. Expected: all config tests pass, including
invalid/missing values and an endpoint/egress pair that intentionally differs.

- [ ] **Step 5: Commit the config contract**

```powershell
git add host-agent/jarvis_host_agent/config.py host-agent/tests/test_config.py deploy/host-agent/config.example.json
git commit -m "fix(vpn): separate probe egress from endpoint"
```

### Task 2: Generate the probe environment from the expected egress

**Files:**
- Modify: `host-agent/jarvis_host_agent/vpn_probe_credentials.py`
- Test: `host-agent/tests/test_vpn_probe_credentials.py`

**Interfaces:**
- Consumes: `ProbeTarget.expected_exit_ip` from Task 1.
- Produces: `VPN_PROBE_EXPECTED_EXIT_IP=<expected_exit_ip>` in the same root-only environment file; endpoint fields remain their corresponding host variables.

- [x] **Step 1: Write a failing distinct-address environment test**

Change the test fixture to use `vless_host="203.0.113.10"` and
`expected_exit_ip="198.51.100.24"`. Assert the generated `probe-de.env`
contains `VPN_PROBE_VLESS_HOST=203.0.113.10` and
`VPN_PROBE_EXPECTED_EXIT_IP=198.51.100.24`, and does not contain
`VPN_PROBE_EXPECTED_EXIT_IP=203.0.113.10`.

- [x] **Step 2: Run the focused test and verify it fails**

```powershell
$env:PYTHONPATH = "host-agent"
python -m unittest discover -s host-agent/tests -p "test_vpn_probe_credentials.py"
```

Expected: it fails because the current generator derives the expected IP from
`vless_host`.

- [x] **Step 3: Change only the expected-exit source**

In `_public_probe_environment`, read `expected_exit_ip` from the validated
`probe_target` and serialize it into `VPN_PROBE_EXPECTED_EXIT_IP`. Keep
`VPN_PROBE_VLESS_HOST` and `VPN_PROBE_HYSTERIA_HOST` sourced from their
connection fields. Do not alter credential validation, placeholder creation,
or URI file write ordering.

- [x] **Step 4: Verify credential and environment tests**

Run the focused test command above. Expected: all pass; root-only file semantics
and checks that generated metadata contains no URI/password remain intact.

- [ ] **Step 5: Commit environment generation**

```powershell
git add host-agent/jarvis_host_agent/vpn_probe_credentials.py host-agent/tests/test_vpn_probe_credentials.py
git commit -m "fix(vpn): generate probe exit baseline from config"
```

### Task 3: Prove VLESS and Hysteria checks use the independent baseline

**Files:**
- Test: `host-agent/tests/test_vpn_external_probe_runner.py`
- Modify only if a test exposes a wiring defect: `host-agent/jarvis_host_agent/vpn_external_probe_runner.py`

**Interfaces:**
- Consumes: existing `expected_exit_ip` arguments to `run_checks` and `_run_client`.
- Produces: healthy only when proxied `api.ipify.org` exactly returns that expected IP; a different result stays `EXIT_MISMATCH`.

- [x] **Step 1: Make runner test fixtures use distinct endpoint and exit IPs**

Set the shared `run_checks` fixture's `expected_exit_ip` to
`198.51.100.24` while its synthetic VLESS endpoint remains `203.0.113.10`.
In the mocked `_run_client`, assert every VLESS and Hysteria fixed/hop call
receives `198.51.100.24`. Add a `_run_client` case returning that expected IP
as healthy and a separate case showing that the endpoint IP
`203.0.113.10` remains `EXIT_MISMATCH` when it is not the expected egress.

- [x] **Step 2: Run the focused test to check the new contract**

```powershell
$env:PYTHONPATH = "host-agent"
python -m unittest discover -s host-agent/tests -p "test_vpn_external_probe_runner.py"
```

Expected: tests demonstrate `run_checks` forwards its explicit expected IP
independently of both connection hosts. They may already pass because the
runner accepts this argument today.

- [x] **Step 3: Make the smallest required runner correction**

Keep `vless_host` and `hysteria_host` only for URI host validation and client
configuration. Verify `expected_exit_ip` is passed unchanged to every
`_run_client` call. Change runner code only if the new test proves a real
coupling. Never add the observed IP to return values, logs, result files, or
exceptions.

- [x] **Step 4: Verify fixed, hop, and closed-result cases**

Run the same focused command. Expected: matching configured egress is healthy,
wrong egress is `EXIT_MISMATCH`, and serialized results contain only existing
bounded fields.

- [ ] **Step 5: Commit runner contract tests**

```powershell
git add host-agent/tests/test_vpn_external_probe_runner.py host-agent/jarvis_host_agent/vpn_external_probe_runner.py
git commit -m "test(vpn): cover independent probe egress baseline"
```

### Task 4: Run full Host Agent regression and update operator documentation

**Files:**
- Modify: `docs/VPN_RESILIENCE_RUNBOOK.md`
- Modify: `AGENTS.md`
- Modify: `docs/README.md`

**Interfaces:**
- Documents the same config field and safety boundary as Tasks 1–3; no runtime API or Telegram contract changes.

- [x] **Step 1: Update runbook configuration and current acceptance status**

State that connection addresses and expected egress are separate values and
that an unknown/unstable expected egress blocks acceptance. Record the latest
one-shot as failed with `EXIT_MISMATCH`, keep the original install as
`unknown`, note that baseline correction is pending deployment, and state that
keys were not changed and timers remain disabled. Preserve the four-proof and
fresh owner-confirmation gates.

- [x] **Step 2: Update architecture/status references**

Add to `AGENTS.md` that each Host Agent `probeTarget` has separate service
endpoints and a required root-managed expected egress IP; only the configured
IP is used as the comparison baseline, and results never reveal observed
addresses. In `docs/README.md`, link to the runbook and clearly state that
first binding acceptance remains failed/pending correction, not healthy.

- [x] **Step 3: Run the complete Host Agent suite and diff checks**

```powershell
$env:PYTHONPATH = "host-agent"
python -m unittest discover -s host-agent/tests
git diff --check
```

Expected: all Host Agent tests pass and `git diff --check` reports no whitespace
errors.

- [x] **Step 4: Commit the tested implementation and documentation**

```powershell
git add host-agent deploy/host-agent/config.example.json docs/VPN_RESILIENCE_RUNBOOK.md docs/README.md AGENTS.md
git commit -m "fix(vpn): validate independent probe egress baseline"
```

### Task 5: Deploy trusted egress configuration and Host Agent safely

**Files:**
- Production-only root-managed files on DE and NL: `/etc/jarvis-host-agent/config.json` and `/etc/jarvis-vpn/probes/probe-<peer>.env`.
- Production-only Host Agent tree: `/opt/jarvis-host-agent/`.
- No production URI credential file may be read or changed.

**Interfaces:**
- DE `probeTarget.expectedExitIp` equals independently observed stable NL direct egress; NL `probeTarget.expectedExitIp` equals independently observed stable DE direct egress.
- The systemd environment file reflects its matching Host Agent configuration.

- [ ] **Step 1: Verify a clean candidate and run pre-deploy tests**

Check `git status --short`, run `$env:PYTHONPATH="host-agent"; python -m unittest discover -s host-agent/tests`, and record the candidate commit. Use read-only checks to confirm both timers remain disabled/inactive and both VPN services remain active.

- [ ] **Step 2: Back up production config, environment, and Host Agent source**

On both nodes, create `/root/jarvis-vpn-probe-egress-<commit>/` root-only and
copy the Host Agent config, peer `probe-<peer>.env`, and complete
`/opt/jarvis-host-agent/` source tree, retaining owner and mode. Do not copy,
open, hash, or print `.uri` files. Verify the backup contains exactly the two
named metadata files plus the source tree.

- [ ] **Step 3: Measure and validate both nodes' direct egress**

Make two bounded IPv4 `api.ipify.org` requests on each node, separated by at
least 30 seconds. Keep output in local variables, compare repeats without
printing addresses, and validate each value as a public routable IP. If either
node differs between observations, cannot be associated with its active
outbound path, or differs by protocol, stop without updating config or running
a probe.

- [ ] **Step 4: Stage the tested Host Agent release on both nodes**

Create a temporary archive locally and upload it only after tests pass:

```powershell
$candidate = git rev-parse --short HEAD
$archivePath = Join-Path $env:TEMP "jarvis-host-agent-$candidate.tar"
git archive --format=tar --output="$archivePath" HEAD host-agent deploy/host-agent/deploy.sh
scp $archivePath "jarvis-vps:/tmp/jarvis-host-agent-$candidate.tar"
scp $archivePath "jarvis-vps-new:/tmp/jarvis-host-agent-$candidate.tar"
```

On each node, extract it under a unique
`/tmp/jarvis-host-agent-$candidate/` directory. Staging must not stop or change
the active service.

- [ ] **Step 5: Update and restart DE, verify, then update and restart NL**

Keep the other node and both VPN stacks active. Reconfirm the target node's
probe timer is disabled/inactive. Before stopping either Host Agent, use a
read-only database count to confirm no `vpn_action_requests` are `running` and
no `ops_operation_runs` are `pending` or `accepted`; stop and wait for the
owner if any such operation exists. Stop only that node's
`jarvis-host-agent.service`, atomically set its `probeTarget.expectedExitIp` to
the peer egress from Step 3, and invoke the staged `deploy.sh` with that staged
app root. Its full Host Agent suite must pass before its systemd restart.
Regenerate the root-only environment using Step 6 and verify the Host Agent,
Xray, Hysteria2, config, and timer states. Do this first on DE; update NL only
after DE passes. If any step fails, restore that node's exact config,
environment, and source backups while its service is stopped, restart the
restored service, and stop the rollout.

The atomic config helper verifies the opposite target node, updates only
`expectedExitIp`, validates it via `ipaddress` and `is_global`, writes a
mode-0600 temporary JSON file in `/etc/jarvis-host-agent`, fsyncs it, then uses
`os.replace`. Build the script locally with the closed target code and verified
egress substituted into the two quoted constants, then pipe that script to
`sudo python3 -` over authenticated SSH. Do not put the egress in a remote
command argument or print it. Verify the saved value by boolean comparison
only:

```python
import ipaddress, json, os, tempfile
from pathlib import Path

path = Path("/etc/jarvis-host-agent/config.json")
expected_target = "nl"  # For the NL runner, use "de".
address = ipaddress.ip_address("198.51.100.24")
if not address.is_global:
    raise SystemExit(2)
data = json.loads(path.read_text(encoding="utf-8"))
if data.get("probeTarget", {}).get("nodeCode") != expected_target:
    raise SystemExit(3)
data["probeTarget"]["expectedExitIp"] = str(address)
fd, temporary = tempfile.mkstemp(prefix="config.", suffix=".json", dir=path.parent)
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
```

For the DE deployment, locally replace the sample expected IP with the verified
NL egress; for the NL deployment, replace it with verified DE egress and set
`expected_target` to `de`. Pipe the generated source to SSH without displaying
the value:

```powershell
$update = $update.Replace('"198.51.100.24"', ('"' + $expectedExit + '"'))
$update | ssh jarvis-vps 'sudo -n /usr/bin/python3 -'
```

- [ ] **Step 6: Regenerate and validate public environment metadata**

On each node use the deployed module to regenerate the matching environment
from trusted config:

```bash
sudo env PYTHONPATH=/opt/jarvis-host-agent /usr/bin/python3 - <<'PY'
from jarvis_host_agent.config import load_config
from jarvis_host_agent.vpn_probe_credentials import install_probe_environment

config = load_config("/etc/jarvis-host-agent/config.json")
install_probe_environment(config, target_node=config.probe_target.node_code)
PY
```

Confirm only the matching `probe-<peer>.env` metadata changed and owner/mode
remain root:root 0600. Compare `VPN_PROBE_EXPECTED_EXIT_IP` to config by
boolean only. Confirm URI file metadata is unchanged without reading contents.

- [ ] **Step 7: Verify production health and acceptance state without probes**

Check both timers disabled/inactive, Host Agent/Xray/Hysteria2 active on both
nodes, server health and `/health/ready`. Query current probe audit rows and
verify install remains `unknown` and recheck remains failed. Do not call
`vpn.external_probe.run`, enable timers, or claim acceptance.

- [ ] **Step 8: Remove exact staging artifacts after verified rollout**

After both nodes pass Step 7, remove only the named local tar archive and the
two exact `/tmp/jarvis-host-agent-<commit>` extraction/archive paths after
checking the expanded paths equal those expected. Retain root production
backups for rollback.

### Task 6: Owner-confirmed live acceptance

**Files:** none; manual owner action in private Telegram.

**Interfaces:** the existing `probe.recheck` requires fresh owner confirmation
and checks only the already installed NL-to-DE VLESS credential.

- [ ] **Step 1: Ask the owner to confirm one fresh NL-to-DE VLESS recheck**

After production health passes, tell the owner the previous result was a
baseline failure and ask them to approve a fresh recheck in the private
Telegram external-check menu. Do not trigger it from shell or reuse the prior
request ID.

- [ ] **Step 2: Reconcile only the new confirmed result**

Verify the fresh action row and bounded `vless_tcp_8443` result. If healthy,
record only node, protocol, status, and time. If failed/unknown, stop; do not
retry without another fresh owner confirmation.

- [ ] **Step 3: Leave remaining acceptance explicit**

Require separate confirmed checks for the other three bindings and then a
distinct owner confirmation before timer activation. Keep timers disabled until
those conditions are met. Do not claim a 99.9% guarantee.

## Plan self-review

- Spec coverage: validated field (Task 1), environment generation (Task 2),
  strict protocol checks/results (Task 3), docs (Task 4), safe config/code
  deployment (Task 5), and owner acceptance/four-proof gate (Task 6).
- No placeholder steps: every test, file, production boundary, and stop
  condition is named.
- Type consistency: `ProbeTarget.expected_exit_ip` maps to the existing
  `VPN_PROBE_EXPECTED_EXIT_IP` variable and the runner's `expected_exit_ip: str`.
