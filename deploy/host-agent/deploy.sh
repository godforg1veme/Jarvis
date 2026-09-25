#!/usr/bin/env bash
set -euo pipefail

app_root="${1:-/home/deploy/apps/jarvis}"
app_root="${app_root%$'\r'}"
agent_root="/opt/jarvis-host-agent"

echo "==> Verifying canonical source checkout..."
python3 "${app_root}/deploy/scripts/verify-source-checkout.py" source "${app_root}"

if [[ ! -d "${app_root}/host-agent/jarvis_host_agent" ]]; then
  echo "Error: ${app_root}/host-agent/jarvis_host_agent not found" >&2
  exit 1
fi

echo "==> Running Host Agent unit tests from staged source..."
sudo env PYTHONPATH="${app_root}/host-agent" /usr/bin/python3 -m unittest discover -s "${app_root}/host-agent/tests"

echo "==> Syncing host-agent files to ${agent_root}..."
sudo install -d -o root -g deploy -m 0750 "${agent_root}"
sudo cp -a "${app_root}/host-agent/." "${agent_root}/"
sudo chown -R deploy:deploy "${agent_root}"
sudo find "${agent_root}" -type d -exec chmod 0755 {} +
sudo find "${agent_root}" -type f -exec chmod 0644 {} +

echo "==> Restarting jarvis-host-agent.service..."
sudo systemctl restart jarvis-host-agent
sudo systemctl is-active --quiet jarvis-host-agent

echo "==> Verifying vpn.health.snapshot via Unix socket..."
sudo env PYTHONPATH="${agent_root}" /usr/bin/python3 - <<'PY'
import datetime
import json
import pathlib
import socket
import sys
import uuid
import jarvis_host_agent.idempotency as idemp

auth_path = pathlib.Path("/etc/jarvis-host-agent/authenticator")
if not auth_path.exists():
    print("WARNING: /etc/jarvis-host-agent/authenticator not found, skipping snapshot verification")
    sys.exit(0)

auth = auth_path.read_bytes().strip()
payload = {
    "version": 1,
    "requestId": str(uuid.uuid4()),
    "operation": "vpn.health.snapshot",
    "arguments": {},
    "sentAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
wrapper = {"auth": idemp.request_mac(auth, payload), "request": payload}

sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
connected = False
for _ in range(20):
    try:
        sock.connect("/run/jarvis-host-agent/agent.sock")
        connected = True
        break
    except (ConnectionRefusedError, FileNotFoundError):
        import time
        time.sleep(0.5)

if not connected:
    print("ERROR: Failed to connect to /run/jarvis-host-agent/agent.sock after 10s")
    sys.exit(1)

with sock:
    sock.sendall(json.dumps(wrapper).encode() + b"\n")
    response = json.loads(sock.recv(65536).decode())

if response.get("result", {}).get("state") != "succeeded":
    print("Health snapshot failed:", response)
    sys.exit(1)

data = response["result"]["data"]
print(json.dumps(data, indent=2, ensure_ascii=False))
PY

echo "==> Host Agent deployment completed successfully."
