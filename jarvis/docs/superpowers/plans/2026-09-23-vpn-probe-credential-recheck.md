# VPN External Probe Credential Recheck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the external-probe unit credential paths and add an owner-confirmed Telegram action that reruns one probe using an already-installed test credential.

**Architecture:** Keep credential storage root-only on each Host Agent and make systemd load URI files from the configured directory, with safe empty placeholders for the protocol not yet installed. Add a closed `probe.recheck` server action that calls only the existing one-shot read/probe operation and records a fresh proof; the four-binding timer gate reads the latest proof-bearing action per binding.

**Tech Stack:** Node.js CommonJS/Fastify, PostgreSQL migrations, Python standard library Host Agent, systemd oneshot/timer units, Telegram inline callbacks.

**Spec:** `docs/superpowers/specs/2026-09-23-vpn-probe-credential-recheck-design.md`

## Global Constraints

- Never persist, print, log, or return VLESS or Hysteria2 credential contents.
- Preserve owner-only access, originating private Telegram confirmation, closed callbacks, and exactly-once Host Agent request semantics.
- Leave both 15-minute probe timers disabled until four distinct fresh owner-confirmed proofs exist and the owner separately confirms activation.
- Do not change real repair playbook flags or exercise a real VPN restart.
- Never replay the original unknown `probe.install` request or mark it successful retroactively.
- Add no production dependency.

---

## File Map

- `host-agent/jarvis_host_agent/vpn_probe_credentials.py`: create/validate the absent protocol placeholder safely during install.
- `host-agent/tests/test_vpn_probe_credentials.py`: placeholder creation, preservation, unsafe path and first-protocol coverage.
- `deploy/vpn/jarvis-vpn-probe@.service`: align EnvironmentFile and LoadCredential paths with `/etc/jarvis-vpn/probes`.
- `host-agent/tests/test_probe_timer_unit.py`: assert path alignment and existing isolation remains enabled.
- `server/src/db/migrations/027_vpn_probe_recheck_action.sql`: allow the new closed action in durable action constraints.
- `server/src/vpn/vpnProbeCredentialWorkflow.js`: implement a one-shot recheck and validate target-specific accepted check.
- `server/src/vpn/vpnRepository.js`: select the latest install/rotate/recheck proof per fixed binding for the timer gate.
- `server/src/vpn/vpnCommandService.js`: add callback parsing, owner confirmation, action dispatch, menu button, and safe result text.
- `server/src/vpn/vpnRecoveryWorker.js`: block automatic replay of rechecks.
- `server/test/migrations.test.js`, `server/test/repositories.test.js`, `server/test/vpnCommandService.test.js`, workflow-focused tests: schema, proof gate, access, replay, and no-install assertions.
- `docs/telegram-menu-contract.md`, `AGENTS.md`, `docs/README.md`, and a dated rollout record: visible callback/action contract and deployment state.

## Task 1: Make Host Agent credentials and systemd paths agree

**Interfaces:** Keep the Host Agent response metadata contract unchanged. The unit consumes the configured root `/etc/jarvis-vpn/probes`; empty absent credentials continue to map to runner status `NOT_CONFIGURED`.

- [ ] Add focused Python tests: installing the first protocol creates only an empty mode-0600 counterpart; reinstalling another protocol preserves an existing valid counterpart; a symlink or non-regular counterpart fails closed.
- [ ] Run `PYTHONPATH=host-agent python3 -m unittest discover -s host-agent/tests -p test_vpn_probe_credentials.py -v` and confirm the new cases fail before implementation.
- [ ] Implement a helper that creates an absent counterpart atomically as a root-owned empty mode-0600 file, refuses symlink/non-regular paths, and never replaces an existing regular file. Invoke it from the existing validated install operation.
- [ ] Update the service template to use `/etc/jarvis-vpn/probes/probe-%i.env`, `/etc/jarvis-vpn/probes/probe-%i-vless.uri`, and `/etc/jarvis-vpn/probes/probe-%i-hysteria2.uri`.
- [ ] Extend unit-file tests to assert these exact paths plus DynamicUser, credential loading, and sandbox directives remain present; run the focused Host Agent tests.
- [ ] Commit the Host Agent and unit-path fix.

## Task 2: Add the closed owner-confirmed probe recheck action

**Interfaces:** `ProbeCredentialWorkflow.recheck(binding)` returns `{targetNode, runnerNode, protocol, acceptedCheck}` only after one `vpn.external_probe.run` succeeds with fresh matching evidence. It must not call export, rotate, or credential-install operations.

- [ ] Add workflow tests for successful VLESS/Hysteria2 proof, `NOT_CONFIGURED`, stale/wrong-node snapshots, failed relevant checks, and exactly one run request; assert there are no export/install calls.
- [ ] Run the workflow tests and confirm the new cases fail before implementation.
- [ ] Implement `recheck(binding)` using `probeBindingFor`, the existing closed run operation, `validateExternalProbe`, and the protocol's `ACCEPTED_CHECK` mapping.
- [ ] Add `probe.recheck` to the durable action constraint in migration 027 and update migration tests.
- [ ] Update the repository gate query to consider latest install/rotate/recheck per source node and protocol; keep any latest unknown/failed attempt disqualifying the binding.
- [ ] Add repository tests for four fresh proofs, original unknown plus later valid recheck, stale proof, and later failed recheck invalidation.
- [ ] Run workflow, repository, and migration focused tests; commit the workflow, schema, and gate changes.

## Task 3: Expose and secure the Telegram recheck button

**Interfaces:** Callback is `vpn:probe:recheck:<sourceNode>:<v|h>`. It resolves only one of the four fixed bindings. Execution requires the existing owner-origin confirmation, and the reply includes only direction, protocol, and pass/unknown/fail outcome.

- [ ] Add parser/grammar tests for all valid callback forms and reject malformed, foreign, oversized, or unknown-node/protocol forms.
- [ ] Add Telegram command-service tests for private owner confirmation, member and foreign-chat denial, expiry/duplicate consumption, successful recheck dispatch, safe unknown/failure reply, and no workflow call before confirmation.
- [ ] Run focused command-service tests and confirm new cases fail before implementation.
- [ ] Implement action validation, confirmation summary, callback/menu rendering, dispatch, and a safe result message for `probe.recheck`; block automatic recovery replay for this action.
- [ ] Run Telegram callback architecture/menu suites and all focused VPN command tests.
- [ ] Update `docs/telegram-menu-contract.md` for the new label/callback and update `AGENTS.md` invariants; commit this Telegram behavior change.

## Task 4: Verify, deploy safely, and record actual status

- [ ] Run required Telegram focused suite, full `server/npm test`, and Host Agent unit suite on Linux; run formatting/lint checks configured by the repository.
- [ ] Inspect production playbook flags and owner-acceptance record, current backup/image state, and both probe timer states before deployment.
- [ ] On NL, inspect the installed credential path using metadata only. Verify the file is a root-owned regular mode-0600 file without reading contents. Create only the missing empty counterpart if the corrected Host Agent installer has not done so. Keep timers disabled.
- [ ] Deploy unit source and server source with timestamped recoverable backups; apply migration 027; run unit verification, preflight, Compose health, and public smoke.
- [ ] Verify both service instances can start without revealing credential values, both VPN services remain healthy, and both probe timers remain inactive/disabled.
- [ ] Update rollout record and `docs/README.md` with verified deployed revision and checks; commit documentation.
- [ ] Wait for the owner to use the new NL-to-DE VLESS recheck button. Record only its closed proof outcome. Continue other bindings only when individually confirmed; never enable timers during this task without all four proofs and a separate explicit owner confirmation.

## Rollback

Restore the exact backed-up server release and systemd unit files; keep timers disabled. Do not remove existing test credentials or audit rows, and do not replay the original unknown installation.
