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
- `server/src/telegram/messageService.js` and `server/src/vpn/vpnRepository.js`: carry Telegram chat type and bind action confirmation/rejection to the originating conversation.
- `server/test/migrations.test.js`, `server/test/repositories.test.js`, `server/test/vpnCommandService.test.js`, workflow-focused tests: schema, proof gate, access, replay, and no-install assertions.
- `docs/telegram-menu-contract.md`, `AGENTS.md`, `docs/README.md`, and a dated rollout record: visible callback/action contract and deployment state.

## Task 1: Make Host Agent credentials and systemd paths agree

**Interfaces:** Keep the Host Agent response metadata contract unchanged. The unit consumes the configured root `/etc/jarvis-vpn/probes`; empty absent credentials continue to map to runner status `NOT_CONFIGURED`.

- [x] Add focused Python tests: installing the first protocol creates only an empty mode-0600 counterpart; reinstalling another protocol preserves an existing valid counterpart; a symlink or non-regular counterpart fails closed.
- [x] Run the Host Agent credential tests and observe the expected failure before implementation. Windows cannot create the symlink fixture; Linux verification remains in Task 4.
- [x] Implement a helper that creates an absent counterpart atomically as a root-owned empty mode-0600 file, refuses symlink/non-regular paths, and never replaces an existing regular file. Invoke it from the existing validated install operation.
- [x] Update the service template to use `/etc/jarvis-vpn/probes/probe-%i.env`, `/etc/jarvis-vpn/probes/probe-%i-vless.uri`, and `/etc/jarvis-vpn/probes/probe-%i-hysteria2.uri`.
- [x] Extend unit-file tests to assert these exact paths plus DynamicUser, credential loading, and sandbox directives remain present; focused tests pass.
- [ ] Commit the Host Agent and unit-path fix.

## Task 2: Add the closed owner-confirmed probe recheck action

**Interfaces:** `ProbeCredentialWorkflow.recheck(binding)` returns `{targetNode, runnerNode, protocol, acceptedCheck}` only after one `vpn.external_probe.run` succeeds with fresh matching evidence. It must not call export, rotate, or credential-install operations.

- [x] Add workflow tests for successful VLESS/Hysteria2 proof, `NOT_CONFIGURED`, stale/wrong-node snapshots, failed relevant checks, and exactly one run request; assert there are no export/install calls.
- [x] Implement `recheck(binding)` using the fixed route mapping, existing closed run operation, `validateExternalProbe`, and the protocol's `ACCEPTED_CHECK` mapping.
- [x] Add `probe.recheck` to the durable action constraint in migration 027 and update migration tests.
- [x] Update the repository gate query to consider latest install/rotate/recheck per source node and protocol; a latest unknown/failed attempt disqualifies that binding.
- [x] Add repository tests for conversation binding and latest-proof query inclusion. Live PostgreSQL gate acceptance remains in Task 4.
- [x] Run workflow, repository, and migration focused tests; all passed.

## Task 3: Expose and secure the Telegram recheck button

**Interfaces:** Callback is `vpn:probe:recheck:<sourceNode>:<v|h>`. It resolves only one of the four fixed bindings. Execution requires the existing owner-origin confirmation, and the reply includes only direction, protocol, and pass/unknown/fail outcome.

- [x] Add parser/grammar tests for the valid callback and malformed, oversized, and unknown-node/protocol forms.
- [x] Add Telegram command-service tests for private confirmation, non-private denial, duplicate confirmation consumption, successful dispatch, and no workflow call before confirmation.
- [x] Implement validation, confirmation summary, callback/menu rendering, dispatch, safe result messages, and no recovery replay.
- [x] Bind action approval/rejection to the originating conversation, channel, and device.
- [x] Run Telegram callback architecture/menu suites and focused VPN command tests; all passed.
- [x] Update the Telegram contract and button architecture documentation.

## Task 4: Verify, deploy safely, and record actual status

- [x] Run required Telegram focused suite (63/63), full server suite (548/548), and Host Agent unit suite (111 tests; one symlink case skipped on Windows). Linux symlink and production unit checks remain.
- [ ] Inspect production playbook flags and owner-acceptance record, current backup/image state, and both probe timer states before deployment.
- [ ] On NL, inspect the installed credential path using metadata only. Verify the file is a root-owned regular mode-0600 file without reading contents. Create only the missing empty counterpart if the corrected Host Agent installer has not done so. Keep timers disabled.
- [ ] Deploy unit source and server source with timestamped recoverable backups; apply migration 027; run unit verification, preflight, Compose health, and public smoke.
- [ ] Verify both service instances can start without revealing credential values, both VPN services remain healthy, and both probe timers remain inactive/disabled.
- [ ] Update rollout record, `AGENTS.md`, and `docs/README.md` with verified deployed revision and checks; commit documentation.
- [ ] Wait for the owner to use the new NL-to-DE VLESS recheck button. Record only its closed proof outcome. Continue other bindings only when individually confirmed; never enable timers during this task without all four proofs and a separate explicit owner confirmation.

## Rollback

Restore the exact backed-up server release and systemd unit files; keep timers disabled. Do not remove existing test credentials or audit rows, and do not replay the original unknown installation.
