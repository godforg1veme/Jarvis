#!/usr/bin/env bash
set -euo pipefail

[[ "${EUID}" -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ "$#" -ge 1 ]] || { echo "Usage: setup-port-hopping.sh SERVER_ADDRESS [PORT_RANGE] [TARGET_PORT]" >&2; exit 2; }

server_address="$1"
port_range="${2:-20000:50000}"
target_port="${3:-443}"

[[ "$server_address" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo "Invalid server address: $server_address" >&2; exit 2; }

echo "[1/3] Configuring iptables NAT PREROUTING DNAT..."
if /usr/sbin/iptables -t nat -C PREROUTING -d "$server_address" -p udp --dport "$port_range" -j REDIRECT --to-ports "$target_port" 2>/dev/null; then
  echo "Removing legacy REDIRECT rule..."
  /usr/sbin/iptables -t nat -D PREROUTING -d "$server_address" -p udp --dport "$port_range" -j REDIRECT --to-ports "$target_port"
fi

if ! /usr/sbin/iptables -t nat -C PREROUTING -d "$server_address" -p udp --dport "$port_range" -j DNAT --to-destination "${server_address}:${target_port}" 2>/dev/null; then
  echo "Adding DNAT rule: $server_address udp:$port_range -> ${server_address}:${target_port}"
  /usr/sbin/iptables -t nat -A PREROUTING -d "$server_address" -p udp --dport "$port_range" -j DNAT --to-destination "${server_address}:${target_port}"
else
  echo "iptables NAT DNAT rule already present."
fi

echo "[2/3] Configuring UFW firewall..."
if ! /usr/sbin/ufw status | /usr/bin/grep -Eq "^${server_address}[[:space:]]+${port_range}/udp[[:space:]]+ALLOW"; then
  echo "Allowing UFW: $server_address $port_range/udp"
  /usr/sbin/ufw allow proto udp to "$server_address" port "$port_range" comment 'Jarvis Hysteria2 Port Hopping'
else
  echo "UFW rule already present."
fi

echo "[3/3] Persisting iptables rules..."
if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save || true
elif [[ -d /etc/iptables ]]; then
  iptables-save > /etc/iptables/rules.v4 || true
fi

echo "SUCCESS: Port hopping ${port_range}/udp DNAT to ${server_address}:${target_port} configured!"