#!/usr/bin/env bash
set -euo pipefail

# This script only materializes a selected backup into an explicitly named,
# empty directory. It never targets the live database or Docker volume.

target="${JARVIS_RESTORE_TARGET:-}"
run_id="${JARVIS_RESTORE_RUN:-}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; exit 1; }
}

require_command restic
require_command tar
[[ -n "$target" ]] || { echo "JARVIS_RESTORE_TARGET is required" >&2; exit 1; }
[[ -n "$run_id" && "$run_id" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo "JARVIS_RESTORE_RUN must be a backup run ID such as 20260902T120000Z" >&2; exit 1; }
[[ -n "${RESTIC_REPOSITORY:-}" ]] || { echo "RESTIC_REPOSITORY is required" >&2; exit 1; }
[[ -n "${RESTIC_PASSWORD_FILE:-}" && -r "${RESTIC_PASSWORD_FILE}" ]] || { echo "RESTIC_PASSWORD_FILE must name a readable file" >&2; exit 1; }

if [[ -e "$target" ]]; then
  [[ -d "$target" ]] || { echo "restore target must be a directory" >&2; exit 1; }
  [[ -z "$(find "$target" -mindepth 1 -print -quit)" ]] || { echo "restore target must be empty" >&2; exit 1; }
else
  install -d -m 0700 "$target"
fi

run_tag="jarvis-run-${run_id}"
complete_snapshot="$(restic snapshots --json --tag jarvis-complete --tag "$run_tag")"
[[ "$complete_snapshot" != "[]" ]] || { echo "no completed Jarvis backup exists for the requested run ID" >&2; exit 1; }

mkdir -p "$target/documents"
restic dump latest --tag jarvis-database --tag "$run_tag" postgres.dump >"$target/postgres.dump"
restic dump latest --tag jarvis-documents --tag "$run_tag" documents.tar | tar --extract --file - --directory "$target/documents" --numeric-owner
restic dump latest --tag jarvis-complete --tag "$run_tag" manifest.json >"$target/manifest.json"

sha256sum "$target/postgres.dump" >"$target/postgres.dump.sha256"
find "$target/documents" -type f -print0 | sort -z | xargs -0 -r sha256sum >"$target/documents.sha256"
echo "Restore materialized in $target. Review it, then use pg_restore only against an explicitly created empty test database."
