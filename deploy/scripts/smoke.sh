#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-}"
if [[ ! "${base_url}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
  echo "usage: smoke.sh https://jarvis.example.com" >&2
  exit 1
fi

curl --fail --silent --show-error --max-time 10 "${base_url}/health/live" >/dev/null
curl --fail --silent --show-error --max-time 10 "${base_url}/health/ready" >/dev/null

echo "smoke OK"
