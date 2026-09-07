# Operations Control Panel rollout — 2026-09-04

Superseded for acceptance by `2026-09-06-operations-verification.md`. The
original report missed real gaps, including the backup status stub, missing
worker/gate locking, lost notification retries, and stale device UI state.

## Verified live

- The owner panel is served from the configured operations origin and requires
  a Telegram-approved persistent browser session.
- Jarvis VPS, Jarvis Server, PostgreSQL, Cloudflare Tunnel, and the existing
  Telegram Parser are observed through the authenticated Unix-socket Host
  Agent.
- Load, memory, disk, inode, and uptime samples are persisted; five-minute
  rollups and bounded retention run in the operations runtime.
- Services, redacted logs, family devices, parser state, incidents, events,
  backups, and sessions have dedicated responsive UI screens and read APIs.
- SSE refresh is session-bound; forgetting a session closes its active stream.
- Jarvis Server and Cloudflare Tunnel expose only the fixed `restart` action.
  PostgreSQL and Telegram Parser expose no action.
- A live Cloudflare Tunnel restart produced a durable `succeeded` operation and
  the public smoke check recovered.
- A live Jarvis Server restart intentionally broke the initiating connection;
  the restarted server reconciled the Host Agent journal and persisted the
  operation as `succeeded` without repeating the action.
- The knowledge maintenance gate and non-stopping backup script pass automated
  tests. Ordinary chat and device connectivity are not stopped by the script.

## Remaining external acceptance

`restic` 0.16.4 and the backup systemd units are installed on the VPS. The
timer is deliberately disabled and inactive because `/etc/jarvis/backup.env`,
the restic password file, and a real encrypted off-VPS repository have not yet
been provisioned. Those root-only credentials are required before enabling the
timer, running the first backup, and performing the isolated restore drill. No
local same-host repository was created as a substitute.

A controlled incident-notification drill and final phone-width visual review
also remain before the entire historical plan is marked complete.
