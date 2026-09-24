# Happ resilient dynamic subscription implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Happ subscription use a validated Hysteria2 port-hopping pool without changing its URL or credentials, expose reliable hop health, and document bounded recovery when an ISP blocks UDP paths.

**Architecture:** Add one closed, public-only port-pool contract shared by the Host Agent probe and the subscription serializer. A hop probe will establish a real Hysteria2 SOCKS tunnel and exercise more than one destination port. The server publishes only a validated active DE/NL pool in ordinary Happ Base64 subscriptions, demotes a node only from the hop check, and preserves VLESS+REALITY as a separate TCP route.

**Tech Stack:** Node.js 20/CommonJS, Fastify service tests with `node --test`, Python 3 standard library Host Agent tests, Hysteria2 v2.12, PostgreSQL migrations, systemd one-shot probe units, iptables/UFW on Ubuntu.

**Spec:** `docs/superpowers/specs/2026-09-18-happ-resilient-dynamic-subscription-design.md`

## Global Constraints

- Keep Happ on its existing standard Base64 `/sub/:token` subscription response; emit Sing-box JSON only for explicit `?format=sing-box`.
- Never persist or log subscription tokens, URIs, Hysteria passwords, VLESS credentials, raw packet data, local paths, or Host Agent socket payloads.
- The current full host allowlist remains `20000-50000/udp`, with multi-IP-safe DNAT to the Hysteria listener. Do not restore `REDIRECT` for the secondary DE address.
- A service/listener/fixed-443 check never establishes that Happ port hopping works; require a successful full Hysteria2 hop probe and a real Happ acceptance test.
- Keep all automatic probe timers disabled. One-shot probes need the existing owner-approved dedicated probe credential flow.
- Do not add production dependencies, change DNS, rotate node credentials, reissue subscription URLs, or restart Hysteria2 as part of a pool rotation.
- `mportHopInt` is not treated as an official Hysteria2 URI parameter. The supported Happ URI encoding is selected only by device acceptance evidence.
- Existing VLESS+REALITY fields (`flow`, `sni`, `pbk`, `sid`, `fp`, port 8443) remain byte-for-byte equivalent after this work.

---

## File structure

| File | Responsibility |
|---|---|
| `host-agent/jarvis_host_agent/hysteria_port_pool.py` | Strict public port-pool validation and native Hysteria2 client config construction. No credentials or shell execution. |
| `host-agent/jarvis_host_agent/vpn_external_probe.py` | Extends the closed external-probe result schema with the real hopping check. |
| `host-agent/jarvis_host_agent/vpn_external_probe_runner.py` | Runs the bounded two-hop Hysteria2 SOCKS/HTTPS verification with temporary local config only. |
| `host-agent/tests/test_hysteria_port_pool.py` | Unit tests for invalid/published pool rejection and native client config. |
| `host-agent/tests/test_vpn_external_probe.py` | Contract tests for the fourth check and no-secret output. |
| `host-agent/tests/test_vpn_external_probe_runner.py` | Process-mocked test of two tunnel requests separated by a required hop interval. |
| `server/src/vpn/hysteriaPortPoolService.js` | Validates public pool records, selects a node’s current pool, and returns no credentials. |
| `server/src/vpn/vpnSubscriptionService.js` | Serializes the selected pool into Happ URIs and relies on the hop check for Hysteria2 demotion. |
| `server/src/operations/vpnSupervisor/externalProbeMonitor.js` | Validates and exposes `hysteria2_udp_hop` alongside the existing checks. |
| `server/src/db/migrations/024_vpn_hysteria_port_pools.sql` | Stores node-scoped public active pools and revisions; no tokens or credential material. |
| `server/src/vpn/vpnPortPoolRepository.js` | Owner-scoped, revision-aware repository for the public pool records. |
| `server/test/vpnHysteriaPortPoolService.test.js` | Tests closed pool validation, deterministic public selection, and failure-safe fallback. |
| `server/test/vpnSubscriptionService.test.js` | Tests Happ Base64 URI output and node demotion from the hop check. |
| `server/test/vpnExternalProbeMonitor.test.js` | Tests that stale/malformed hop-probe results fail closed. |
| `docs/VPN_RESILIENCE_RUNBOOK.md` | Current operator and owner runbook, separate from historical rollout notes. |
| `docs/README.md`, `AGENTS.md` | Current status, verification commands, and the no-timer safety boundary. |

## Data contracts

```python
# host-agent/jarvis_host_agent/hysteria_port_pool.py
PortPool = TypedDict("PortPool", {
    "version": int,          # exactly 1
    "nodeCode": str,         # "de" or "nl"
    "generation": str,       # canonical UUID
    "ports": list[int],      # 4..12 unique increasing members of 20000..50000
    "hopIntervalSeconds": int,  # 5..45
})

def validate_port_pool(value: object, *, expected_node: str) -> PortPool: ...
def build_hysteria_hop_client_config(parsed: dict, local_port: int, pool: PortPool) -> dict: ...
```

```js
// server/src/vpn/hysteriaPortPoolService.js
class HysteriaPortPoolService {
  constructor({ repository, now = () => new Date() }) {}
  async activeForNode(nodeCode) {} // -> { nodeCode, generation, ports, hopIntervalSeconds } | null
  async activeForSubscription() {} // -> { de: PortPool|null, nl: PortPool|null }
}

// server/src/vpn/vpnPortPoolRepository.js
async function findActive(nodeCode) {} // one public row or null
async function replaceActive({ nodeCode, expectedRevision, generation, ports, hopIntervalSeconds, changedBy }) {}
```

```text
External probe checks (exact set):
vless_tcp_443 | vless_tcp_8443 | hysteria2_udp_443 | hysteria2_udp_hop
```

### Task 1: Define the closed Hysteria2 port-pool contract

**Files:**
- Create: `host-agent/jarvis_host_agent/hysteria_port_pool.py`
- Create: `host-agent/tests/test_hysteria_port_pool.py`
- Modify: `host-agent/jarvis_host_agent/vpn_external_probe.py:21-25,116-121`
- Modify: `host-agent/tests/test_vpn_external_probe.py:48-95`

**Interfaces:**
- Consumes: an already parsed Hysteria credential from `parse_hysteria_uri`; it contains host, auth, SNI, and Salamander password but is never serialised in a result.
- Produces: a `PortPool` value and native Hysteria client configuration with `server` as `host:port1,port2,...` and `transport.udp.hopInterval` as `<seconds>s`.

- [ ] **Step 1: Write failing port-pool tests**

```python
def test_valid_pool_is_public_bounded_and_canonical(self):
    pool = validate_port_pool({
        "version": 1, "nodeCode": "de",
        "generation": "123e4567-e89b-42d3-a456-426614174000",
        "ports": [20011, 22229, 26549, 30013],
        "hopIntervalSeconds": 15,
    }, expected_node="de")
    self.assertEqual(pool["ports"], [20011, 22229, 26549, 30013])

def test_pool_rejects_secrets_duplicates_out_of_range_and_wrong_node(self):
    for invalid in (
        {"version": 1, "nodeCode": "de", "generation": "x", "ports": [20011]*4, "hopIntervalSeconds": 15},
        {"version": 1, "nodeCode": "nl", "generation": "123e4567-e89b-42d3-a456-426614174000", "ports": [20011, 22229, 26549, 30013], "hopIntervalSeconds": 15},
        {"version": 1, "nodeCode": "de", "generation": "123e4567-e89b-42d3-a456-426614174000", "ports": [19999, 22229, 26549, 30013], "hopIntervalSeconds": 15},
    ):
        with self.assertRaises(PortPoolError):
            validate_port_pool(invalid, expected_node="de")
```

- [ ] **Step 2: Run the new contract test and verify failure**

Run: `PYTHONPATH=host-agent python -m unittest host-agent/tests/test_hysteria_port_pool.py -v`

Expected: FAIL because `hysteria_port_pool` and `PortPoolError` do not exist.

- [ ] **Step 3: Implement validation and native config construction**

```python
PORT_MIN, PORT_MAX = 20000, 50000
MIN_PORTS, MAX_PORTS = 4, 12

def build_hysteria_hop_client_config(parsed, local_port, pool):
    verified = validate_port_pool(pool, expected_node=pool["nodeCode"])
    return {
        "server": f'{parsed["host"]}:{",".join(str(port) for port in verified["ports"])}',
        "auth": parsed["auth"],
        "tls": {"sni": parsed["sni"]},
        "obfs": {"type": "salamander", "salamander": {"password": parsed["obfsPassword"]}},
        "transport": {"udp": {"hopInterval": f'{verified["hopIntervalSeconds"]}s'}},
        "socks5": {"listen": f'127.0.0.1:{_local_port(local_port)}', "disableUDP": True},
    }
```

Keep `build_hysteria_client_config` unchanged for fixed-443 health. Do not accept a URI interval extension as input to this native contract.

- [ ] **Step 4: Add external-probe schema coverage**

Add `hysteria2_udp_hop` to `CHECK_NAMES`. Extend the test’s expected check set and assert that a malformed result containing a URI/password still fails with `ProbeConfigError`; `read_probe_result` must return the exact four-key unknown shape.

- [ ] **Step 5: Run focused Host Agent tests**

Run: `PYTHONPATH=host-agent python -m unittest host-agent/tests/test_hysteria_port_pool.py host-agent/tests/test_vpn_external_probe.py -v`

Expected: PASS with no URI or synthetic password in assertion output.

- [ ] **Step 6: Commit**

```bash
git add host-agent/jarvis_host_agent/hysteria_port_pool.py host-agent/jarvis_host_agent/vpn_external_probe.py host-agent/tests/test_hysteria_port_pool.py host-agent/tests/test_vpn_external_probe.py
git commit -m "feat(vpn): define Hysteria port-pool contract"
```

### Task 2: Probe a real Hysteria2 hop tunnel instead of only fixed UDP 443

**Files:**
- Modify: `host-agent/jarvis_host_agent/vpn_external_probe_runner.py:77-149`
- Modify: `host-agent/tests/test_vpn_external_probe_runner.py:35-90`
- Modify: `deploy/vpn/jarvis-vpn-probe@.service:1-27`

**Interfaces:**
- Consumes: fixed credential files loaded only through systemd `LoadCredential`, parsed credential data, and a public `PortPool` read from a root-owned `VPN_PROBE_HYSTERIA_HOP_POOL` JSON environment value.
- Produces: the closed `hysteria2_udp_hop` status; it returns only one of the existing six failure codes and never emits pool JSON, argv, config, or credentials.

- [ ] **Step 1: Write the failing runner test**

```python
def test_hop_check_uses_native_multiport_config_and_requires_two_successes(self):
    pool = {"version": 1, "nodeCode": "de", "generation": "123e4567-e89b-42d3-a456-426614174000",
            "ports": [20011, 22229, 26549, 30013], "hopIntervalSeconds": 5}
    with patch.object(runner, "_read_hop_pool", return_value=pool), \
         patch.object(runner, "_curl_ip", side_effect=["198.51.100.7", "198.51.100.7", "198.51.100.7"]), \
         patch.object(runner, "_sleep_for_hop") as sleep:
        result = self._run()
    self.assertEqual(result["checks"]["hysteria2_udp_hop"], {"status": "healthy", "failureCode": None})
    sleep.assert_called_once_with(5)
```

Also write a case where the second proxied request fails and assert `CHECK_UNAVAILABLE`, and a missing/hostile pool case that returns `NOT_CONFIGURED` or `CHECK_UNAVAILABLE` without spawning a client.

- [ ] **Step 2: Run the runner test and verify failure**

Run: `PYTHONPATH=host-agent python -m unittest host-agent/tests/test_vpn_external_probe_runner.py -v`

Expected: FAIL because `_read_hop_pool`, `_sleep_for_hop`, and the fourth check do not exist.

- [ ] **Step 3: Implement bounded two-hop verification**

Implement `_read_hop_pool` with a maximum 512-byte JSON input, parse through `validate_port_pool`, and reject any node mismatch. Add `_run_hysteria_hop_client(parsed, pool, expected_exit_ip)` that:

1. writes the config from `build_hysteria_hop_client_config` inside the existing `TemporaryDirectory` mode `0600`;
2. starts exactly `/usr/local/bin/hysteria client --disable-update-check --log-level error --config <temp>`;
3. waits up to four seconds for loopback SOCKS;
4. fetches `api.ipify.org` through SOCKS, waits exactly `hopIntervalSeconds`, then fetches it again;
5. returns healthy only if both public IP results match `expected_exit_ip`;
6. terminates/kills the child using the existing bounded cleanup path.

Map no-client/missing-pool to `NOT_CONFIGURED`, malformed pool to `CHECK_UNAVAILABLE`, and failed second request to `CHECK_UNAVAILABLE`. Never expand the public failure-code vocabulary in this task.

- [ ] **Step 4: Pass the pool through the existing protected unit**

Add `EnvironmentFile=/etc/jarvis-vpn/probe-%i.env` key `VPN_PROBE_HYSTERIA_HOP_POOL`. Keep `LoadCredential` as the only secret input. The environment value is public-only JSON and has no URI/hostname/password fields. Document its max size and exact schema as a systemd comment.

- [ ] **Step 5: Run focused runner and schema tests**

Run: `PYTHONPATH=host-agent python -m unittest host-agent/tests/test_vpn_external_probe.py host-agent/tests/test_vpn_external_probe_runner.py -v`

Expected: PASS; test snapshots contain `hysteria2_udp_hop` and no credential text.

- [ ] **Step 6: Commit**

```bash
git add host-agent/jarvis_host_agent/vpn_external_probe_runner.py host-agent/tests/test_vpn_external_probe_runner.py deploy/vpn/jarvis-vpn-probe@.service
git commit -m "feat(vpn): verify Hysteria port hopping"
```

### Task 3: Persist public active pools and use them in Happ output

**Files:**
- Create: `server/src/db/migrations/024_vpn_hysteria_port_pools.sql`
- Create: `server/src/vpn/vpnPortPoolRepository.js`
- Create: `server/src/vpn/hysteriaPortPoolService.js`
- Create: `server/test/vpnHysteriaPortPoolService.test.js`
- Modify: `server/src/vpn/vpnSubscriptionService.js:1-45,230-390,500-560`
- Modify: `server/test/vpnSubscriptionService.test.js:1-145,145-245`

**Interfaces:**
- Consumes: public `{ nodeCode, generation, ports, hopIntervalSeconds, revision }` records from PostgreSQL and probe snapshots with `hysteria2_udp_hop`.
- Produces: Happ URI lines `hy2://…@host:port1,port2,…/?…#tag` for active pools, and retains all secret fields only in the in-memory URI serialization path.

- [ ] **Step 1: Write migration and repository tests first**

```js
test('activeForSubscription returns only a bounded public pool per node', async () => {
  const pools = await service.activeForSubscription();
  assert.deepEqual(pools.de.ports, [20011, 22229, 26549, 30013]);
  assert.equal(JSON.stringify(pools).includes('password'), false);
});

test('Happ URI uses the supplied active DE pool and does not emit mportHopInt', () => {
  const text = Buffer.from(subscription.buildBase64Profile({ nodes: { deHy2 }, portPools: { de: dePool } }), 'base64').toString('utf8');
  assert.match(text, /vpn-de\.rilora\.ru:20011,22229,26549,30013/);
  assert.equal(text.includes('mportHopInt'), false);
});
```

- [ ] **Step 2: Run the server tests and verify failure**

Run: `node --test server/test/vpnHysteriaPortPoolService.test.js server/test/vpnSubscriptionService.test.js`

Expected: FAIL because the repository/service and `portPools` parameter do not exist; the old test still expects `mportHopInt`.

- [ ] **Step 3: Add the public-only PostgreSQL model**

Create migration `024_vpn_hysteria_port_pools.sql` with exactly one active record per `node_code`:

```sql
CREATE TABLE vpn_hysteria_port_pools (
  node_code TEXT PRIMARY KEY CHECK (node_code IN ('de', 'nl')),
  generation UUID NOT NULL UNIQUE,
  ports INTEGER[] NOT NULL,
  hop_interval_seconds SMALLINT NOT NULL CHECK (hop_interval_seconds BETWEEN 5 AND 45),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by TEXT NOT NULL CHECK (char_length(changed_by) BETWEEN 1 AND 120)
);
```

Repository reads must return only those six public columns. `replaceActive` must issue one parameterized optimistic-concurrency update scoped to `node_code AND revision`, increment revision, and return `null` on a stale update. Validate ports in JavaScript before either read result or write request is accepted.

- [ ] **Step 4: Implement the port-pool service and Happ serializer**

`HysteriaPortPoolService.activeForSubscription()` calls `findActive('de')` and `findActive('nl')` in parallel and returns `null` for a malformed/missing record rather than guessing a full range.

Update `VpnSubscriptionService` constructor to accept `portPoolService`. During `resolveSubscription`, fetch `portPools` in parallel with probe snapshots. In `buildBase64Profile`, only add a Hysteria line if its node has a validated pool; `formatHy2` must serialise a comma-separated port list, copy only `obfs`, `obfs-password`, `sni`, and optional `insecure`, and omit `mportHopInt`. Do not change the VLESS serializer.

For explicit Sing-box JSON, set `server_port` to the first active port and `ports` to the exact comma-separated list; set `hop_interval` from the public pool. Do not infer a Happ JSON response.

- [ ] **Step 5: Make demotion depend on hop health**

Change `_isProbeHealthy` calls for Hysteria candidates to `hysteria2_udp_hop`. A missing/stale/unknown snapshot remains optimistic only when a validated pool exists; a `failed` hop check demotes Hysteria behind healthy alternatives. Fixed-443 remains visible in Operations but cannot restore Hysteria priority.

- [ ] **Step 6: Run server tests**

Run: `node --test server/test/vpnHysteriaPortPoolService.test.js server/test/vpnSubscriptionService.test.js`

Expected: PASS; Base64 never contains `mportHopInt`, a malformed pool emits no Hysteria URI, and credentials remain absent from public pool service results.

- [ ] **Step 7: Commit**

```bash
git add server/src/db/migrations/024_vpn_hysteria_port_pools.sql server/src/vpn/vpnPortPoolRepository.js server/src/vpn/hysteriaPortPoolService.js server/src/vpn/vpnSubscriptionService.js server/test/vpnHysteriaPortPoolService.test.js server/test/vpnSubscriptionService.test.js
git commit -m "feat(vpn): publish validated Happ port pools"
```

### Task 4: Surface hop health without weakening the Operations contract

**Files:**
- Modify: `server/src/operations/vpnSupervisor/externalProbeMonitor.js:1-53`
- Modify: `server/test/vpnExternalProbeMonitor.test.js:1-45`
- Modify: `server/src/vpn/vpnHealthSchema.js:4-159`
- Modify: `server/test/vpnHealthSchema.test.js`
- Modify: `server/src/vpn/vpnCommandService.js:18-31,330-430`
- Modify: `server/test/vpnCommandService.test.js`

**Interfaces:**
- Consumes: the exact four-check Host Agent result.
- Produces: a non-secret user-visible health label `Hysteria2 port-hopping tunnel`, plus the closed next check `hysteria_hop_probe` when its status is failed or unknown.

- [ ] **Step 1: Write failing monitor and schema tests**

```js
test('hop probe is required to classify Hysteria as healthy', () => {
  const value = result();
  value.checks.hysteria2_udp_hop = { status: 'failed', failureCode: 'PROXY_CONNECT_FAILURE' };
  assert.equal(validateExternalProbe(value, 'de', NOW).checks.hysteria2_udp_hop.status, 'failed');
});

test('VPN health reports hop failure without echoing pool or URI', () => {
  const health = makeHealth({ hysteria2: { protocolProbe: 'failed' } });
  assert.equal(health.diagnosis.likelyCause, 'hysteria2_port_hop');
  assert.equal(JSON.stringify(health).includes('hy2://'), false);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test server/test/vpnExternalProbeMonitor.test.js server/test/vpnHealthSchema.test.js server/test/vpnCommandService.test.js`

Expected: FAIL because the check/schema/copy do not know `hysteria2_udp_hop`.

- [ ] **Step 3: Implement closed health mapping**

Add the fourth check to monitor `CHECKS`, the Zod schema, and unknown fallback. Introduce only the closed incident code `HYSTERIA2_PORT_HOP_FAILURE`, mapped to `failureKind: 'vpn.hysteria2.port_hop_failure'`, `scope: 'hysteria2'`, severity `error`, confidence `high`, likely cause `hysteria2_port_hop`, and next check `hysteria_hop_probe`.

In Telegram/Operations rendering, show only the Russian label `Hysteria2: hopping-путь` and the bounded remedy `Проверить hopping-туннель`. Never display ports, generations, subscription metadata, URI fragments, or raw failure process output.

- [ ] **Step 4: Run focused Node tests**

Run: `node --test server/test/vpnExternalProbeMonitor.test.js server/test/vpnHealthSchema.test.js server/test/vpnCommandService.test.js`

Expected: PASS with malformed/stale fourth-check snapshots failing closed.

- [ ] **Step 5: Commit**

```bash
git add server/src/operations/vpnSupervisor/externalProbeMonitor.js server/src/vpn/vpnHealthSchema.js server/src/vpn/vpnCommandService.js server/test/vpnExternalProbeMonitor.test.js server/test/vpnHealthSchema.test.js server/test/vpnCommandService.test.js
git commit -m "feat(vpn): report Hysteria hopping health"
```

### Task 5: Publish the resilience runbook and correct current status

**Files:**
- Create: `docs/VPN_RESILIENCE_RUNBOOK.md`
- Modify: `docs/README.md`
- Modify: `AGENTS.md`
- Modify: `docs/updates/2026-09-16-vpn-subscription-network-rollout.md`
- Modify: `docs/updates/2026-09-16-happ-subscription-compatibility.md`

**Interfaces:**
- Consumes: the production contracts from Tasks 1–4.
- Produces: the single current operational sequence for owner, operator, and implementation agents; historical updates retain their dates and receive only a supersession/status note.

- [ ] **Step 1: Write the runbook from evidence order**

Use these exact sections:

```markdown
# Jarvis VPN Resilience Runbook
## Scope and safety boundaries
## Protocol contracts: Happ, Hysteria2, VLESS/REALITY, split routing
## Normal subscription lifecycle
## Diagnostic decision tree
## Hysteria2 port-pool and hop-probe procedure
## Recovery paths and owner confirmation
## What never enters logs, databases, callbacks, or chat
## One-shot acceptance checklist
## Source links and version observations
```

State that a fixed `:443` success is basic-path evidence only; two proxied requests across a configured hop interval plus Happ’s real-device acceptance are mandatory. State that an ISP-wide UDP block requires VLESS fallback and that Happ automatic failover is not claimed without evidence.

- [ ] **Step 2: Update status documents precisely**

In `docs/README.md` and `AGENTS.md`, replace any assertion that port-hopping/Happ traffic is verified with: *host data plane verified; real Happ port-hopping acceptance pending*. Preserve the existing statement that periodic probe timers are disabled. Add the new runbook to the documentation index.

In both historical rollout documents, prepend a dated note linking this spec/runbook and explaining that their fixed-443 or DNAT checks are insufficient for Happ acceptance. Do not rewrite their historical claims in place.

- [ ] **Step 3: Verify documentation safety and links**

Run:

```powershell
rg -n "sub_[A-Za-z0-9]|hy2://|hysteria2://|vless://|password|obfs-password" docs/VPN_RESILIENCE_RUNBOOK.md docs/README.md AGENTS.md
git diff --check
```

Expected: links/protocol names may remain, but no raw token, credential, or URI appears. `git diff --check` exits 0.

- [ ] **Step 4: Commit**

```bash
git add docs/VPN_RESILIENCE_RUNBOOK.md docs/README.md AGENTS.md docs/updates/2026-09-16-vpn-subscription-network-rollout.md docs/updates/2026-09-16-happ-subscription-compatibility.md
git commit -m "docs: add VPN resilience runbook"
```

### Task 6: Deploy only after local checks and owner-approved acceptance

**Files:**
- Modify only if generated by Tasks 1–5; do not edit `deploy/secrets/*`, state files, credentials, timers, or VPS configuration by hand.

**Interfaces:**
- Consumes: passing server/Host Agent tests, migration 024, deployed unit update, and a dedicated already-approved probe credential.
- Produces: a deployed but timer-disabled feature plus a documented Happ acceptance result.

- [ ] **Step 1: Run the complete adjacent suites locally**

Run:

```powershell
cd server; npm test
cd ..
$env:PYTHONPATH='host-agent'; python -m unittest discover -s host-agent/tests
```

Expected: all existing and new tests pass. Do not publish a server build or start timers if either suite fails.

- [ ] **Step 2: Review the migration and subscription output without secrets**

Run the database migration diff/status workflow specified in `AGENTS.md`. In a test repository/client fixture, decode the subscription body and assert exact public port-list formatting, no `mportHopInt`, and unchanged VLESS fields. Do not call a production `/sub/:token` URL in terminal output.

- [ ] **Step 3: Deploy using the project’s normal preflight and Compose procedure**

Run `deploy/scripts/preflight.sh`, apply migration 024 with the existing deployment procedure, rebuild only the server image, and use `deploy/scripts/smoke.sh`. On DE and NL, install the revised probe unit and public-only probe-pool environment through the existing deployment mechanism. Verify each timer remains `disabled`.

- [ ] **Step 4: Run owner-approved one-shot hop probes**

Use the existing closed `vpn.external_probe.run` operation once per direction. Require each returned `hysteria2_udp_hop` result to be `healthy`; a fixed-443 healthy result with hop unknown/failed blocks pool publication.

- [ ] **Step 5: Perform Happ acceptance on the owner phone**

With the already imported subscription, verify in this order:

1. refresh the same subscription URL and confirm no new link/key is requested;
2. select DE Hysteria2 and obtain a real HTTPS response through the tunnel;
3. keep it active across at least three configured hop intervals with traffic continuing;
4. enable then disable Russian split routing, fully reconnect after each change, and verify domestic direct and international proxy paths separately;
5. refresh the unchanged subscription after a safe fixture pool change and confirm the new port list operates;
6. verify DE and NL VLESS 8443 independently.

Record only pass/fail, timestamp, node, transport, and next action. Do not record IP addresses, profile URLs, packets, secrets, or phone content.

- [ ] **Step 6: Commit the verified documentation status**

```bash
git add docs/README.md AGENTS.md docs/VPN_RESILIENCE_RUNBOOK.md docs/updates
git commit -m "docs: record Happ hopping acceptance"
```

Only do this after all six owner-phone checks pass. Otherwise write a dated `pending acceptance` note and leave the feature in a non-verified status.

## Plan self-review

- Spec coverage: Tasks 1–2 implement the real hop contract; Task 3 supplies dynamic, same-URL public pool output; Task 4 makes the evidence visible; Task 5 delivers the required methodology; Task 6 keeps rollout and timer safety explicit.
- Scope: no alternative client/protocol, DNS migration, automatic timer, secret rotation, or firewall repair is introduced. The consumer-network limitation is documented rather than hidden.
- Type consistency: `PortPool` carries `nodeCode`, `generation`, `ports`, and `hopIntervalSeconds` through Host Agent validation, server repository/service, and serializers; the external result has exactly four named checks.
- Placeholder scan: no future work markers or implicit error-handling steps remain; every action has a concrete test or operational command.
