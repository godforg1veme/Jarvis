#!/usr/bin/env bash
set -euo pipefail

# Consistent backup without stopping Jarvis. Only knowledge writes are paused;
# chat, Telegram polling, Desktop sessions, memory and Operations stay online.

compose_file="${JARVIS_BACKUP_COMPOSE_FILE:-deploy/docker-compose.yml}"
env_file="${JARVIS_BACKUP_ENV_FILE:-deploy/.env}"
project_name="${JARVIS_BACKUP_PROJECT:-jarvis-family}"
document_volume="${JARVIS_DOCUMENT_VOLUME:-${project_name}_document-data}"
keep_daily="${JARVIS_BACKUP_KEEP_DAILY:-7}"
keep_weekly="${JARVIS_BACKUP_KEEP_WEEKLY:-4}"
keep_monthly="${JARVIS_BACKUP_KEEP_MONTHLY:-6}"
drain_timeout="${JARVIS_BACKUP_DRAIN_TIMEOUT_SECONDS:-300}"
state_dir="${JARVIS_BACKUP_STATE_DIR:-/var/lib/jarvis-backup}"

require_command() { command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; exit 1; }; }
for command_name in docker restic tar flock; do require_command "$command_name"; done
[[ -f "$compose_file" ]] || { echo "Compose file is not readable" >&2; exit 1; }
[[ -f "$env_file" ]] || { echo "Environment file is not readable" >&2; exit 1; }
[[ -n "${RESTIC_REPOSITORY:-}" ]] || { echo "RESTIC_REPOSITORY is required" >&2; exit 1; }
[[ -n "${RESTIC_PASSWORD_FILE:-}" && -r "${RESTIC_PASSWORD_FILE}" ]] || { echo "RESTIC_PASSWORD_FILE must name a readable file" >&2; exit 1; }
[[ "$drain_timeout" =~ ^[0-9]+$ && "$drain_timeout" -ge 1 && "$drain_timeout" -le 3600 ]] || { echo "invalid drain timeout" >&2; exit 1; }

lock_file="${JARVIS_BACKUP_LOCK_FILE:-/var/lock/jarvis-backup.lock}"
mkdir -p "$(dirname "$lock_file")" "$state_dir"
chmod 0700 "$state_dir"
umask 077
exec 9>"$lock_file"
flock -n 9 || { echo "another Jarvis backup is already running" >&2; exit 1; }

compose=(docker compose --project-name "$project_name" --env-file "$env_file" -f "$compose_file")
run_id="$(date -u +%Y%m%dT%H%M%SZ)"
started_at="$(date -u +%FT%TZ)"
maintenance_set=0

set_maintenance() {
  local enabled="$1"
  "${compose[@]}" exec -T postgres sh -lc "exec psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Atqc \"UPDATE ops_maintenance_flags SET enabled=${enabled},updated_at=now(),updated_by='backup' WHERE flag='knowledge_writes_paused'\"" >/dev/null
}

finish() {
  local exit_code="$?"
  trap - EXIT
  if [[ "$maintenance_set" == "1" ]]; then
    if ! set_maintenance false; then
      echo "warning: failed to clear knowledge maintenance flag" >&2
      exit_code=1
    fi
  fi
  local status="succeeded"; [[ "$exit_code" == "0" ]] || status="failed"
  local completed_at; completed_at="$(date -u +%FT%TZ)"
  local temporary="$state_dir/last-result.json.tmp"
  printf '{"runId":"%s","status":"%s","startedAt":"%s","completedAt":"%s"}\n' "$run_id" "$status" "$started_at" "$completed_at" >"$temporary"
  chmod 0600 "$temporary"; mv -f "$temporary" "$state_dir/last-result.json"
  exit "$exit_code"
}
trap finish EXIT

maintenance_set=1
set_maintenance true
deadline=$((SECONDS + drain_timeout))
while true; do
  active_jobs="$("${compose[@]}" exec -T postgres sh -lc 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT count(*) FROM jobs WHERE kind IN ('"'"'document_ingest'"'"','"'"'document_embedding'"'"') AND status='"'"'running'"'"'"')"
  [[ "$active_jobs" =~ ^[0-9]+$ ]] || { echo "invalid active job count" >&2; exit 1; }
  [[ "$active_jobs" == "0" ]] && break
  (( SECONDS < deadline )) || { echo "timed out waiting for knowledge jobs" >&2; exit 1; }
  sleep 2
done

document_mount="$(docker volume inspect --format '{{ .Mountpoint }}' "$document_volume")"
[[ -d "$document_mount" ]] || { echo "document volume mountpoint is unavailable" >&2; exit 1; }
base_tags=(--tag jarvis-backup --tag "jarvis-run-${run_id}")

"${compose[@]}" exec -T postgres sh -lc 'exec pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' \
  | restic backup --stdin --stdin-filename postgres.dump "${base_tags[@]}" --tag jarvis-database
tar --create --file - --directory "$document_mount" --numeric-owner . \
  | restic backup --stdin --stdin-filename documents.tar "${base_tags[@]}" --tag jarvis-documents
printf '{"runId":"%s","createdAt":"%s","documentVolume":"%s"}\n' "$run_id" "$(date -u +%FT%TZ)" "$document_volume" \
  | restic backup --stdin --stdin-filename manifest.json "${base_tags[@]}" --tag jarvis-complete
restic forget --prune --tag jarvis-backup --keep-daily "$keep_daily" --keep-weekly "$keep_weekly" --keep-monthly "$keep_monthly"
echo "Jarvis backup ${run_id} completed without stopping the server"
