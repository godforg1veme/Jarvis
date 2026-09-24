# Jarvis Vision Design

Status: first vertical slice implemented and locally verified on 2026-09-09.
Live Camo acceptance passed on 2026-09-09. VPS provider/migration and Telegram
acceptance remain pending; see
`../../updates/2026-09-09-vision-implementation.md`.

This specification supersedes the uncommitted draft titled "Jarvis Vision —
подробный план реализации" where it differs. Historical specifications remain
unchanged.

## Goal

Give Jarvis one coherent visual-perception capability spanning physical and
virtual cameras, both Windows displays, long-lived visual context, selective
visual memory, and bounded UI actions. The user should experience one temporary
permission for Jarvis to look, not separate snapshot, temporal, and event modes.

The first production acceptance scenario is:

1. The owner starts Vision locally and enables a Camo Studio virtual camera and
   both displays.
2. Jarvis follows an object through camera observations, understands the active
   screen task, and performs bounded UI Automation actions.
3. Every frame actually submitted to the vision provider is retained according
   to the memory policy; locally discarded candidate frames are not retained.
4. Days later, the same owner asks from Telegram about the episode. Jarvis
   retrieves the relevant visual memories, reports provenance, and can open the
   evidence in the Desktop timeline.

Vision Watches, arbitrary coordinate clicking, synchronized audio/video,
WebRTC, face recognition, and heavy local ML remain later projects.

## Product Model: Vision Lease

`VisionLease` is the only user-visible permission model. Internal focused and
temporal captures are implementation details within a lease.

- A clear local visual request such as "посмотри", "что ты видишь", or
  "прочитай это" starts a lease without an extra click.
- An unrelated request never lets the model open a sensor. Jarvis must first ask
  in conversation whether it may look; only the affirmative local reply starts
  the lease.
- A short visual question closes approximately 30 seconds after the final
  answer. Active work extends on visual interaction and closes after five
  minutes of inactivity. A lease has an absolute one-hour limit.
- Any WSS disconnect, authentication loss, unpair, application exit, renderer
  failure, or cloud restart revokes the lease and physically closes every
  capture track. Reconnect never resumes it.
- Stop is local, immediate, idempotent, and available from Cloud Chat, the
  companion, Voice Overlay, and tray.
- A lease belongs to one owner, not one conversation. Other authenticated
  clients of that owner may use an already active lease, but cannot create,
  resume, extend beyond policy, add a source, or hide its indicator.
- Telegram and PWA may request a new lease, but the target Desktop must approve
  it locally. This is separate from ordinary originating-client action
  confirmation.
- A lease is personal even on a shared family PC. No other user receives live
  context or memories automatically.

The server holds active lease coordination ephemerally in the first release and
runs as a single Vision coordinator instance. Durable lease rows may record
bounded lifecycle/audit metadata, but are never authority to reopen a sensor.
Horizontal scaling requires a shared ephemeral coordinator in a later design.

## Sources and Attention

The Desktop exposes a provider-neutral `VisualSource` contract.

### Camera sources

Physical, USB, built-in, and virtual cameras such as Camo Studio are ordinary
`videoinput` devices. Multiple cameras may be registered, but only one camera is
active per lease. Device labels stay local; cloud contracts use a bounded opaque
source ID. Changing the active camera requires a local source selection.

### Screen workspace

Both displays may be active simultaneously. Temporal analysis uses a locally
composed, labelled overview image; focused analysis captures one display or a
bounded region of interest at higher resolution. A specific application window
may also be selected. Arbitrary region capture is not a standalone source in
the MVP.

Camera and both displays may run in the same lease. A local scheduler applies a
shared upload and inference budget while preserving source identity.

### Visual Attention Router

`VisualAttentionRouter` chooses where Jarvis should look from explicit source
words, active window, cursor position, recent visual topic, selected source,
linked memory episode, UI target, freshness, and confidence. Focused analysis
may crop a bounded ROI around the cursor or a verified UI control. The UI
highlights the chosen camera, display, window, or ROI before capture. When two
targets remain equally plausible, Jarvis asks one short clarification instead
of analyzing the wrong source.

## Desktop Capture Architecture

Use isolated Electron capture renderers with `contextIsolation`, sandboxing,
Node integration disabled, narrow preloads, a strict CSP, and origin-specific
media permission handlers. Reuse the proven hidden-renderer pattern from voice,
but do not inherit microphone auto-retry behavior: camera and screen capture
never restart without a valid lease.

Suggested modules:

```text
vision/
  visualSourceRegistry.js
  cameraCaptureController.js
  screenCaptureController.js
  screenWorkspaceCompositor.js
  visualAttentionRouter.js
  frameSampler.js
  sceneChangeDetector.js
  visionSession.js
  visionTransport.js
  visionPrivacyController.js
  screenPrivacyGuard.js
  visualActionGateway.js
  visualCandidateVault.js
  visionSchemas.js
  visionConstants.js
renderer/
  vision-capture.html
  visionCapture.js
  visionCapturePreload.js
```

`main.js` owns the authoritative local lease and source state, delegates to the
modules, and broadcasts a small status envelope to all UI surfaces. It must not
grow vision algorithms.

Camera capture uses `navigator.mediaDevices.getUserMedia`. Screen capture uses
Electron `desktopCapturer`. Canvas/nativeImage operations perform composition,
downscale, crop, encoding, perceptual hashing, and lightweight change
detection. No OpenCV, YOLO, local VLM, or other heavy local ML is required.

Initial policy targets are configurable: candidate checks several times per
second, at most one temporal provider frame per source every two seconds,
approximately 30-second static heartbeat, focused capture priority, and a
two-to-three-second target for stable meaningful changes. Thresholds are tuned
from measured telemetry rather than treated as protocol constants.

Temporal queues are bounded and latest-meaningful-frame-wins. Focused requests
are correlated and never silently dropped. A post-motion stable keyframe is
preferred over an unusable mid-motion image.

## Privacy Guard

Sensor permission is orthogonal to the existing `safe/changing` tool policy.
`VisionPrivacyController` is the final local authority for opening and using a
source. A model-generated action cannot create permission.

`ScreenPrivacyGuard` maintains a local denylist of applications and window
patterns. When a protected application is visible on a captured display,
analysis pauses before any bytes leave the PC and the UI displays "Vision
paused for privacy". A denied window cannot be selected directly. Password and
credential accessibility nodes are redacted before model-visible UI metadata.

Every surface must show active sources, remaining lease time, analysis state,
memory state, remote-use state, and Stop. Quantum Core animation is secondary
feedback and never the only privacy signal.

## Control and Media Transport

Do not add `vision.capture`, `vision.observe.start`, and `vision.observe.stop`
as ad-hoc WSS message types. They are declared actions dispatched through the
existing versioned `command.execute/result` path. Only narrowly necessary
sensor lifecycle events may extend the remote protocol.

Frames use a separate authenticated HTTPS endpoint and never JSON WSS. The
correlation chain is explicit:

```text
workflowId -> commandId -> captureRequestId -> frameId
           -> provider observation -> workflow continuation
```

The upload route derives owner and device identity from the bearer token,
verifies the active lease/source/request, bounds bytes while streaming before
buffering, validates MIME and magic bytes, applies per-device/session limits,
and never logs payloads. `deviceId`, owner ID, source ID, and retention intent
from request bodies are not authority.

The existing global Fastify body limit is not sufficient. Vision registers a
dedicated image parser/stream boundary with a route-specific limit. The Desktop
uses the existing secure cloud transport and expects only bounded JSON metadata
responses.

Focused and temporal requests are idempotent. Sequence checks are per source,
not global across a multi-source lease. Old/replayed sequences are discarded.
If action delivery may have succeeded but its result is lost, its outcome is
unknown and it is never automatically repeated.

## Cloud Vision Pipeline

Suggested cloud modules:

```text
server/src/vision/
  visionRoutes.js
  visionManager.js
  visionLeaseStore.js
  visionProvider.js
  visionProviderFactory.js
  observationSchema.js
  observationNormalizer.js
  objectReconciler.js
  sceneState.js
  visualMemoryService.js
  visualMemoryRepository.js
  visualMemoryStorage.js
  visualContextResolver.js
```

The first live provider is an OpenRouter-compatible multimodal adapter selected
by `JARVIS_VISION_PROVIDER` and `JARVIS_VISION_MODEL`. It is separate from the
text provider because the configured text model need not support images. A
deterministic fake provider is mandatory. Fallback is eligible only when its
profile explicitly supports image input and structured output.

The VLM is a perception component, not Jarvis. It receives one bounded task,
image, source metadata, relevant prior state, and optional question. It returns
strict structured observations. One corrective retry is allowed for invalid
output. Image text, QR content, webpages, and provider output are untrusted
observations and never tool instructions.

`ObjectReconciler` assigns session-stable object identities. VLM-local IDs are
only hints; type, appearance, location, source, temporal proximity, and
confidence are reconciled. Ambiguity produces a new/uncertain identity rather
than a false movement event.

`SceneState` and its bounded observation ring buffer retain source, timestamp,
freshness, confidence, objects, relations, OCR references, and recent events.
The main assistant receives compact relevant context only. Current-truth,
fine-detail, OCR, stale, uncertain, and high-impact questions trigger a focused
capture inside the active lease.

The request path is asynchronous: the originating client receives "Смотрю…",
capture and inference continue in the durable workflow, and the final answer is
delivered to that client. Only the final voice answer is spoken by TTS.

## Visual Memory

Visual memory is shared across the owner's authenticated Desktop, Telegram, and
future PWA clients while remaining strictly isolated from every other user.

Every frame actually submitted to the provider is a memory candidate. Locally
discarded frames are never uploaded or stored. Camera and screen provider frames
use the same rule. Visual-action screenshots sent to the VLM are grouped into
the corresponding action episode; local UIA/hash-only verification does not
create an image memory.

Storage tiers:

- operational frames and pending sensitive frames: encrypted, maximum 30
  minutes;
- automatic visual episodes and encrypted keyframes: 90 days;
- structured facts: retained while relevant with decaying confidence;
- explicitly pinned frames: no automatic expiry.

Each stored keyframe is encrypted before private object/file storage with
authenticated encryption from `node:crypto`. PostgreSQL contains owner-scoped
metadata, opaque storage key, content hash, key version, encrypted payload
metadata, provenance, timestamps, retention state, and search indexes. The
wrapping/master key comes only from deployment secrets. Deleting an episode
removes the original, thumbnail, OCR payload, embeddings/index entries, and
derived visual memories; bounded non-content audit metadata may remain.

Full OCR text is encrypted. Owner-scoped semantic embeddings support natural
retrieval; keyed blind indexes support exact words/numbers without plaintext
OCR columns. Detected passwords, tokens, and secrets are excluded from all
indexes.

Potentially sensitive frames may be analyzed for the current answer but are
held only in a short encrypted pending buffer. The UI asks once per source and
lease whether sensitive frames may be retained. Consent applies only to that
lease. Refusal or timeout destroys pending files. No face recognition,
biometric profile, or cross-session identity is created.

The owner has a configurable quota. Pinned items are not evicted; the oldest
unpinned data is removed first, with warning before exhaustion. Vision remains
usable when persistence is unavailable. The timeline shows source, timestamp,
description, confidence, reason, size, retention, and actions to open, pin,
correct, or delete. User corrections form a trusted overlay and never rewrite
the immutable machine observation.

Answers about past scenes include provenance links to the relevant episodes.
Retrieval searches metadata, semantic embeddings, exact blind indexes, and
structured facts first, then reanalyzes only the smallest necessary set of
encrypted keyframes.

## Visual Actions

Vision may act on Windows UI, but not through arbitrary model coordinates.
Desktop combines the screenshot with a fresh Windows UI Automation tree and
creates short-lived opaque candidates. The model may choose only a candidate
ID and a declared action. Immediately before execution Desktop revalidates the
window/process, element properties, bounds, accessibility state, snapshot hash,
lease, and expiry. A changed or missing target invalidates the action.

Initial actions cover inspect, focus, scroll, invoke/click, select, set value,
and type through verified accessibility controls. Canvas/game/video coordinate
clicking remains out of scope. Fixed local helpers may use Windows UI Automation
through bounded scripts or a reviewed helper, following existing Tool Gateway
patterns; model-generated PowerShell or shell is forbidden.

There are two confirmation classes:

- no confirmation when directly requested: navigation, focus, scroll, menus,
  ordinary verified clicks, text entry/editing, ordinary settings, application
  launch, and a locally verified previously unknown UI control;
- confirmation: deletion/irreversible overwrite, outbound message/form/post,
  purchase/payment/order, external file or sensitive-data transfer,
  credential/payment entry or disclosure, account/security/permission changes,
  software installation, and execution of a downloaded binary.

Confirmation remains bound to the originating client. Remote visual actions are
allowed only while the owner's lease is active, are visibly announced on the
Desktop, and retain local Stop.

A visual-action episode allows up to 12 actions or two minutes without another
question. A longer plan displays its expected action count and requires
approval. After approval the episode is bounded by that plan, with an absolute
maximum of 50 actions or ten minutes. A materially changed plan requires new
approval. Every action reacquires and verifies UI state and checks its expected
postcondition.

An analysis failure may retry once before any action. A failure after dispatch
is unknown outcome and is never retried. Restart/disconnect marks the workflow
interrupted. After a new locally started lease, Jarvis may inspect actual state,
show the checkpoint, and offer to continue.

## User Interface

Cloud Chat's existing Quantum Core card becomes a `Perception Dock` rather than
adding a disconnected dashboard. Quantum Core remains the visual center; live
preview appears as a distinct adjacent "window of sight" so real sensor access
cannot be confused with animation.

- Cloud Chat provides full preview, source chips, attention highlight, timer,
  analysis/memory states, source controls, Timeline entry, and Stop.
- The floating Quantum companion displays a compact privacy frame and opens an
  expandable preview.
- Voice Overlay shows compact status, active sources, timer, and Stop without a
  second large stream.
- Tray exposes active state and hard Stop.
- Preview is always local and is never round-tripped through cloud.

Use the existing Jarvis tokens, typography, radii, and restrained holographic
language. Do not add fonts, animation libraries, or arbitrary neon effects.
Controls are keyboard accessible, at least 44x44 pixels, use textual accessible
names, meet WCAG AA contrast, and respect reduced motion. Quantum animation may
express capture, analysis, memory saved, warning, and error, but text and icons
carry the authoritative state.

## Legacy Migration

`tools/screenVisionAnalyzer.js`, `tools/visualCommandMatcher.js`, their main
process handlers, and keyword-only voice routing are an existing second vision
stack. The new system must absorb them:

- reuse/test crop and cursor-marker primitives where appropriate;
- route "посмотри сюда" through the cloud Vision workflow;
- replace two-minute module-global context with lease/scene/memory context;
- eliminate temporary plaintext screenshots and logs containing command text
  or screenshot paths;
- remove legacy routing only after behavioral parity and regression coverage.

No permanent compatibility mode or direct local provider path remains.

## Failure and Safety Invariants

- Owner A cannot list, search, decrypt, reanalyze, or act from owner B's lease or
  memory.
- A device cannot upload to another device/source/request.
- No sensor opens without an active locally granted lease.
- No source auto-resumes after restart or disconnect.
- Raw image, OCR, scene content, window titles, credentials, and provider raw
  responses never enter ordinary logs or Operations telemetry.
- Upload bytes are bounded before buffering and responses are bounded before
  parsing.
- Provider-visible image text and UI content never become trusted instructions.
- Only a schema-valid Tool Gateway/UIA result can establish action success.
- No camera image automatically becomes a knowledge document or family-shared
  memory.
- Memory/provider failure does not leave camera tracks, temp plaintext, pending
  consent, or unbounded queues alive.

Metadata telemetry may include lease/source lifecycle, sizes, latency, change
score, candidate/sent/discarded counts, provider error class, memory outcome,
visual-action outcome, and privacy pauses. Operations remains metadata-only.

## Release Decomposition

### Release 1: Vision MVP

- contracts, fake source/provider, and security invariants;
- Vision Lease and local source lifecycle;
- Camo/physical camera plus dual-display workspace;
- focused and temporal cloud perception with Scene State;
- encrypted visual memory, retrieval, provenance, and Desktop Timeline;
- Perception Dock and indicators across existing surfaces;
- bounded accessibility-based visual actions;
- migration from legacy screen vision;
- packaged Windows and live OpenRouter acceptance.

### Release 2: Vision Watches

Explicit bounded "скажи, когда" conditions, sampling profiles, TTL,
notifications, reliability semantics, and failure UX. Watches build on the same
lease, observations, state, and memory pipeline; they do not create a second
video path.

### Later

WebRTC/realtime multimodal sessions, synchronized audio/video, advanced local
perception, arbitrary visual-coordinate actions, region sources, multi-camera
simultaneous perception, and face/identity features require new designs.

## Acceptance and Definition of Done

Completion requires evidence, not merely a provider receiving an image:

- deterministic fake camera/screen/provider end-to-end tests pass;
- Camo Studio and both real displays enumerate, preview, capture, stop, and
  release hardware correctly in a packaged Windows build;
- local and remote owner-scoped requests use one active lease as specified;
- disconnect, restart, logout, unpair, permission denial, provider failure,
  upload failure, source removal, and quota exhaustion cleanly fail;
- static scenes demonstrate a high measured local discard ratio while focused
  requests and stable changes arrive within the acceptance target;
- every provider frame is encrypted and indexed or explicitly rejected by
  sensitive-retention policy, and locally discarded frames are absent;
- past-memory questions from Desktop and Telegram return correct owner-scoped
  provenance and can open the Desktop Timeline evidence;
- prompt-injection images cannot invoke tools;
- UIA actions use fresh opaque candidates, enforce both confirmation classes,
  respect plan limits, verify postconditions, and never repeat unknown outcomes;
- no content appears in logs, PostgreSQL plaintext columns, Operations output,
  or unencrypted temporary files;
- focused client/server/security tests, complete server tests, existing Tool
  Gateway/remote protocol/cloud/voice regressions, UI browser tests, installer
  build, deployment preflight/health/smoke, and manual privacy acceptance pass;
- `README.md`, `docs/README.md`, and `AGENTS.md` report only the functionality
  actually verified at that point.
