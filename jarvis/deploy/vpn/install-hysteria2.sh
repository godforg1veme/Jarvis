#!/usr/bin/env bash
set -euo pipefail

[[ "${EUID}" -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ "$#" -ge 3 && "$#" -le 4 ]] || { echo "Usage: install-hysteria2.sh SERVER_ADDRESS SERVER_NAME ACME_EMAIL [CLIENT_LABEL]" >&2; exit 2; }

app_root=/home/deploy/apps/jarvis
server_address=$1
server_name=$2
acme_email=$3
client_label=${4:-Owner-iPhone}
hysteria_bin=/usr/local/bin/hysteria
hysteria_version=v2.12.2
hysteria_sha256=6493dfffd55b5883f64c76c63880ecc32988f0c568c9ca9014907877b4d55f94
hysteria_url="https://github.com/HyNetworks/hysteria/releases/download/app/${hysteria_version}/hysteria-linux-amd64"
state_path=/etc/jarvis-vpn/hysteria2-state.json
config_path=/etc/hysteria/config.yaml
export_path=/etc/jarvis-vpn/hysteria2-bootstrap-client.txt
backup_root=/var/backups/jarvis-vpn
backup_dir="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)-hysteria2"

[[ "$server_address" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo "Invalid server address" >&2; exit 2; }
[[ "$server_name" =~ ^[A-Za-z0-9.-]{1,253}$ && "$server_name" == *.* && "$server_name" != *: ]] || { echo "Invalid server name" >&2; exit 2; }
[[ "$acme_email" =~ ^[^[:space:]@]+@[^[:space:]@]+$ ]] || { echo "Invalid ACME email" >&2; exit 2; }
[[ "$client_label" =~ ^[A-Za-zА-Яа-яЁё0-9_.\ -]{1,40}$ && "$client_label" != *..* ]] || { echo "Invalid client label" >&2; exit 2; }
[[ -f "$app_root/host-agent/jarvis_host_agent/hysteria_vpn_manager.py" ]]
[[ -f "$app_root/deploy/vpn/hysteria-server.service" ]]

/usr/bin/python3 - "$server_address" <<'PY'
import ipaddress
import sys
ipaddress.IPv4Address(sys.argv[1])
PY

/usr/sbin/ip -4 -o addr show scope global | /usr/bin/grep -F " $server_address/" >/dev/null || { echo "Server address is not assigned" >&2; exit 1; }
if [[ ! -d /var/lib/hysteria/acme/certificates ]]; then
  resolved=$(/usr/bin/getent ahostsv4 "$server_name" | /usr/bin/awk '{print $1}' | /usr/bin/sort -u)
  /usr/bin/grep -Fx "$server_address" <<<"$resolved" >/dev/null || { echo "Public DNS does not point to the server address" >&2; exit 1; }
fi

udp_owner=$(/usr/bin/ss -H -lunp 'sport = :443' || true)
if [[ -n "$udp_owner" ]] && ! /usr/bin/grep -q 'hysteria' <<<"$udp_owner"; then
  echo "UDP 443 is already occupied" >&2
  exit 1
fi
tcp_owner=$(/usr/bin/ss -H -lntp 'sport = :80' || true)
if [[ -n "$tcp_owner" ]] && ! /usr/bin/grep -q 'hysteria' <<<"$tcp_owner"; then
  echo "TCP 80 is already occupied" >&2
  exit 1
fi

install -d -o root -g root -m 0700 "$backup_root" "$backup_dir"
had_binary=0; had_state=0; had_config=0; had_service=0
[[ -f "$hysteria_bin" ]] && { cp -a "$hysteria_bin" "$backup_dir/hysteria.bin"; had_binary=1; }
[[ -f "$state_path" ]] && { cp -a "$state_path" "$backup_dir/hysteria2-state.json"; had_state=1; }
[[ -f "$config_path" ]] && { cp -a "$config_path" "$backup_dir/config.yaml"; had_config=1; }
[[ -f /etc/systemd/system/hysteria-server.service ]] && { cp -a /etc/systemd/system/hysteria-server.service "$backup_dir/hysteria-server.service"; had_service=1; }
was_active=0; was_enabled=0
/usr/bin/systemctl is-active --quiet hysteria-server.service 2>/dev/null && was_active=1 || true
/usr/bin/systemctl is-enabled --quiet hysteria-server.service 2>/dev/null && was_enabled=1 || true

temporary=$(mktemp)
cleanup() { rm -f "$temporary"; }
trap cleanup EXIT
/usr/bin/curl --fail --show-error --location --proto '=https' --tlsv1.2 "$hysteria_url" -o "$temporary"
echo "$hysteria_sha256  $temporary" | /usr/bin/sha256sum --check --status || { echo "Hysteria checksum mismatch" >&2; exit 1; }
install -o root -g root -m 0755 "$temporary" "$hysteria_bin"
"$hysteria_bin" version | /usr/bin/grep -F "$hysteria_version" >/dev/null

getent group hysteria >/dev/null || groupadd --system hysteria
id -u hysteria >/dev/null 2>&1 || useradd --system --gid hysteria --home-dir /var/lib/hysteria --shell /usr/sbin/nologin hysteria
install -d -o root -g root -m 0700 /etc/jarvis-vpn
install -d -o root -g hysteria -m 0750 /etc/hysteria
install -d -o hysteria -g hysteria -m 0700 /var/lib/hysteria /var/lib/hysteria/acme
chown -R hysteria:hysteria /var/lib/hysteria
install -o root -g root -m 0644 "$app_root/deploy/vpn/hysteria-server.service" /etc/systemd/system/hysteria-server.service

PYTHONPATH="$app_root/host-agent" /usr/bin/python3 - "$server_address" "$server_name" "$acme_email" "$client_label" <<'PY'
import json
import os
import secrets
import sys
from pathlib import Path

from jarvis_host_agent.hysteria_vpn_manager import HysteriaVpnManager, hysteria_config, validate_hysteria_state

address, server_name, acme_email, label = sys.argv[1:]
state_path = Path('/etc/jarvis-vpn/hysteria2-state.json')
config_path = Path('/etc/hysteria/config.yaml')
export_path = Path('/etc/jarvis-vpn/hysteria2-bootstrap-client.txt')

if state_path.exists():
    state = validate_hysteria_state(json.loads(state_path.read_text(encoding='utf-8')))
else:
    client = HysteriaVpnManager._new_client(label)
    state = validate_hysteria_state({
        'version': 1,
        'address': address,
        'port': 443,
        'serverName': server_name,
        'acmeEmail': acme_email,
        'obfsPassword': secrets.token_urlsafe(32),
        'clients': [client],
    })
    export_path.write_text(HysteriaVpnManager.share_uri(state, client) + '\n', encoding='utf-8')
    os.chmod(export_path, 0o600)

state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
config_path.write_text(json.dumps(hysteria_config(state), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
os.chmod(state_path, 0o600)
os.chown(config_path, 0, __import__('grp').getgrnam('hysteria').gr_gid)
os.chmod(config_path, 0o640)
PY

/usr/bin/python3 -m json.tool "$config_path" >/dev/null
/usr/bin/systemctl daemon-reload

added_udp=0
added_http=0
if ! /usr/sbin/ufw status | /usr/bin/grep -Eq "^${server_address}[[:space:]]+443/udp[[:space:]]+ALLOW"; then
  /usr/sbin/ufw allow proto udp to "$server_address" port 443 comment 'Jarvis Hysteria2'
  added_udp=1
fi
if ! /usr/sbin/ufw status | /usr/bin/grep -Eq "^${server_address}[[:space:]]+80/tcp[[:space:]]+ALLOW"; then
  /usr/sbin/ufw allow proto tcp to "$server_address" port 80 comment 'Hysteria2 ACME'
  added_http=1
fi

rollback() {
  /usr/bin/systemctl stop hysteria-server.service >/dev/null 2>&1 || true
  if [[ "$added_udp" -eq 1 ]]; then /usr/sbin/ufw --force delete allow proto udp to "$server_address" port 443 >/dev/null 2>&1 || true; fi
  if [[ "$added_http" -eq 1 ]]; then /usr/sbin/ufw --force delete allow proto tcp to "$server_address" port 80 >/dev/null 2>&1 || true; fi
  if [[ "$had_binary" -eq 1 ]]; then cp -a "$backup_dir/hysteria.bin" "$hysteria_bin"; else rm -f "$hysteria_bin"; fi
  if [[ "$had_state" -eq 1 ]]; then cp -a "$backup_dir/hysteria2-state.json" "$state_path"; else rm -f "$state_path" "$export_path"; fi
  if [[ "$had_config" -eq 1 ]]; then cp -a "$backup_dir/config.yaml" "$config_path"; else rm -f "$config_path"; fi
  if [[ "$had_service" -eq 1 ]]; then cp -a "$backup_dir/hysteria-server.service" /etc/systemd/system/hysteria-server.service; else rm -f /etc/systemd/system/hysteria-server.service; fi
  /usr/bin/systemctl daemon-reload >/dev/null 2>&1 || true
  if [[ "$was_enabled" -eq 1 ]]; then /usr/bin/systemctl enable hysteria-server.service >/dev/null 2>&1 || true; else /usr/bin/systemctl disable hysteria-server.service >/dev/null 2>&1 || true; fi
  if [[ "$was_active" -eq 1 ]]; then /usr/bin/systemctl start hysteria-server.service >/dev/null 2>&1 || true; fi
}
trap rollback ERR
/usr/bin/systemctl enable hysteria-server.service
/usr/bin/systemctl restart hysteria-server.service
/usr/bin/systemctl is-active --quiet hysteria-server.service
for _attempt in {1..40}; do
  if /usr/bin/ss -H -lun | /usr/bin/grep -F "${server_address}:443" >/dev/null; then break; fi
  sleep 0.25
done
/usr/bin/ss -H -lun | /usr/bin/grep -F "${server_address}:443" >/dev/null
/usr/bin/systemctl is-active --quiet xray.service
/usr/bin/ss -H -lnt | /usr/bin/grep -E ':(443|8443)[[:space:]]' >/dev/null
trap - ERR

echo "Jarvis managed Hysteria2 installed; protected bootstrap export: $export_path"
