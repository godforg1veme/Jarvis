#!/usr/bin/env python3
"""Host-only socket activation for Docker internal-network port publication.

Resolve the one fixed gateway, then drop all supplementary groups and root
before exec'ing the distribution's transparent TCP proxy. No request data is
parsed here and no configurable command or upstream is accepted.
"""
import ipaddress
import json
import os
import subprocess
import sys
import traceback

CONTAINER = 'jarvis-family-job-manual-1'
NETWORK = 'jarvis-family_job-manual-control'
PROXY = '/usr/lib/systemd/systemd-socket-proxyd'


def target(value):
    assert value['Name'] == '/' + CONTAINER
    assert value['State']['Running']
    assert value['Config']['Labels']['com.docker.compose.service'] == 'job-manual'
    assert value['Config']['Labels']['com.docker.compose.project'] == 'jarvis-family'
    assert value['HostConfig']['ReadonlyRootfs'] is True
    assert value['HostConfig']['PortBindings'] == {
        '8080/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '19123'}]}
    networks = value['NetworkSettings']['Networks']
    assert set(networks) == {NETWORK}
    address = ipaddress.ip_address(networks[NETWORK]['IPAddress'])
    assert address.version == 4 and address.is_private and not address.is_loopback
    return str(address) + ':8080'


def main():
    assert __debug__ and len(sys.argv) == 1 and os.getuid() == 0
    assert os.environ.get('LISTEN_PID') == str(os.getpid())
    assert os.environ.get('LISTEN_FDS') == '1'
    result = subprocess.run(['/usr/bin/docker', 'inspect', CONTAINER],
                            check=True, capture_output=True, timeout=10)
    endpoint = target(json.loads(result.stdout)[0])
    network = json.loads(subprocess.run(
        ['/usr/bin/docker', 'network', 'inspect', NETWORK],
        check=True, capture_output=True, timeout=10).stdout)[0]
    assert network['Internal'] is True
    os.setgroups([])
    os.setgid(65534)
    os.setuid(65534)
    assert os.getuid() == 65534 and os.geteuid() == 65534 and not os.getgroups()
    with open('/proc/self/status') as status:
        capabilities = dict(line.split(':', 1) for line in status if line.startswith(('CapPrm:', 'CapEff:', 'CapAmb:')))
    assert len(capabilities) == 3 and all(int(value.strip(), 16) == 0 for value in capabilities.values())
    os.execve(PROXY, [PROXY, '--exit-idle-time=30s', endpoint], {
        'LISTEN_PID': str(os.getpid()), 'LISTEN_FDS': '1', 'PATH': '/usr/bin:/bin'})


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'code': 'JOB_MANUAL_LOOPBACK_PROXY_FAILED',
                          'kind': type(error).__name__,
                          'line': traceback.extract_tb(error.__traceback__)[-1].lineno}), file=sys.stderr)
        sys.exit(1)
