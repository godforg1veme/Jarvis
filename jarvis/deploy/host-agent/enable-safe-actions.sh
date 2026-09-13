#!/usr/bin/env bash
set -euo pipefail

[[ "${EUID}" -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
app_root=/home/deploy/apps/jarvis
config=/etc/jarvis-host-agent/config.json
[[ -f "$config" ]] || { echo "Host Agent config is missing" >&2; exit 1; }

/usr/bin/python3 - "$config" <<'PY'
import json
import os
import sys
import tempfile

path = sys.argv[1]
with open(path, encoding="utf-8") as source:
    data = json.load(source)
allowed = {"jarvis-server": ["restart"], "cloudflared": ["restart"], "xray": ["restart"]}
for service in data.get("managedServices", []):
    service["actions"] = allowed.get(service.get("id"), [])
directory = os.path.dirname(path)
fd, temporary = tempfile.mkstemp(prefix="config.", suffix=".json", dir=directory)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as target:
        json.dump(data, target, ensure_ascii=False, indent=2)
        target.write("\n")
        target.flush()
        os.fsync(target.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY
chown root:root "$config"
systemctl restart jarvis-host-agent
systemctl is-active --quiet jarvis-host-agent

cd "$app_root"
docker compose -f deploy/docker-compose.yml exec -T postgres sh -lc 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
INSERT INTO ops_service_capabilities (service_id,action,enabled)
SELECT id,'restart',service_key IN ('jarvis-server','cloudflared','xray')
FROM ops_services
WHERE service_key IN ('jarvis-server','cloudflared','xray')
ON CONFLICT (service_id,action) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now();
SQL

echo "Safe Operations actions enabled: restart jarvis-server, restart cloudflared, restart xray"
