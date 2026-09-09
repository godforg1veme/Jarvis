# Jarvis Vision — implementation plan

Date: 2026-09-09

Status: Release 1 perception/memory vertical slice through Scene State and
temporal sampling implemented and locally verified on 2026-09-09. Accessibility-
grounded visual actions, companion/overlay polish, live Camo, and deployed
end-to-end acceptance remain pending; see
`../../updates/2026-09-09-vision-implementation.md`. This plan implements Release 1 of
`../specs/2026-09-09-jarvis-vision-design.md`. Vision Watches and later realtime
features remain separate projects.

## Delivery rules

- Build vertical slices behind explicit availability checks; never advertise a
  capability before the relevant source, provider, and policy are ready.
- Start every slice with deterministic fake transports/providers. Live API and
  hardware checks supplement tests; they do not replace them.
- Preserve CommonJS and avoid production dependencies unless a concrete gap is
  demonstrated and approved.
- Do not expand `main.js`, `renderer/renderer.js`, assistant, or orchestrator
  with vision algorithms. Add focused modules and explicit wiring.
- Never log image/OCR/scene/user-command content or plaintext storage paths.
- Commit documentation and each verified vertical slice separately when
  practical. Do not include unrelated worktree changes.

## Phase 0 — freeze contracts and migration baseline

1. Add shared Vision enums, identifiers, schema validators, byte limits,
   sequence rules, lease states, source types, observation schema, memory
   metadata schema, and visual-action result schema on Desktop and server.
2. Add contract tests for malformed IDs, extra keys, oversized values, invalid
   transitions, replayed sequences, and result size limits.
3. Characterize the existing `screenVisionAnalyzer` behavior with tests for
   cursor display selection, crop bounds, marker placement, temp cleanup,
   command routing, and continuation.
4. Add an explicit migration status flag so old and new pipelines cannot both
   answer the same request.

Verification:

```powershell
node scripts/testVisionSchemas.js
node scripts/testVisualIntent.js
node scripts/testRemoteProtocol.js
node scripts/testToolPolicyMapping.js
```

## Phase 1 — local Vision Lease and fake capture

1. Implement `VisionPrivacyController` as the sole lease authority with short,
   active, idle, one-hour hard expiry, local explicit-intent grants, remote
   request pending state, and idempotent hard stop.
2. Implement `VisualSourceRegistry` with opaque local IDs for camera, virtual
   camera, display, workspace, and application window. Do not expose hardware
   labels to cloud.
3. Build fake camera/display sources and a fake clock. Prove resource release on
   every transition and that reconnect never resumes.
4. Add isolated capture renderer/preload scaffolding and narrow permission
   handlers for the exact capture webContents.
5. Keep authoritative state in main process and expose narrow IPC methods/events
   to UI surfaces.

Verification:

```powershell
node scripts/testVisionPrivacyController.js
node scripts/testVisualSourceRegistry.js
node scripts/testVisionCaptureController.js
node scripts/testVisionIpc.js
```

## Phase 2 — real camera, Camo, dual displays, and attention

1. Implement camera enumeration/open/capture/close with `MediaDevices` and no
   auto-retry. Verify virtual cameras follow the same source contract.
2. Implement `desktopCapturer` display/window acquisition and a labelled
   dual-display workspace compositor that handles differing scale factors,
   orientation, and resolution.
3. Extract/reuse cursor crop and marker primitives from legacy screen vision
   without writing plaintext screenshots.
4. Implement `VisualAttentionRouter` using explicit words, active window,
   cursor, selection, recent context, provenance links, freshness, and
   confidence. Support bounded ROI and ambiguity responses.
5. Implement `ScreenPrivacyGuard` denylist and pre-upload pause. Redact protected
   UIA nodes.

Verification:

```powershell
node scripts/testCameraCaptureController.js
node scripts/testScreenCaptureController.js
node scripts/testScreenWorkspaceCompositor.js
node scripts/testVisualAttentionRouter.js
node scripts/testScreenPrivacyGuard.js
```

Manual gate: enumerate the installed Camo virtual camera and both displays,
render local previews, select each source, capture focused frames, exercise a
privacy pause, and confirm all tracks/sources close on Stop.

## Phase 3 — sampling, encoding, and authenticated media transport

1. Implement frame sampling, perceptual change scoring, hysteresis, motion
   debounce, post-motion stable capture, heartbeat, per-source sequence, global
   budget, focused priority, and bounded latest-frame queues.
2. Encode only allowed bounded JPEG/WebP profiles. Reject an oversized frame
   before network upload.
3. Add the authenticated server frame route with a dedicated bounded image
   parser/stream, MIME and magic checks, lease/source/request/owner/device
   validation, per-device and per-lease rate limits, sequence replay rejection,
   and bounded response.
4. Add Desktop `visionTransport` on the existing secure dispatcher with
   correlation/idempotency headers and typed errors.

Verification:

```powershell
node scripts/testSceneChangeDetector.js
node scripts/testFrameSampler.js
node scripts/testVisionTransport.js
cd server
npm test -- --test-name-pattern=vision
```

Security gate: prove oversized, malformed, cross-owner, cross-device,
cross-source, expired, duplicate, and out-of-order uploads fail without payload
logging or full buffering.

## Phase 4 — provider, observations, and Scene State

1. Implement a deterministic fake provider with fixtures covering object moves,
   OCR, ambiguous identity, sensitive content, prompt injection, invalid JSON,
   timeout, and retry.
2. Implement OpenRouter-compatible multimodal Vision Provider configuration,
   request/response byte limits, timeout, structured schema, one corrective
   retry, capability profile, and disabled/missing-key behavior.
3. Normalize observations, reconcile object identities conservatively, reduce
   state, maintain bounded per-source observation history, and expire freshness.
4. Implement visual-context resolution and compact assistant context. Never
   attach Scene State to unrelated messages.
5. Connect capture correlation to the existing durable Action Orchestrator so a
   request returns "Смотрю…" and later continues exactly once with the final
   answer in the originating client.

Verification:

```powershell
node scripts/testVisionProvider.js
node scripts/testObservationNormalizer.js
node scripts/testObjectReconciler.js
node scripts/testSceneState.js
node scripts/testVisionContextResolver.js
cd server
npm test
```

Manual live contract: use a configured vision model without printing secrets;
verify missing key, fake transport, valid camera image, valid dual-display
workspace, invalid structured response, provider timeout, and fallback
eligibility.

## Phase 5 — encrypted visual memory and retrieval

1. Add PostgreSQL migrations for owner-scoped visual episodes, keyframes,
   encrypted payload references, lifecycle/retention, user corrections,
   embeddings, keyed exact-token indexes, and bounded audit metadata.
2. Implement envelope/file encryption using `node:crypto`, versioned keys,
   authenticated metadata, opaque storage paths, atomic writes, and cleanup on
   partial failure. Never persist plaintext temporary files.
3. Store every provider frame unless sensitive retention is pending/refused.
   Implement per-source per-lease sensitive consent, encrypted 30-minute pending
   buffers, 90-day expiry, pinning, quota warning, and oldest-unpinned eviction.
4. Encrypt OCR payloads, omit secrets from all indexes, create embeddings and
   blind exact indexes, and retrieve owner-scoped candidates before decrypting a
   bounded subset.
5. Implement provenance-backed answers, selective frame reanalysis, complete
   deletion, and trusted correction overlays.

Verification:

```powershell
cd server
npm test -- --test-name-pattern="visual memory|vision"
```

Acceptance gate: cross-owner/cross-device isolation, wrong-key failure,
tamper detection, partial-write cleanup, expiry, pinning, quota eviction,
pending-consent timeout, exact OCR search, semantic retrieval, correction
priority, provenance, and complete content deletion.

## Phase 6 — Perception Dock and memory timeline

1. Extend existing Jarvis semantic tokens and Cloud Chat sidebar into a
   Perception Dock adjacent to Quantum Core. Add local preview, source chips,
   selected-attention highlight, timer, analysis/memory/privacy/remote states,
   Timeline entry, and hard Stop.
2. Add compact privacy/status controls and expandable preview to the floating
   companion; add status/timer/Stop without large video to Voice Overlay; add
   active state and Stop to tray.
3. Implement the Desktop Visual Memory Timeline with source/time filtering,
   thumbnail/detail, description, confidence, provenance, correction, pin,
   delete, empty/loading/error/offline/quota states, and keyboard access.
4. Add accessible live regions and labels, 44px controls, WCAG AA contrast,
   focus handling, reduced motion, and bounded thumbnail loading. Quantum modes
   are supplemental only.

Verification:

```powershell
node scripts/testVisionRenderer.js
node scripts/testQuantumCore.js
node scripts/testTrayMenu.js
node scripts/testOperationsBrowser.cjs
```

Browser gate: capture screenshots at desktop and narrow widths and inspect every
state visually. Test keyboard-only Stop and Timeline operations.

## Phase 7 — accessibility-grounded visual actions

1. Implement a fixed Windows UI Automation inspector/helper with bounded JSON
   output and no model-generated PowerShell. Reuse existing controlled process
   execution patterns; add no dependency unless the built-in Windows path proves
   insufficient and a dependency is separately approved.
2. Create an expiring local candidate vault that binds opaque target ID to
   process/window/automation ID/control type/name/bounds/state and snapshot hash.
   Never expose arbitrary handles or coordinates as model-selected inputs.
3. Add declared inspect/focus/scroll/invoke/select/set-value/type actions and
   strict Desktop/server schemas. Revalidate immediately before execution and
   verify expected postconditions afterward.
4. Implement the two confirmation classes, originating-client confirmation,
   remote owner/lease checks, Desktop activity indicator, Stop, plan-count
   approval over 12 steps, and hard 50-step/10-minute bounds.
5. Mark post-dispatch disconnects unknown, persist checkpoints, and require a new
   lease plus fresh inspection before offering continuation.

Verification:

```powershell
node scripts/testVisualCandidateVault.js
node scripts/testWindowsUiAutomation.js
node scripts/testVisualActionGateway.js
node scripts/testToolGateway.js
node scripts/testRemoteProtocol.js
node scripts/testToolPolicyMapping.js
cd server
npm test
```

Security gate: prompt-injection text, stale targets, moved dialogs, password
fields, protected applications, action-plan mutation, confirmation from another
origin, duplicate dispatch, unknown result, and postcondition mismatch.

## Phase 8 — legacy cutover and end-to-end acceptance

1. Route legacy phrases and IPC entry points through the new workflow while
   preserving user-visible behavior.
2. Remove direct `tools/aiClient` vision calls, module-global screenshot context,
   plaintext temp files, keyword-only continuation authority, and content/path
   logs. Remove obsolete code only after the new regression suite passes.
3. Run fake end-to-end scenarios across camera, dual screens, memory, Telegram
   retrieval, and visual actions with deterministic failure injection.
4. Run the complete existing Desktop/server/operations regression suites and
   build the packaged Windows installer.
5. Deploy through preflight, migration, Compose health, public smoke, and manual
   live model checks. Do not print credentials or payloads.

Required project checks include:

```powershell
node scripts/testVisualIntent.js
node scripts/testToolGateway.js
node scripts/testRemoteProtocol.js
node scripts/testToolPolicyMapping.js
node scripts/testVoiceServiceSttProvider.js
node scripts/testTrayMenu.js
node scripts/testQuantumCore.js
node --test cloud/*.test.js voice/cloudVoiceService.test.js tts/windowsSapiService.test.js
cd server
npm test
cd ..\ops-ui
npm test
npm run build
cd ..
npm run dist:win
```

Manual release acceptance:

1. Start Vision locally by voice and text without an extra click; ambiguous
   non-visual text cannot start it.
2. Use Camo camera and both monitors together; verify attention follows explicit
   source, cursor, active window, recent context, and ambiguity handling.
3. Observe a moved object, analyze both displays, execute a bounded UI task, and
   stop all sources physically.
4. Query the active lease remotely from Telegram, then verify high-risk action
   confirmation in Telegram and visible Desktop execution.
5. Restart/disconnect/unpair during capture and during an action; verify hard
   stop, interrupted workflow, and no duplicate action.
6. Retrieve the episode from Telegram days/lifecycle later, open provenance in
   Desktop Timeline, correct it, pin it, and delete it completely.
7. Show prompt-injection text, credentials, and a denied application. Verify no
   unauthorized tool action, no protected upload, and correct sensitive-memory
   consent behavior.
8. Inspect application/server/Operations logs, PostgreSQL columns, storage, temp
   directories, network rate, CPU/memory, and installer contents for the stated
   privacy, bounds, and packaging invariants.

## Documentation closeout

Only after the corresponding acceptance evidence exists:

- update `README.md` with verified user-visible capability;
- update `docs/README.md` status and link this design/plan;
- update `AGENTS.md` runtime ownership, trust boundaries, writable state, and
  verification commands;
- record unfinished live/hardware/deployment acceptance explicitly rather than
  describing roadmap work as production-ready.
