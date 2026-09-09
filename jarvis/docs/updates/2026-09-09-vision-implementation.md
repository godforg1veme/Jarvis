# Jarvis Vision implementation status — 2026-09-09

This record describes verified implementation state. The design and execution
history remain in `docs/superpowers/specs/2026-09-09-jarvis-vision-design.md`
and `docs/superpowers/plans/2026-09-09-jarvis-vision.md`.

## Implemented

- Explicit local Vision Leases with 30-second short mode, five-minute active
  idle expiry, one-hour hard expiry, immediate STOP, and physical camera closure
  on disconnect or application shutdown.
- Standard Electron `videoinput` capture with user-triggered permission and Camo
  preference, limited to one active camera.
- Both Windows displays captured and composed into one bounded JPEG workspace.
- Active leases sample locally, reserve upload capacity for focused questions,
  discard unchanged/mid-motion candidates, submit stable changes and a bounded
  heartbeat, and cancel an in-flight upload across the STOP boundary.
- Authenticated owner/device-bound lease and capture-request routes, one-use
  correlations, sequence replay protection, MIME/magic/size checks, rate limits,
  and a provider-neutral observation schema.
- OpenRouter-compatible vision adapter with a fake provider for deterministic
  tests, response bounds, timeout, schema validation, and one corrective retry.
- Ephemeral owner/device/source-scoped Scene State keeps a bounded observation
  ring, freshness, and conservative session-stable object identities; only a
  compact prior scene is returned to the perception provider as untrusted data.
- AES-256-GCM visual memory with opaque blob keys, owner-scoped metadata,
  blind exact-match tokens, 90-day retention, 30-minute sensitive-consent
  staging, pin/correct/delete controls, quotas, and retryable physical cleanup.
- Perception Dock and visual Timeline beside the Quantum Core; text and voice
  visual requests share one router, voice speaks only the final answer, and the
  tray exposes authoritative active state plus hard STOP.
- Safe `vision.capture` remote action. A remote client can use an already active
  local owner lease, but cannot start, add, or extend camera/screen access.

## Verified locally

- Full server test suite, focused Desktop Vision/IPC/policy/voice tests, and a
  headless Edge interaction test for the Perception Dock and Timeline.
- Real Electron hardware probe detected and captured both physical monitors as
  one 1448×435 JPEG (85,908 bytes in the final probe) without writing frame
  content to the project.
- Permission tests confirm the voice renderer receives audio only and the hidden
  Vision renderer receives video only.

## Live hardware acceptance

- Live Camo acceptance passed on 2026-09-09: Electron enumerated Camo and captured
  a 1280x720 JPEG frame while the same run composed both real displays into a
  1448x435 workspace. The acceptance uncovered and fixed an Electron 42 permission
  contract mismatch (`mediaType` for checks versus `mediaTypes` for requests).
  To repeat the acceptance, start Camo Studio, connect
  the phone, and run `npx electron scripts/probeVisionHardware.js` again.

## Acceptance still required

- Accessibility-grounded Windows UI actions from Phase 7 are not part of this
  camera/perception slice yet. Existing declared file/app/window actions remain
  available, but Vision does not convert pixels into arbitrary clicks.
- The local environment has no configured Vision model or visual-memory key.
  Migration, provider configuration, and a live non-sensitive OpenRouter request
  must be verified during VPS rollout without printing secrets.
- Telegram use must be accepted against a paired Desktop with an already active
  lease. PWA remains roadmap work.
