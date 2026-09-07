# Operations corrective rollout — 2026-09-06

The owner requested completion and verification, then explicitly deferred
backups. The backup timer remains disabled; no external repository, first
backup, or restore acceptance is claimed.

## Corrected findings

- The backup script incorrectly chmodded the shared lock directory and could
  report success despite failure to clear maintenance. Both are corrected.
- Ingest claims read the maintenance flag without locking it. They now hold a
  share lock; a real concurrent PostgreSQL test verified waiting, pause, and
  subsequent successful claim after resuming.
- Host Agent recorded mutation results only after execution. It now persists
  claims first, retaining unknown outcomes across crashes without re-execution.
  SQLite connections are closed; output capture is bounded while reading,
  preserves stdout/stderr, and also bounds the encoded JSON response.
- Server recovery includes unknown operations, and browser retries retain the
  same idempotency key after connection loss. Drawer changes clear old pending
  confirmations; overlapping log responses cannot overwrite another service.
- Devices now refresh with telemetry. Reassignment closes the old active WSS
  connection immediately after commit. Stale devices and service/host readings
  cannot remain falsely online/healthy after 90 seconds without new data.
- API failures no longer appear as empty, healthy incident/event/backup lists.
  Browser sessions receive persistent cookies; approval requests are throttled.
- Notification delivery state and bounded exponential retry delay persist in
  PostgreSQL. Health recovery resolves only the matching host check incident.
- Events include service operation results and a whitelist of connection audit
  fields. Operational logs are archived as privacy-preserving severity and
  lifecycle summaries. Source bodies are intentionally excluded; original
  diagnostic logs remain on the VPS. Retention is 60 days, 256 MiB per service,
  and 10 GiB globally, deleted in bounded batches.
- The previously stubbed backup status now reads a bounded, validated result
  file and idempotently records it. No backup is run by collecting its status.

## Added checks and views

- CPU, swap, memory capacity, disk capacity/free space, aggregate received/sent
  network bytes, and uptime supplement load/memory/disk/inode percentages.
  Missing sources remain missing instead of becoming fake zero values.
- The overview reports database/migration readiness, stuck background jobs,
  actual successful Telegram polling freshness, and primary-model health.
  Model probes contain only a synthetic message, no tools or family data;
  the six-hour next-run timestamp survives application restarts.
- Resource pressure opens deterministic incidents after repeated observations.
- Infrastructure discovers Docker containers and relevant systemd services
  independently of the fixed management allowlist. Discovery grants no action.
- Mobile navigation retains readable labels; long headings fit small screens.

## Verification

- Server: 150 automated tests passed after the functional corrections.
- Host Agent: 14 tests passed on the VPS, including timeout, output bounds,
  durable mutation claims, metrics normalization, and discovery redaction.
- Existing parser: 157 tests passed using its existing virtual environment and
  disabled Python bytecode writes. Its unit remained active with zero restarts
  and its original activation timestamp of 2026-09-04 09:08:56 UTC.
- UI: unit test and production TypeScript/Vite build passed; nine screens
  exercised at 1440, 390 and 320 px with no horizontal overflow or page errors.
  These are synthetic browser fixtures, not a claimed live multi-device trial.
- A synthetic Telegram notification was accepted by Bot API. The corresponding
  test incident and backup rows were rolled back. No service failure was caused.
- Live PostgreSQL verified the concurrent knowledge gate, backup deduplication,
  and notification lease/delivery transitions in isolated/rolled-back fixtures.
- Live readiness/smoke and host preflight passed. Provider, polling, migration,
  and queue checks reported healthy; the next provider probe was persisted.
- Final Host Agent acceptance discovered six VPS components with both sources
  available. PostgreSQL accepted the combined event/audit query, log archive
  deduplication, health-check query, and EXPLAIN of all bounded retention
  statements. The live archive has begun receiving Docker operational summaries.

## Limits of acceptance

Physical multi-device use and new-browser Telegram approval on an actual phone
are not replaced by browser fixtures. Backup activation and isolated restore
are deferred by the owner. PostgreSQL and the existing parser remain read-only
in the panel; their restart authority is not enabled by this rollout.
