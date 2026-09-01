#!/usr/bin/env bash
set -euo pipefail

required_commands=(docker curl openssl)
for command_name in "${required_commands[@]}"; do
  command -v "${command_name}" >/dev/null 2>&1 || {
    echo "missing required command: ${command_name}" >&2
    exit 1
  }
done

docker compose version >/dev/null

memory_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
if [[ -z "${memory_kb}" ]]; then
  echo "could not determine available RAM" >&2
  exit 1
fi
if [[ "${memory_kb}" -lt 15000000 && "${JARVIS_ALLOW_LOW_MEMORY:-0}" != "1" ]]; then
  echo "at least 15 GB RAM must be visible on DE-4" >&2
  echo "temporary control-plane-only launch: JARVIS_ALLOW_LOW_MEMORY=1 bash $0" >&2
  exit 1
fi
if [[ "${memory_kb}" -lt 15000000 ]]; then
  echo "warning: low-memory override enabled; do not start local ASR or LLM workers" >&2
fi

available_kb="$(df -Pk . | awk 'NR==2 {print $4}')"
if [[ -z "${available_kb}" || "${available_kb}" -lt 20000000 ]]; then
  echo "at least 20 GB free disk space is required before deployment" >&2
  exit 1
fi

echo "preflight OK"
