"""Unix-socket Host Agent server with authenticated, bounded JSON requests."""

from __future__ import annotations

import argparse
import asyncio
import hmac
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .actions import execute
from .config import HostAgentConfig, load_config
from .hysteria_vpn_manager import DEFAULT_AUTH_HOST, DEFAULT_AUTH_PORT, handle_hysteria_auth
from .idempotency import IdempotencyJournal, request_mac
from .protocol import MAX_ENVELOPE_BYTES, ProtocolError, validate_request


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def read_authenticator(config: HostAgentConfig) -> bytes:
    value = config.authenticator_path.read_bytes().strip()
    if len(value) < 32 or len(value) > 512:
        raise ProtocolError("Host Agent authenticator is invalid")
    return value


def response_for(request: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    now = utc_now()
    response = {"version": 1, "requestId": request["requestId"], "operation": request["operation"], "receivedAt": now, "completedAt": now, "result": result}
    if len(json.dumps(response, separators=(",", ":")).encode('utf-8')) > MAX_ENVELOPE_BYTES:
        response['result'] = {'state': 'unknown', 'errorCode': 'RESPONSE_TOO_LARGE'}
    return response


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, config: HostAgentConfig, authenticator: bytes, journal: IdempotencyJournal) -> None:
    try:
        raw = await asyncio.wait_for(reader.readline(), timeout=15)
        if not raw or len(raw) > MAX_ENVELOPE_BYTES:
            raise ProtocolError("request is too large")
        wrapper = json.loads(raw.decode("utf-8"))
        if not isinstance(wrapper, dict) or set(wrapper) != {"auth", "request"} or not isinstance(wrapper["auth"], str):
            raise ProtocolError("request wrapper is invalid")
        request = validate_request(wrapper["request"])
        if not hmac.compare_digest(wrapper["auth"], request_mac(authenticator, request)):
            raise ProtocolError("request is unauthenticated")
        cached = journal.get(request)
        if cached is not None:
            payload = cached
        elif request["operation"] == "operation.status":
            original = journal.get_response(request["arguments"]["requestId"])
            result = {"state": "succeeded", "data": {"found": original is not None, "response": original}}
            payload = journal.put(request, response_for(request, result))
        elif request["operation"] in {"service.start", "service.stop", "service.restart", "backup.run", "vpn.client.issue", "vpn.client.revoke", "vpn.client.rotate", "vpn.client.export", "vpn.restart", "vpn.hysteria2.client.issue", "vpn.hysteria2.client.revoke", "vpn.hysteria2.client.rotate", "vpn.hysteria2.client.export", "vpn.hysteria2.restart", "vpn.external_probe.credential.install", "vpn.external_probe.run", "vpn.external_probe.monitor.enable", "vpn.external_probe.monitor.disable"}:
            placeholder = response_for(request, {"state": "unknown", "errorCode": "ACTION_OUTCOME_PENDING"})
            if journal.claim(request, placeholder):
                loop = asyncio.get_running_loop()
                exec_result = await loop.run_in_executor(None, execute, config, request["operation"], request["arguments"])
                payload = journal.complete(request, response_for(request, exec_result))
            else:
                payload = journal.get(request)
        else:
            loop = asyncio.get_running_loop()
            exec_result = await loop.run_in_executor(None, execute, config, request["operation"], request["arguments"])
            payload = journal.put(request, response_for(request, exec_result))
    except (UnicodeError, ValueError, ProtocolError, asyncio.TimeoutError):
        payload = {"version": 1, "requestId": "00000000-0000-4000-8000-000000000000", "operation": "host.snapshot", "receivedAt": utc_now(), "completedAt": utc_now(), "result": {"state": "failed", "errorCode": "REQUEST_REJECTED"}}
    writer.write(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8") + b"\n")
    await writer.drain()
    writer.close()
    await writer.wait_closed()


async def run(socket_path: Path, config: HostAgentConfig) -> None:
    authenticator = read_authenticator(config)
    journal = IdempotencyJournal(config.state_dir)
    socket_path.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    if socket_path.exists():
        socket_path.unlink()
    server = await asyncio.start_unix_server(lambda r, w: handle(r, w, config, authenticator, journal), path=str(socket_path))
    os.chmod(socket_path, 0o660)
    auth_server = await asyncio.start_server(lambda r, w: handle_hysteria_auth(r, w), host=DEFAULT_AUTH_HOST, port=DEFAULT_AUTH_PORT)
    async with server, auth_server:
        await asyncio.gather(server.serve_forever(), auth_server.serve_forever())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--socket", required=True)
    args = parser.parse_args()
    asyncio.run(run(Path(args.socket), load_config(args.config)))


if __name__ == "__main__":
    main()
