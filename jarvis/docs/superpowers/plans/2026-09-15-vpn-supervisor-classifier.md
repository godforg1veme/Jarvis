# VPN Supervisor deterministic classifier implementation plan

**Date:** 2026-09-15

**Design:** `docs/superpowers/specs/2026-09-15-vpn-supervisor-classifier-design.md`

**Milestone boundary:** diagnosis and Operations integration only. Do not add
LLM calls, remote-node enrollment, or repair execution in this plan.

## Outcome

The deployed Host Agent will return a versioned, deterministic and secret-free
diagnosis with every `vpn.health.snapshot`. Jarvis Server will strictly validate
that diagnosis, feed one correlated primary VPN incident through the existing
Operations incident pipeline, and show the same result in Operations and
Telegram `/vpn_health`. Protocol probe uncertainty will remain visible without
opening a critical incident. No mutation will be invoked.

This is the first executable contract for the later central, multi-VPS,
LLM-assisted Supervisor. The current VPS remains the only managed node in this
milestone.

## Task 1: implement the pure Host Agent classifier

**Files**

- Create `host-agent/jarvis_host_agent/vpn_incident_classifier.py`.
- Create `host-agent/tests/test_vpn_incident_classifier.py`.

**Work**

1. Define closed constants for snapshot statuses, primary incident codes,
   scopes, severity, confidence, likely causes, evidence paths, safe next
   checks, and secondary signals.
2. Implement `classify_vpn_incident(snapshot)` as a pure function. It must not
   read files, run commands, log, access configuration, or mutate its input.
3. Validate the complete snapshot shape. Missing, extra, malformed, or
   unsupported values return bounded `VPN_SNAPSHOT_INVALID` with low confidence
   and no repair eligibility; they must not throw unhandled exceptions.
4. Build evidence only as `{path, status}` pairs selected from the closed path
   catalog. Never copy arbitrary values or error text into a diagnosis.
5. Apply causal ordering: proven shared host dependency, configuration, auth
   dependency, service, listener, multi-stack correlation, then uncertainty.
   Do not treat host DNS/outbound as the VPN root cause unless a failing probe
   has that declared dependency.
6. Emit `XRAY_PROTOCOL_UNVERIFIED` and
   `HYSTERIA2_PROTOCOL_UNVERIFIED` only as informational secondary signals when
   the current protocol probes are `unknown`.
7. Return `state=healthy` with `primary=null` when all required local checks are
   healthy; unknown optional protocol probes do not change that to an incident.

**Tests**

Use table-driven subtests for all taxonomy entries and combinations required by
the design. Add explicit cases for key-order determinism, input immutability,
bounded evidence, two-stack correlation, config plus service/listener failure,
unrelated outbound failure, and malformed snapshots containing strings that
look like passwords, UUIDs, paths, VLESS URIs, and Hysteria URIs. Assert that no
untrusted string survives in the result.

Run:

```powershell
$env:PYTHONPATH='host-agent'
python -m unittest discover -s host-agent/tests -p test_vpn_incident_classifier.py
Remove-Item Env:PYTHONPATH
```

## Task 2: attach diagnosis to the Host Agent snapshot

**Files**

- Modify `host-agent/jarvis_host_agent/actions.py`.
- Modify `host-agent/tests/test_actions.py`.
- Modify `host-agent/tests/test_protocol.py` only if the operation response
  fixture needs to reflect the added bounded result; the request contract stays
  unchanged.

**Work**

1. Build the existing raw snapshot exactly once in `_vpn_health_snapshot()`.
2. Pass that object to the pure classifier and add its result as `diagnosis`.
3. Preserve every existing probe and status field for backward compatibility.
4. Do not add raw command output, state-file paths, credentials, peer data, or
   exception messages.

**Tests**

- Update the healthy snapshot expectation to include the deterministic
  diagnosis and protocol-unverified secondary signals.
- Add one failing-auth example proving that a healthy Hysteria service plus an
  unavailable auth endpoint is classified as the auth dependency, not as a
  dead Hysteria process.
- Retain the existing secret-substring assertions and extend them to the full
  diagnosis serialization.

Run the two focused test modules, then:

```powershell
$env:PYTHONPATH='host-agent'
python -m unittest discover -s host-agent/tests
Remove-Item Env:PYTHONPATH
```

## Task 3: add one shared strict server contract

**Files**

- Create `server/src/vpn/vpnHealthSchema.js`.
- Create `server/test/vpnHealthSchema.test.js`.
- Modify `server/src/operations/routes/readRoutes.js`.
- Modify `server/test/operationsHostAgentProtocol.test.js` only if shared
  response fixtures are affected; do not weaken the Host Agent envelope schema.

**Work**

1. Define strict Zod schemas for the raw snapshot and diagnosis. Use exact
   enums, bounded arrays, strict nested objects, and a discriminated contract
   that requires `primary=null` for non-incident states.
2. Cross-check that `code`, lowercase `failureKind`, scope, cause, evidence,
   checks, severity, and confidence are valid combinations. A Host Agent cannot
   invent a playbook, action, path, or incident kind.
3. Export one parser used by Operations and the Telegram/Desktop VPN command
   service. Do not maintain competing validators.
4. Make `/ops/api/vpn/health` reject an invalid successful payload with the
   existing bounded server error path; never pass arbitrary Host Agent data to
   a client.

**Tests**

Cover a valid healthy payload, every diagnosis state, extra fields, excessive
evidence, invalid code/kind pairings, free-form evidence, and secret-bearing
injected fields.

Run:

```powershell
Set-Location server
node --test test/vpnHealthSchema.test.js test/operationsHostAgentProtocol.test.js
Set-Location ..
```

## Task 4: integrate classified VPN incidents without duplicates

**Files**

- Create `server/src/operations/incidents/vpnIncidentAdapter.js`.
- Modify `server/src/operations/incidents/incidentEngine.js` only to expose the
  smallest backward-compatible classified observation hook needed by the
  adapter.
- Modify `server/src/operations/repositories/operationsRepository.js` with a
  focused method for resolving superseded `vpn.*` classified incidents.
- Modify `server/src/operations/collectors/collectorWorker.js`.
- Modify `server/src/operations/operationsRuntime.js`.
- Modify `server/test/operationsIncidents.test.js`.
- Modify `server/test/operationsCollectorWorker.test.js`.

**Work**

1. Keep `IncidentEngine.observe(service)` behavior unchanged for non-VPN
   callers.
2. Add classified observation support that preserves classifier severity and
   bounded technical detail instead of recomputing them from generic systemd
   state.
3. Debounce ordinary classified failures on repeated identical primary codes.
   A changed diagnosis resets the pending count. This milestone does not make
   any diagnosis repair-eligible.
4. On a healthy diagnosis, resolve open classified `vpn.*` incidents. When a
   new primary diagnosis is durably opened, resolve superseded classified VPN
   kinds so only one primary remains open for the host.
5. Serialize only the validated diagnosis into the existing
   `technical_detail` field. Do not add a database or migration in this
   milestone.
6. Extend VPN collection to request `vpn.health.snapshot` once per cycle and
   feed its parsed diagnosis to the adapter. A failed request or rejected
   payload must produce a debounced, bounded `vpn.health_unavailable` incident
   instead of disappearing into logs.
7. Preserve `vpn.status` and `vpn.hysteria2.status` collection for client-count
   and readiness metrics, but stop those generic paths from opening competing
   VPN incidents. Service inventory and state-change events remain intact.
8. Inject the adapter from `operationsRuntime.js` using the existing repository,
   incident engine, host ID, and notifier pipeline.

**Tests**

- Three repeated observations open one incident and notify once.
- Healthy recovery resolves the classified incident silently.
- A changed primary kind replaces the old kind rather than leaving both open.
- Protocol uncertainty alone opens nothing.
- Classifier severity is preserved.
- Generic Xray/Hysteria collection still writes metrics but does not open a
  duplicate incident.
- Invalid Host Agent diagnosis is rejected and causes no incident write.

Run:

```powershell
Set-Location server
node --test test/operationsIncidents.test.js test/operationsCollectorWorker.test.js
Set-Location ..
```

## Task 5: render one diagnosis consistently

**Files**

- Modify `server/src/vpn/vpnCommandService.js`.
- Modify `server/test/vpnCommandService.test.js`.
- Modify Operations UI files only if the current health endpoint is already
  rendered there; do not create a new Supervisor dashboard in this milestone.

**Work**

1. Parse health responses with the shared server schema before rendering.
2. Add a concise Russian diagnosis block to `/vpn_health`: incident code,
   severity, likely cause, affected stack, confidence, and declarative next
   checks.
3. Show protocol uncertainty as informational and explicitly state that
   automatic repair is disabled in this milestone.
4. Use closed display dictionaries for every enum. Do not render raw evidence
   values, unknown strings, technical detail, credentials, or paths.

**Tests**

Cover healthy, Hysteria auth dependency, Xray failure, multi-stack failure,
invalid payload, informational unknown protocol probes, and secret absence in
both command and callback output.

Run:

```powershell
Set-Location server
node --test test/vpnCommandService.test.js test/vpnHealthSchema.test.js
Set-Location ..
```

## Task 6: regression, documentation, and rollout

**Files**

- Update `docs/README.md` with verified status only after tests pass.
- Update `AGENTS.md` only with material runtime/status changes verified by the
  implementation and production rollout.
- Add a dated update under `docs/updates/` if that is the existing release
  evidence pattern.

**Local verification**

1. Run `git diff --check` and inspect the complete diff for secret-bearing
   fixtures or accidental generated state.
2. Run the full Host Agent suite:

   ```powershell
   $env:PYTHONPATH='host-agent'
   python -m unittest discover -s host-agent/tests
   Remove-Item Env:PYTHONPATH
   ```

3. Run focused server tests, then `npm test` in `server/`.
4. Run `npm test` and `npm run build` in `ops-ui/` only if UI files changed.
5. Confirm no changing Host Agent operation was invoked by any test outside
   explicit fakes.

**Deployment and production acceptance**

1. Commit and push the reviewed implementation before deployment.
2. Use `scripts/deployHostAgent.ps1` and the existing unified Host Agent deploy
   flow; do not selectively copy production files.
3. Run `deploy/scripts/preflight.sh`, deploy the server through the established
   Compose flow, verify Compose health, then run `deploy/scripts/smoke.sh`.
4. Request one real `vpn.health.snapshot` without printing the complete payload
   if it could contain unexpected data. Extract and display only the allowlisted
   status, diagnosis code, severity, scope, and confidence.
5. Verify the live snapshot classifies the expected healthy local state, with
   protocol probes remaining informational while they are unimplemented.
6. Verify authenticated Operations and owner Telegram `/vpn_health` show the
   same diagnosis.
7. Verify recent Operations records contain no credential, UUID, URI, private
   path, or raw command output.
8. Do not inject a production fault and do not claim autonomous repair; repair
   remains disabled until the later policy, playbook, LLM dry-run, and fault-
   injection milestones are separately approved and implemented.

## Completion criteria

- One pure classifier is the source of truth on the managed node.
- Host Agent, Operations, and Telegram agree on the same validated diagnosis.
- Existing incident persistence and notification delivery are reused without
  duplicate VPN incidents.
- Every supported diagnosis is deterministic and table-tested.
- `unknown` never becomes `healthy` and never creates a critical incident by
  itself.
- No secret-bearing or free-form field can enter diagnosis evidence.
- No repair, LLM, firewall, routing, port, or credential action exists in this
  milestone.
- Production acceptance is reported with exact commands and sanitized evidence.
