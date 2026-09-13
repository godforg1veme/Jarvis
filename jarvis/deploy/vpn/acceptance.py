#!/usr/bin/env python3
"""Exercise production Host Agent VPN issue/idempotency/revoke without printing credentials."""

from __future__ import annotations

import argparse
import json
import socket
import uuid
from datetime import datetime, timezone
from pathlib import Path

from jarvis_host_agent.idempotency import request_mac


def sent_at() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def request(
    socket_path: str,
    authenticator: bytes,
    operation: str,
    arguments: dict,
    request_id: str | None = None,
    sent_at_value: str | None = None,
) -> dict:
    payload = {
        "version": 1,
        "requestId": request_id or str(uuid.uuid4()),
        "operation": operation,
        "arguments": arguments,
        "sentAt": sent_at_value or sent_at(),
    }
    wrapper = {"auth": request_mac(authenticator, payload), "request": payload}
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(30)
        client.connect(socket_path)
        client.sendall(json.dumps(wrapper, separators=(",", ":")).encode("utf-8") + b"\n")
        chunks = []
        while True:
            chunk = client.recv(65536)
            if not chunk:
                break
            chunks.append(chunk)
    response = json.loads(b"".join(chunks))
    if response.get("requestId") != payload["requestId"] or response.get("operation") != operation:
        raise RuntimeError("Host Agent response correlation failed")
    return response


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", default="/run/jarvis-host-agent/agent.sock")
    parser.add_argument("--authenticator", default="/etc/jarvis-host-agent/authenticator")
    args = parser.parse_args()
    authenticator = Path(args.authenticator).read_bytes().strip()
    label = f"Acceptance-{uuid.uuid4().hex[:8]}"
    issue_id = str(uuid.uuid4())
    issue_sent_at = sent_at()
    client_id = None
    try:
        issued = request(args.socket, authenticator, "vpn.client.issue", {"label": label}, issue_id, issue_sent_at)
        if issued.get("result", {}).get("state") != "succeeded":
            raise RuntimeError("VPN issue failed")
        data = issued["result"].get("data", {})
        client_id = data.get("client", {}).get("id")
        if not client_id or not str(data.get("shareUri", "")).startswith("vless://"):
            raise RuntimeError("VPN issue result is incomplete")
        repeated = request(args.socket, authenticator, "vpn.client.issue", {"label": label}, issue_id, issue_sent_at)
        if repeated != issued:
            raise RuntimeError("VPN action was not idempotent")
        print("vpn_issue=succeeded")
        print("vpn_idempotency=verified")
    finally:
        if client_id:
            revoked = request(args.socket, authenticator, "vpn.client.revoke", {"clientId": client_id})
            if revoked.get("result", {}).get("state") != "succeeded":
                raise RuntimeError("VPN acceptance client cleanup failed")
            print("vpn_revoke=succeeded")


if __name__ == "__main__":
    main()
