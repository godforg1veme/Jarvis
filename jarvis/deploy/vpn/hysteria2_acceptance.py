#!/usr/bin/env python3
"""Non-secret host acceptance checks for the Hysteria2 fallback."""

import json
import socket
import subprocess
from pathlib import Path

from jarvis_host_agent.hysteria_vpn_manager import HysteriaVpnManager, hysteria_config, validate_hysteria_state


def run(*args: str) -> str:
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=30).stdout


state = validate_hysteria_state(json.loads(Path('/etc/jarvis-vpn/hysteria2-state.json').read_text(encoding='utf-8')))
manager = HysteriaVpnManager(run=lambda *args, **kwargs: {})
acme_dns = manager._read_acme_dns(state)
dns_name = 'vpn-nl.rilora.ru' if acme_dns is not None else state['serverName']
resolved = {item[4][0] for item in socket.getaddrinfo(dns_name, 443, family=socket.AF_INET, type=socket.SOCK_DGRAM)}
assert state['address'] in resolved, 'DNS mismatch'
assert run('/usr/bin/systemctl', 'is-active', 'hysteria-server.service').strip() == 'active'
actual_config = json.loads(Path('/etc/hysteria/config.yaml').read_text(encoding='utf-8'))
assert actual_config == hysteria_config(state, acme_dns=acme_dns), 'generated config mismatch'
assert f"{state['address']}:{state['port']}" in run('/usr/bin/ss', '-H', '-lun'), 'UDP listener missing'
assert run('/usr/bin/systemctl', 'is-active', 'xray.service').strip() == 'active'
tcp = run('/usr/bin/ss', '-H', '-lnt')
assert ':443 ' in tcp and ':8443 ' in tcp, 'Xray listeners missing'
print('Hysteria2 and Xray host acceptance checks passed')
