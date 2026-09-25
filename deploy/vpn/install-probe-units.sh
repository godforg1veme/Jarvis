#!/usr/bin/env bash
set -euo pipefail

app_root="${1:-/home/deploy/apps/jarvis}"
source_dir="${app_root}/deploy/vpn"
service_source="${source_dir}/jarvis-vpn-probe@.service"
timer_source="${source_dir}/jarvis-vpn-probe@.timer"

python3 "${app_root}/deploy/scripts/verify-source-checkout.py" source "${app_root}"

test -f "${service_source}"
test -f "${timer_source}"

install -o root -g root -m 0644 "${service_source}" /etc/systemd/system/jarvis-vpn-probe@.service
install -o root -g root -m 0644 "${timer_source}" /etc/systemd/system/jarvis-vpn-probe@.timer
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/jarvis-vpn-probe@.service /etc/systemd/system/jarvis-vpn-probe@.timer

# Unit installation never starts or enables monitoring. Activation is a closed,
# owner-confirmed Host Agent operation after all four one-shot checks succeed.
