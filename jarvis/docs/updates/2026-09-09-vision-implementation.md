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
- Authenticated owner/device-bound lease and capture-request routes, one-use
  correlations, sequence replay protection, MIME/magic/size checks, rate limits,
  and a provider-neutral observation schema.
- OpenRouter-compatible vision adapter with a fake provider for deterministic
  tests, response bounds, timeout, schema validation, and one corrective retry.
- AES-256-GCM visual memory with opaque blob keys, owner-scoped metadata,
  blind exact-match tokens, 90-day retention, 30-minute sensitive-consent
  staging, pin/correct/delete controls, quotas, and retryable physical cleanup.
- Perception Dock and visual Timeline beside the Quantum Core; text and voice
  visual requests share one router, and voice speaks only the final answer.
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

## Acceptance still required

- Camo Studio was not publishing a `videoinput` device during the hardware probe,
  so a real phone/Camo frame has not yet been accepted. Start Camo Studio, connect
  the phone, and run `npx electron scripts/probeVisionHardware.js` again.
- The local environment has no configured Vision model or visual-memory key.
  Migration, provider configuration, and a live non-sensitive OpenRouter request
  must be verified during VPS rollout without printing secrets.
- Telegram use must be accepted against a paired Desktop with an already active
  lease. PWA remains roadmap work.
