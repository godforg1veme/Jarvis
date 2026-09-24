# VPN Supervisor host-bound callback routing implementation plan

> **Execution note:** Completed on 2026-09-24. The host-bound callback fix is deployed, all planned test/deployment gates passed, and the owner-approved NL Xray repair drill passed postchecks. Preserve unrelated worktree changes.

**Goal:** Route every Supervisor button to the service for the VPS stored on its durable run, and reject direct cross-host service calls before details or actions.

**Design:** Add a callback router backed by the shared Supervisor repository and a registry of configured services. The callback UUID remains unchanged; the persisted `host_id` selects exactly one registered service. The router checks owner/private-chat scope before lookup, fails closed on missing or ambiguous routes, and the target service independently checks host ownership. No Telegram-visible contract changes.

**Verification:** Exercise all three callback actions on DE, NL, and a third registered fixture; fail closed on malformed, missing, unknown, and ambiguous targets; verify owner/chat scope, replay/expiry/stale behavior, and wrong-service direct calls. Run the Telegram architecture gate and full server suite. Then run deployment preflight, production-image tests, Compose health, and public smoke. Finish with the previously authorized owner-confirmed NL Xray repair drill under a seven-minute conditional restore watchdog, then verify both VPN stacks and scheduled probes.

## Tasks

1. [x] Implement `VpnSupervisorCallbackRouter` with strict callback parsing, pre-lookup owner/private-chat checks, persisted-host resolution, unique registry matching, and safe closed failures. Add focused router tests for all actions and registered nodes plus malformed/unknown/ambiguous/unavailable cases.
2. [x] Add a host-ownership defense in `VpnSupervisorService.handleCallback` after owner/chat authorization and before returning details or processing a decision. Test direct wrong-service calls for all actions and verify no Host Agent request or record disclosure.
3. [x] Wire the router in `runtime.js` using every configured Supervisor node service. Keep command handling and existing button bytes unchanged. Add Telegram routing tests and update the menu contract, architecture guide, `AGENTS.md`, and current rollout record to describe persisted-host routing and its verified status.
4. [x] Run the focused Supervisor and Telegram tests, the complete server suite, production candidate-image coverage, deployment preflight, Compose health, and public smoke. Review the diff for callback-contract and safety-boundary drift.
5. [x] Preflight DE/NL health and existing incidents. Arm a unique seven-minute systemd restore timer, confirm it is active, stop only NL Xray, and wait for a fresh NL Supervisor proposal. Confirm the owner button routes to NL, approve once, verify the durable repair result and both healthy stacks, then cancel the watchdog. On any stale or uncertain path, restore NL Xray manually and reconcile only by the original request ID. Verify scheduled probe health afterward.
