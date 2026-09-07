#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root" >&2
  exit 1
fi

app_root=/home/deploy/apps/jarvis
agent_root=/opt/jarvis-host-agent
secret_source="$app_root/deploy/secrets/operations-host-agent-authenticator"

test -d "$app_root/host-agent/jarvis_host_agent"
test -s "$secret_source"
getent group deploy >/dev/null

install -d -o root -g root -m 0750 "$agent_root" /etc/jarvis-host-agent
cp -a "$app_root/host-agent/." "$agent_root/"
install -o root -g root -m 0644 "$app_root/deploy/host-agent/jarvis-host-agent.service" /etc/systemd/system/jarvis-host-agent.service
install -o root -g root -m 0644 "$app_root/deploy/host-agent/jarvis-host-agent.tmpfiles.conf" /usr/lib/tmpfiles.d/jarvis-host-agent.conf
if [[ ! -f /etc/jarvis-host-agent/config.json ]]; then
  install -o root -g root -m 0600 "$app_root/deploy/host-agent/config.example.json" /etc/jarvis-host-agent/config.json
else
  chown root:root /etc/jarvis-host-agent/config.json
  chmod 0600 /etc/jarvis-host-agent/config.json
fi
install -o root -g root -m 0600 "$secret_source" /etc/jarvis-host-agent/authenticator

systemd-tmpfiles --create /usr/lib/tmpfiles.d/jarvis-host-agent.conf
systemctl daemon-reload
systemctl restart jarvis-host-agent
systemctl is-active --quiet jarvis-host-agent
PYTHONPATH="$agent_root" /usr/bin/python3 -m unittest discover -s "$agent_root/tests"

cd "$app_root"
docker compose -f deploy/docker-compose.yml up -d --build server
for _attempt in {1..30}; do
  server_health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' jarvis-family-server-1 2>/dev/null || true)
  [[ "$server_health" == "healthy" ]] && break
  sleep 2
done
[[ "${server_health:-}" == "healthy" ]]
bash deploy/scripts/smoke.sh https://jarvis.rilora.ru

echo "Jarvis service inventory deployment OK"
