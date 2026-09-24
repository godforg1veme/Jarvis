# Host Agent HTTP-Auth Hardening and Test Synchronization

Date: 2026-09-15

## Outcome

The Host Agent Hysteria 2 HTTP-auth endpoint (`handle_hysteria_auth` on
`127.0.0.1:3211/vpn/hysteria2/auth`) was hardened against invalid and malformed
requests, covered with comprehensive unit and TCP integration tests, and
synchronized in full across git, the deployment staging tree, and the production
Host Agent runtime on the VPS.

The root cause of the previous test failure on VPS (`KeyError: 'userpass'`) was
identified: during the earlier rollout of commit `43a7c3e`, only
`hysteria_vpn_manager.py` and `server.py` were selectively copied (`scp`),
leaving `tests/` in an outdated state expecting the legacy `userpass`
configuration.

## Hardening Details

- **Strict Path Validation**: requests must target `/vpn/hysteria2/auth` exactly;
  any other path returns `404 Not Found` (`{"ok":false}`).
- **Strict Method Validation**: only `POST` is permitted; any other method
  returns `405 Method Not Allowed` (`{"ok":false}`).
- **Content-Length Validation**: non-numeric, negative, or oversized (>4096
  bytes) values are explicitly rejected with `400 Bad Request` (`{"ok":false}`).
- **Payload Validation**: invalid UTF-8, malformed JSON, and non-object JSON
  bodies are explicitly caught and return `400 Bad Request` (`{"ok":false}`).
- **Authentication**: valid credentials return `200 OK` with
  `{"ok": true, "id": "<clientId>"}`; invalid credentials return `200 OK` with
  `{"ok": false}` per the Hysteria 2 HTTP authentication specification.

## Verified Checks

- **Local Host Agent Tests**: 42/42 tests passed:
  - 32 existing tests covering actions, backup, metrics, idempotency, protocol, server, and VPN managers;
  - 9 deterministic async unit tests covering all HTTP-auth validation branches;
  - 1 real loopback TCP integration smoke test with ephemeral port binding (`asyncio.start_server`).
- **Full VPS Runtime Synchronization**: the entire `host-agent/` tree
  (runtime package and tests) was deployed cleanly to `/home/deploy/apps/jarvis/host-agent/`
  and `/opt/jarvis-host-agent/`.
- **VPS Host Agent Tests**: 42/42 tests passed on the production host
  (`PYTHONPATH=/opt/jarvis-host-agent /usr/bin/python3 -m unittest discover -s /opt/jarvis-host-agent/tests`).
- **Service Verification**: `jarvis-host-agent.service` and `hysteria-server.service`
  are active.
- **Live HTTP-Auth Verification on VPS**:
  - Live query with invalid credentials returns `200 OK` `{"ok":false}`.
  - Live query with real client credentials returns `200 OK` `{"ok":true,"id":"vpn-0996d42c5cfc"}`.
  - Live query with wrong path returns `404 Not Found`.
  - Live query with wrong method returns `405 Method Not Allowed`.
  - Live query with malformed JSON returns `400 Bad Request`.
- **Smoke Check**: `bash deploy/scripts/smoke.sh https://jarvis.rilora.ru` passed.
- **Deployment Policy Update**: documented in `deploy/host-agent/README.md` that
  Host Agent updates must deploy the complete runtime and test tree, never
  partial files.
