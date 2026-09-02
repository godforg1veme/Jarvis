#!/usr/bin/env bash
set -euo pipefail

# Run on the Docker host as root (or another account that can read Docker volume
# mountpoints). Secrets stay in RESTIC_REPOSITORY and RESTIC_PASSWORD_FILE.

compose_file="${JARVIS_BACKUP_COMPOSE_FILE:-deploy/docker-compose.yml}"
env_file="${JARVIS_BACKUP_ENV_FILE:-deploy/.env}"
project_name="${JARVIS_BACKUP_PROJECT:-jarvis-family}"
document_volume="${JARVIS_DOCUMENT_VOLUME:-${project_name}_document-data}"
pause_server="${JARVIS_BACKUP_PAUSE_SERVER:-1}"
keep_daily="${JARVIS_BACKUP_KEEP_DAILY:-7}"
keep_weekly="${JARVIS_BACKUP_KEEP_WEEKLY:-4}"
keep_monthly="${JARVIS_BACKUP_KEEP_MONTHLY:-6}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; exit 1; }
}

for command_name in docker restic tar flock; do require_command "$command_name"; done
[[ -f "$compose_file" ]] || { echo "Compose file is not readable" >&2; exit 1; }
[[ -f "$env_file" ]] || { echo "Environment file is not readable" >&2; exit 1; }
[[ -n "${RESTIC_REPOSITORY:-}" ]] || { echo "RESTIC_REPOSITORY is required" >&2; exit 1; }
[[ -n "${RESTIC_PASSWORD_FILE:-}" && -r "${RESTIC_PASSWORD_FILE}" ]] || { echo "RESTIC_PASSWORD_FILE must name a readable file" >&2; exit 1; }

lock_file="${JARVIS_BACKUP_LOCK_FILE:-/var/lock/jarvis-backup.lock}"
lock_directory="$(dirname "$lock_file")"
if [[ ! -d "$lock_directory" ]]; then
  install -d -m 0700 "$lock_directory"
fi
exec 9>"$lock_file"
flock -n 9 || { echo "another Jarvis backup is already running" >&2; exit 1; }

compose=(docker compose --project-name "$project_name" --env-file "$env_file" -f "$compose_file")
server_was_paused=0
resume_server() {
  if [[ "$server_was_paused" == "1" ]]; then
    "${compose[@]}" start server >/dev/null 2>&1 || echo "warning: failed to restart server; start it manually" >&2
  fi
}
trap resume_server EXIT

if [[ "$pause_server" == "1" ]]; then
  if "${compose[@]}" ps --status running --services | grep -Fxq server; then
    "${compose[@]}" stop --timeout 30 server
    server_was_paused=1
  fi
elif [[ "$pause_server" != "0" ]]; then
  echo "JARVIS_BACKUP_PAUSE_SERVER must be 0 or 1" >&2
  exit 1
fi

document_mount="$(docker volume inspect --format '{{ .Mountpoint }}' "$document_volume")"
[[ -d "$document_mount" ]] || { echo "document volume mountpoint is unavailable" >&2; exit 1; }

run_id="$(date -u +%Y%m%dT%H%M%SZ)"
base_tags=(--tag jarvis-backup --tag "jarvis-run-${run_id}")

"${compose[@]}" exec -T postgres sh -lc 'exec pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' \
  | restic backup --stdin --stdin-filename postgres.dump "${base_tags[@]}" --tag jarvis-database

tar --create --file - --directory "$document_mount" --numeric-owner . \
  | restic backup --stdin --stdin-filename documents.tar "${base_tags[@]}" --tag jarvis-documents

printf '{"runId":"%s","createdAt":"%s","documentVolume":"%s"}\n' \
  "$run_id" "$(date -u +%FT%TZ)" "$document_volume" \
  | restic backup --stdin --stdin-filename manifest.json "${base_tags[@]}" --tag jarvis-complete

restic forget --prune --tag jarvis-backup \
  --keep-daily "$keep_daily" --keep-weekly "$keep_weekly" --keep-monthly "$keep_monthly"

echo "Jarvis backup ${run_id} completed"
