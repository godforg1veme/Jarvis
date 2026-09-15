# Host Agent HTTP-Auth Hardening and Test Deployment Synchronization

Date: 2026-09-15  
Status: Proposed  
Scope: `host-agent/jarvis_host_agent/hysteria_vpn_manager.py`, `host-agent/tests/test_hysteria_vpn_manager.py`, deploy scripts and host verification.

## 1. Problem Statement

1. **Test Expectations vs Production on VPS**:
   - Production Host Agent was migrated to external dynamic HTTP authentication (`auth: { type: "http", http: { url: "http://127.0.0.1:3211/vpn/hysteria2/auth" } }`) in commit `43a7c3e`.
   - The test in git was updated to `test_config_is_bound_to_second_ip_and_contains_http_auth_without_logs`.
   - However, during the deployment of `43a7c3e`, only `jarvis_host_agent/hysteria_vpn_manager.py` and `server.py` were selectively copied to the VPS (`scp`), while `tests/` remained at the previous revision. Running unittests on the VPS failed on the obsolete `test_config_is_bound_to_second_ip_and_contains_userpass_without_logs` (`KeyError: 'userpass'`).

2. **HTTP-Auth Endpoint Hardening**:
   - The Hysteria 2 HTTP-auth handler `handle_hysteria_auth` in `jarvis_host_agent/hysteria_vpn_manager.py` did not validate the HTTP request path (`/vpn/hysteria2/auth`).
   - Malformed JSON, non-object JSON payloads, or invalid UTF-8 were caught by the general `except Exception:` block and returned `500 Internal Server Error` instead of semantically correct `400 Bad Request`.
   - Negative or non-numeric `Content-Length` headers fell back to 0 rather than being rejected as bad requests.
   - The endpoint had zero unit and integration tests.

## 2. Scope & Design

### A. HTTP-Auth Hardening (`handle_hysteria_auth`)

The HTTP server listening on `127.0.0.1:3211` must enforce strict protocol validation:

- **Method**: only `POST` is accepted. Any other method (`GET`, `PUT`, `DELETE`, etc.) returns `405 Method Not Allowed` with body `{"ok":false}`.
- **Path**: only `/vpn/hysteria2/auth` is accepted. Any other request path returns `404 Not Found` with body `{"ok":false}`.
- **Content-Length**:
  - Must be a valid non-negative integer.
  - Must not exceed 4096 bytes (`400 Bad Request` if exceeded or negative).
- **Body & JSON Parsing**:
  - Body must be valid UTF-8 (`400 Bad Request` on `UnicodeDecodeError`).
  - Body must be valid JSON (`400 Bad Request` on `json.JSONDecodeError`).
  - Decoded JSON payload must be a JSON object (`dict`); arrays or primitives return `400 Bad Request`.
- **Authentication Evaluation**:
  - `auth` field extracted from payload: string formatted as `clientId:clientPassword`.
  - Constant-time verification against `/etc/jarvis-vpn/hysteria2-state.json` via `verify_client_auth`.
  - **Valid credentials**: returns `200 OK` with JSON `{"ok": true, "id": "<client_id>"}`.
  - **Invalid credentials / unknown client**: returns `200 OK` with JSON `{"ok": false}` (per Hysteria 2 HTTP auth specification).
- **General Exception Safety**:
  - Any unexpected runtime error in stream handling returns `500 Internal Server Error` with `{"ok":false}`.

### B. Test Suite Enhancements (`test_hysteria_vpn_manager.py`)

1. **Deterministic Async Unit Tests**:
   - Direct execution of `handle_hysteria_auth` against mock streams (`asyncio.StreamReader` / `asyncio.StreamWriter` or in-memory byte streams):
     - `test_http_auth_valid_credentials`: `POST /vpn/hysteria2/auth` with valid JSON -> `200 OK`, `{"ok": true, "id": "..."}`.
     - `test_http_auth_invalid_credentials`: wrong password -> `200 OK`, `{"ok": false}`.
     - `test_http_auth_wrong_method`: `GET` -> `405 Method Not Allowed`.
     - `test_http_auth_wrong_path`: `POST /unknown` -> `404 Not Found`.
     - `test_http_auth_oversized_body`: `Content-Length: 5000` -> `400 Bad Request`.
     - `test_http_auth_invalid_content_length`: non-numeric or negative -> `400 Bad Request`.
     - `test_http_auth_malformed_utf8`: invalid byte sequence -> `400 Bad Request`.
     - `test_http_auth_malformed_json`: invalid JSON syntax -> `400 Bad Request`.
     - `test_http_auth_non_object_json`: JSON list `[1, 2]` -> `400 Bad Request`.

2. **Real TCP Integration Smoke Test**:
   - `test_http_auth_tcp_integration_smoke`:
     - Spawns `asyncio.start_server` bound to `127.0.0.1` on ephemeral port `0`.
     - Connects via `asyncio.open_connection("127.0.0.1", port)`.
     - Sends a valid HTTP `POST /vpn/hysteria2/auth` request with matching credentials from fixture state.
     - Asserts `HTTP/1.1 200 OK` and `{"ok": true, "id": "vpn-0123456789ab"}`.
     - Closes writer and awaits server closure cleanly.

### C. Deployment & Synchronization Policy

1. **Eliminate Partial-File Deployments**:
   - Forbid cherry-picking individual `.py` files to production hosts without their tests.
   - Host Agent deployments must deploy the complete runtime tree (`jarvis_host_agent/` and `tests/`) synchronously.
2. **Pre-Deploy & Post-Deploy Verification**:
   - Run the complete test suite locally before any deployment:
     ```powershell
     $env:PYTHONPATH="f:\test\jarvis\host-agent"; py -3 -m unittest discover -s host-agent/tests
     ```
   - Synchronize the entire `host-agent/` directory to `/home/deploy/apps/jarvis/host-agent/` and `/opt/jarvis-host-agent/`.
   - Run post-deploy test suite on the VPS:
     ```bash
     PYTHONPATH=/opt/jarvis-host-agent /usr/bin/python3 -m unittest discover -s /opt/jarvis-host-agent/tests
     ```
   - Verify `jarvis-host-agent.service` is active and responsive.

## 3. Verification Plan

- Local unittests pass completely (all existing 32 tests + 10 new tests = 42 tests).
- VPS unittests pass completely (42 tests, 0 failures).
- Real TCP connection on VPS to `127.0.0.1:3211` verified.
- Status of `hysteria-server.service` and `jarvis-host-agent.service` active.
- Document the verification and commit/push to git.
