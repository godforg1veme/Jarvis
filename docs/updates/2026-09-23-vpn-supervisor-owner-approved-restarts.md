# VPN Supervisor owner-approved restarts (production rollout)

Date: 2026-09-23

## Status

Implemented in the local source tree and deployed on 2026-09-23. The first
deployment was rolled back to the exact pre-deployment backup at
`.backups/vpn-supervisor-owner-repair-20260923-01`; after an explicit owner
request, the verified modules were redeployed from
`.backups/vpn-supervisor-repair-enabled-20260923-01`. Production now enables
only the matching Xray and Hysteria2 restart playbooks plus the synthetic
owner-approved no-op. Migration `026_vpn_supervisor_owner_approved_repairs.sql`
is applied. No VPN service was restarted during either deployment.

## Scope

The Supervisor can now present an owner-confirmation proposal for only:

- `restart_xray` on `XRAY_SERVICE_FAILURE`;
- `restart_hysteria2` on `HYSTERIA2_SERVICE_FAILURE`.

The service configuration must be valid, host and network checks healthy, the
opposite VPN stack healthy, and Hysteria2 auth healthy for a Hysteria2 restart.
The model can choose only a closed catalog entry; it cannot supply shell text,
arguments, commands, or credentials. Restore/rollback playbooks remain off.

## Confirmation and execution boundary

The owner must use `vpsup:allow:<uuid>` from the private Telegram chat. The
server checks that the diagnosis revision is still current, confirms the
preconditions again, atomically claims the incident/request ID, and sends only
the existing closed `vpn.restart` or `vpn.hysteria2.restart` operation. The
selected stack may briefly disconnect. A post-action snapshot must confirm the
target and opposite stack healthy. No automatic second attempt is allowed; an
uncertain Host Agent result is reconciled using the same request ID.

Run state stores only closed status/result codes, bounded metadata, and opaque
evidence references. It does not store raw logs or credentials. The recovery
worker reconciles pending outcomes without redispatching the mutation.

## Verification and rollout boundary

Before redeployment, 57 focused Telegram tests and the full 522-test server
suite passed. Production preflight passed; the rebuilt server was healthy, its
catalog and service hashes matched the verified enabled source, the public
live/ready endpoints returned 200, and smoke passed. Both Xray and Hysteria2
were active on DE and NL after deployment. The earlier synthetic no-op was
accepted by the owner on 2026-09-16. There is no current real repair run; the
first genuine matching incident with owner confirmation is still required to
accept real execution and postchecks.
