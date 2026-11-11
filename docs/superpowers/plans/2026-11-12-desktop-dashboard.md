# Jarvis Desktop dashboard implementation plan

**Goal:** Build the approved Desktop concept as a test EXE while preserving logic.
**Architecture:** Existing Electron/CommonJS main and preload, native renderer,
closed workspace IPC, device-authenticated server adapter and existing services.
**Spec:** ../specs/2026-11-12-desktop-dashboard-design.md

## Constraints

No production dependencies, push, deployment or installation. Keep npmRebuild
false, existing native runtime, permission checks and original operation IDs.
Do not capture camera/microphone or send real HH applications during tests.

## 1. Shared personal API

- [ ] Add server/src/desktop/workspaceRoutes.js with an explicit allowlist of
  section, memory, personal operation and authenticated HH routes. Exclude guest
  HH routes, Mini session creation and Mini chat sending. Authenticate the
  device and current member before and after reads.
- [ ] Add an optional trusted server-side action-session verifier to shared
  personal/memory services. The default remains Mini App session validation;
  Desktop verification locks matching active device id/user/token hash.
- [ ] Wire services in runtime.js; expose /v1/desktop/workspace/me and own
  Desktop message history. Keep Mini history distinct.
- [ ] Test unauthorized, revoked, cross-user, route allowlist, operation recovery
  and unchanged Mini session behavior using Fastify injection and real services.

## 2. Renderer and native boundary

- [ ] Preserve renderer/cloud-chat IDs and existing renderer.js behavior. Add
  desktop navigation and workspace modules, with consistent graphite styles.
- [ ] Reuse Mini App section/action modules through a Desktop transport adapter.
  Maintain confirm-before-mutation dialogs and persisted pending UUID recovery.
- [ ] Add a closed workspace request catalog in cloud/workspaceProtocol.js,
  cloud/workspaceIpc.js, DesktopCloudClient and cloudPreload. Reject arbitrary
  URLs/methods, foreign frames and oversized upload buffers.
- [ ] Refresh on entry/focus and keep scope generations to reject stale results.
  Add server history without dropping pending commands or duplicating messages.
- [ ] Copy existing licensed sky/font resources and adapt the existing Three.js
  renderer for graphite orbital visuals, pausing while hidden/reduced motion.

## 3. Independent verification and test EXE

- [ ] Run cloud tests, IPC boundary, pending recovery and Life OS regressions.
- [ ] A separate tester exercises every menu section at 1440x900 and 760x560:
  loaded/empty/error/forbidden states, mutations/cancel/unknown results,
  keyboard/focus, no overflow and no stale cross-scope content.
- [ ] Resolve confirmed findings; repeat affected checks. Build npm run dist:win
  with the existing wake-word model/runtime. Launch the unpacked EXE safely
  and inspect package assets; do not activate capture or replace the installation.
- [ ] Record Russian/English result, tested boundaries, remaining live checks
  and exact EXE path. Offer coordinated server release if needed for live use.
