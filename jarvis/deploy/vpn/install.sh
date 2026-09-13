#!/usr/bin/env bash
set -euo pipefail

[[ "${EUID}" -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ "$#" -ge 2 && "$#" -le 3 ]] || { echo "Usage: install.sh SERVER_ADDRESS REALITY_SERVER_NAME [CLIENT_LABEL]" >&2; exit 2; }

app_root=/home/deploy/apps/jarvis
server_address=$1
reality_server_name=$2
client_label=${3:-Owner-Happ}
xray_bin=/usr/local/bin/xray
legacy_xray=/usr/local/x-ui/bin/xray-linux-amd64
backup_root=/var/backups/jarvis-vpn
backup_dir="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)"

[[ "$server_address" =~ ^[A-Za-z0-9.-]{1,253}$ ]] || { echo "Invalid server address" >&2; exit 2; }
[[ "$reality_server_name" =~ ^[A-Za-z0-9.-]{1,253}$ ]] || { echo "Invalid REALITY server name" >&2; exit 2; }
[[ "$client_label" =~ ^[A-Za-zА-Яа-яЁё0-9_.\ -]{1,40}$ ]] || { echo "Invalid client label" >&2; exit 2; }
[[ -f "$app_root/host-agent/jarvis_host_agent/vpn_manager.py" ]]

getent group xray >/dev/null || groupadd --system xray
id -u xray >/dev/null 2>&1 || useradd --system --gid xray --home-dir /nonexistent --shell /usr/sbin/nologin xray

install -d -o root -g root -m 0700 "$backup_root" "$backup_dir"
if [[ -f /usr/local/x-ui/bin/config.json ]]; then
  install -o root -g root -m 0600 /usr/local/x-ui/bin/config.json "$backup_dir/x-ui-config.json"
fi
if [[ -f /etc/systemd/system/x-ui.service ]]; then
  install -o root -g root -m 0644 /etc/systemd/system/x-ui.service "$backup_dir/x-ui.service"
fi

if [[ ! -x "$xray_bin" ]]; then
  [[ -x "$legacy_xray" ]] || { echo "No verified Xray binary is installed" >&2; exit 1; }
  install -o root -g root -m 0755 "$legacy_xray" "$xray_bin"
fi
install -d -o root -g root -m 0755 /usr/local/share/xray
for asset in geoip.dat geosite.dat; do
  if [[ -f "/usr/local/x-ui/bin/$asset" ]]; then
    install -o root -g root -m 0644 "/usr/local/x-ui/bin/$asset" "/usr/local/share/xray/$asset"
  fi
done
install -d -o root -g xray -m 0750 /etc/xray
install -d -o root -g root -m 0700 /etc/jarvis-vpn
install -o root -g root -m 0644 "$app_root/deploy/vpn/xray.service" /etc/systemd/system/xray.service

PYTHONPATH="$app_root/host-agent" /usr/bin/python3 - "$server_address" "$reality_server_name" "$client_label" "$xray_bin" <<'PY'
import json
import os
import re
import secrets
import subprocess
import sys
import uuid
from pathlib import Path
from urllib.parse import quote

from jarvis_host_agent.vpn_manager import validate_state, xray_config

address, server_name, label, xray_bin = sys.argv[1:]
state_path = Path('/etc/jarvis-vpn/state.json')
config_path = Path('/etc/xray/config.json')
export_path = Path('/etc/jarvis-vpn/bootstrap-client.txt')

if not state_path.exists():
    generated = subprocess.run([xray_bin, 'x25519'], check=True, capture_output=True, text=True).stdout
    private_match = re.search(r'^PrivateKey:\s*(\S+)\s*$', generated, re.MULTILINE)
    public_match = re.search(r'^(?:PublicKey|Password \(PublicKey\)):\s*(\S+)\s*$', generated, re.MULTILINE)
    private_key = private_match.group(1) if private_match else None
    public_key = public_match.group(1) if public_match else None
    if not private_key or not public_key:
        raise SystemExit('Xray x25519 output was not recognized')
    client = {
        'id': f'vpn-{secrets.token_hex(6)}',
        'label': label,
        'uuid': str(uuid.uuid4()),
        'shortId': secrets.token_hex(8),
        'createdAt': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
    }
    state = validate_state({
        'version': 1,
        'address': address,
        'port': 443,
        'serverName': server_name,
        'privateKey': private_key,
        'publicKey': public_key,
        'clients': [client],
    })
    query = f'encryption=none&flow=xtls-rprx-vision&security=reality&sni={quote(server_name, safe="")}&fp=chrome&pbk={quote(public_key, safe="")}&sid={client["shortId"]}&type=tcp'
    share_uri = f'vless://{client["uuid"]}@{address}:443?{query}#{quote(label, safe="")}'
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    export_path.write_text(share_uri + '\n', encoding='utf-8')
    os.chmod(state_path, 0o600)
    os.chmod(export_path, 0o600)
else:
    state = validate_state(json.loads(state_path.read_text(encoding='utf-8')))

config_path.write_text(json.dumps(xray_config(state), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
os.chown(config_path, 0, __import__('grp').getgrnam('xray').gr_gid)
os.chmod(config_path, 0o640)
PY

"$xray_bin" run -test -c /etc/xray/config.json >/dev/null
systemctl daemon-reload

rollback() {
  systemctl stop xray.service >/dev/null 2>&1 || true
  if systemctl list-unit-files x-ui.service >/dev/null 2>&1; then
    systemctl enable x-ui.service >/dev/null 2>&1 || true
    systemctl start x-ui.service >/dev/null 2>&1 || true
  fi
}
trap rollback ERR
systemctl stop x-ui.service
systemctl disable x-ui.service >/dev/null
systemctl enable --now xray.service
systemctl is-active --quiet xray.service
for _attempt in {1..20}; do
  if /usr/bin/ss -lnt 'sport = :443' | /usr/bin/grep ':443' >/dev/null; then
    break
  fi
  sleep 0.25
done
/usr/bin/ss -lnt 'sport = :443' | /usr/bin/grep ':443' >/dev/null
trap - ERR

echo "Jarvis managed Xray VPN installed; protected bootstrap export: /etc/jarvis-vpn/bootstrap-client.txt"
