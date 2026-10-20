# Desktop reliability implementation plan

**Goal:** Implement A03/A06/A07 while preserving product logic.
**Architecture:** Fixed local test manifest, bounded CommonJS HTTP transport, durable metadata-only outbound request tracking and scoped read-only status lookup. Keep existing POST handlers and confirmation contracts.
**Tech Stack:** Node.js/CommonJS, Fastify, PostgreSQL, Electron and existing plain renderer.
**Spec:** `docs/superpowers/specs/2026-10-20-desktop-reliability-design.md`.

## Constraints

No new production dependencies, automatic POST retry, secret output, push, deploy or EXE installation. Personal office materials remain outside tracked files. One writer owns each module at a time.

## Tasks

- [x] A03: create `scripts/testCore.cjs`, fixed manifest and runner tests; add root `test:core`. Spawn Node tests directly with `process.execPath`; inspect structured test events/counts. Fail on failed, zero or unexpectedly skipped required suites. Print excluded environments. Run negative fixture tests and the real manifest.
- [x] A06 transport/client: add `cloud/boundedHttp.js` with streaming byte counting, overall deadline, abort and cancellation; apply to `_request` and `pair`. Add `cloud/outboundRequestStore.js` for atomic metadata-only state, with strict validation and fail-closed writes. Integrate outgoing text/voice IDs and read-only lookup. Test oversized/missing-length/slow bodies, header timeout, restart and disk failure. Own client modules and their tests.
- [x] A06 server: add `DesktopRequestRepository.getForDevice({userId,deviceId,clientMessageId})`; expose service `getStatus({device,clientMessageId})`, enforce current assistant permission and safe response shape. Register GET `/v1/desktop/requests/:clientMessageId`, validating ID and applying auth/rate limit. Test completed/processing/failed/not-found, revoked permission and foreign scope through route/service/repository fixtures. No migration.
- [x] A06 integration: add narrow trusted IPC/preload APIs for listing and checking pending requests; show recovery controls in chat without resending. On ambiguous send preserve ID and explain unknown. Recover completed response using existing confirmation rendering. Keep ordinary text and visual intent routing unchanged.
- [x] A07: update connection-state copy and composer accessible name. Verify existing renderer tests and browser fixtures at wide/minimum supported Desktop sizes (1440x900 and 760x560).
- [x] Review: independent review of diff and focused behavior tests, resolve findings, run test:core and relevant server/browser checks. Update bilingual verification/current-status notes and compare installed Desktop without installing it. Save office experiment results outside repo.

## Acceptance

Each task is complete only with passing relevant checks and explicit limitations. Core success does not replace PostgreSQL/Linux/live acceptance. Recovery does not initiate another mutation and never changes the request ID. Runtime and installed code are reported separately.
