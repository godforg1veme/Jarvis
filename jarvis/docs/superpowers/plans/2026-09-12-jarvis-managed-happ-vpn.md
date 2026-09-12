# Jarvis-managed Happ VPN implementation plan

Date: 2026-09-12
Design: `docs/superpowers/specs/2026-09-12-jarvis-managed-happ-vpn-design.md`

## Outcome

Replace the failed public x-ui-managed configuration with a validated Xray
VLESS/REALITY service, expose only bounded VPN operations through the Host
Agent, add Xray to Operations monitoring, make the same VPN commands available
in Telegram and Desktop cloud chat, and deliver the owner's Happ credential as
a protected local bundle.

## Phase 1: closed Host Agent contract

1. Add a focused `vpn_manager.py` module that owns paths, registry validation,
   config generation, atomic updates, rollback, status, client lifecycle, and
   share-URI generation.
2. Extend the Python and JavaScript Host Agent protocol manifests with strict
   schemas for status, list, issue, revoke, rotate, export, and restart.
3. Route the operations in `actions.py` without accepting commands, executable
   paths, raw configuration, UUIDs, or key material from callers.
4. Add unit tests for validation, redaction, idempotent state changes,
   rollback, and unavailable service behavior.
5. Add install templates for the root-owned state directory and `xray.service`.

## Phase 2: server command surface

1. Add an owner-scoped VPN repository/service with durable action records and
   origin-bound confirmation.
2. Add a migration after the existing Life OS migration; do not alter the
   in-progress Life OS files.
3. Implement one shared deterministic command parser used by Telegram and
   Desktop: status, clients, issue, revoke, rotate, export, restart, confirm,
   and reject.
4. Ensure persisted assistant text and audit metadata contain no UUID, REALITY
   password/public value, short ID, subscription token, or complete share URI.
5. Add a short-lived in-memory artifact store. Telegram/Desktop responses may
   expose only an opaque download handle; artifact retrieval is owner/device
   authenticated where applicable and is single-use.
6. Add focused authorization, confirmation, replay, expiry, redaction, and
   channel-parity tests.

## Phase 3: Operations monitoring

1. Add `xray` to the fixed service catalog and sanitized incident language.
2. Extend the Host Agent snapshot with a VPN-specific health probe and bounded
   aggregate metrics.
3. Store and display those metrics through existing Operations APIs/UI without
   peer addresses or destination history.
4. Enable only the intended restart capability for Xray.
5. Extend collector, actions, incidents, log-redaction, and UI fixture tests.

## Phase 4: production deployment

1. Run all focused local tests, then the complete server, Host Agent, and
   Operations UI suites.
2. Create a root-only rollback archive of x-ui state on the VPS.
3. Probe candidate REALITY targets from the VPS and select a matching
   `target`/SNI that supports the required TLS behavior.
4. Stage and validate Xray state, unit, and the first owner client while x-ui
   still owns TCP 443.
5. Stop/disable x-ui, start/enable Xray, then verify config, systemd, listener,
   local stats, and an external tunnel request. Roll back on any failure.
6. Close exact unused public firewall rules, retaining SSH and TCP 443.
7. Deploy the updated Jarvis server and Host Agent, enable Xray restart in the
   database capability allowlist, and verify the Operations panel plus
   Telegram/Desktop command paths.

## Phase 5: owner handoff

1. Write the Happ URI, QR code, and import instructions to an ignored local
   permission-restricted directory without printing secret contents.
2. Verify that the QR and URI describe the deployed server fields.
3. Report the protected artifact path and ask the owner to perform the two
   manual Happ checks: mobile data and Wi-Fi.
4. Compare the installed Desktop EXE with source because Desktop chat behavior
   changed; offer to build/install the current EXE but do not do so
   automatically.

## Required verification commands

```powershell
PYTHONPATH=host-agent python -m unittest discover -s host-agent/tests
cd server
npm test
cd ..\ops-ui
npm test
npm run build
cd ..
node scripts/testOperationsBrowser.cjs
node scripts/testRemoteProtocol.js
node scripts/testToolPolicyMapping.js
```

Production checks use `deploy/scripts/preflight.sh`, Compose health,
`deploy/scripts/smoke.sh`, `xray run -test`, systemd state, listener ownership,
an external client probe, and direct queries to the authenticated Operations
and chat paths. Secrets must be redacted from every captured output.
