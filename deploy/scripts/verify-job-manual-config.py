#!/usr/bin/env python3
"""Validate normalized `docker compose config --format json` without printing secrets."""
import json
import re
import sys
from urllib.parse import urlsplit


def verify(config):
    services = config['services']
    gateway, browser = services['job-manual'], services['job-browser']
    assert gateway['profiles'] == ['job-manual-de']
    assert browser['profiles'] == ['job-search-de']
    assert set(gateway['networks']) == {'job-manual-control'}
    assert config['networks']['job-manual-control']['internal'] is True
    sharing = {name for name, service in services.items()
               if 'job-manual-control' in service.get('networks', {})}
    assert sharing == {'job-browser', 'job-manual'}
    ports = gateway.get('ports', [])
    assert len(ports) == 1
    assert str(ports[0]['published']) == '19123' and ports[0]['target'] == 8080
    assert ports[0]['host_ip'] == '127.0.0.1' and ports[0].get('protocol', 'tcp') == 'tcp'
    assert not browser.get('ports') and not gateway.get('volumes')
    assert gateway['read_only'] is True and gateway['user'] == '1000:1000'
    assert 'ALL' in gateway['cap_drop'] and not gateway.get('cap_add')
    assert 'no-new-privileges:true' in gateway['security_opt']
    for service in (gateway, browser):
        assert not service.get('privileged') and service.get('network_mode') != 'host'
        for volume in service.get('volumes', []):
            assert 'docker.sock' not in str(volume)
    profile = [v for v in browser['volumes'] if v['target'] == '/home/pwuser/profile']
    assert len(profile) == 1 and profile[0]['source'] == 'job-browser-profile'
    assert config['volumes']['job-browser-profile']['external'] is True
    env = gateway['environment']
    assert set(env) == {'JARVIS_JOB_MANUAL_ORIGIN', 'JARVIS_JOB_MANUAL_OWNER_LOGIN',
                        'JARVIS_JOB_MANUAL_OWNER_ID', 'JARVIS_JOB_MANUAL_TOKEN'}
    for name, service in services.items():
        if name not in {'job-manual', 'job-browser'}:
            assert 'JARVIS_JOB_MANUAL_TOKEN' not in service.get('environment', {})
    browser_env = browser['environment']
    assert browser_env.get('JARVIS_JOB_MANUAL_ENABLED', '0') in {'0', '1'}
    if browser_env.get('JARVIS_JOB_MANUAL_ENABLED') == '1':
        token = env.get('JARVIS_JOB_MANUAL_TOKEN', '')
        assert 32 <= len(token) <= 256 and not re.search(r'[\x00-\x20\x7f]', token)
        assert token == browser_env.get('JARVIS_JOB_MANUAL_TOKEN')
        assert token not in [browser_env.get('JARVIS_JOB_BROWSER_TOKEN'),
                             browser_env.get('JARVIS_JOB_BROWSER_APPLY_TOKEN')]
        assert env.get('JARVIS_JOB_MANUAL_OWNER_ID') == browser_env.get('JARVIS_JOB_BROWSER_OWNER_ID')
        assert env.get('JARVIS_JOB_MANUAL_OWNER_ID') and env.get('JARVIS_JOB_MANUAL_OWNER_LOGIN')
        assert re.fullmatch(r'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}', env['JARVIS_JOB_MANUAL_OWNER_ID'])
        assert len(env['JARVIS_JOB_MANUAL_OWNER_LOGIN']) <= 254
        assert not re.search(r'[\x00-\x20\x7f]', env['JARVIS_JOB_MANUAL_OWNER_LOGIN'])
        origin = urlsplit(env.get('JARVIS_JOB_MANUAL_ORIGIN', ''))
        assert origin.scheme == 'https' and origin.hostname and origin.hostname.endswith('.ts.net')
        assert not origin.port and not origin.path and not origin.query and not origin.fragment and not origin.username
        for service in ['server', 'job-collector']:
            assert services[service]['environment'].get('JARVIS_JOB_MANUAL_ACCESS_URL') == env['JARVIS_JOB_MANUAL_ORIGIN'] + '/hh/'
    return True


if __name__ == '__main__':
    try:
        if not __debug__:
            raise ValueError('configuration checks require assertions')
        # Bounded before buffering; normalized configuration can include private env.
        raw = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
        assert len(raw) <= 2 * 1024 * 1024
        verify(json.loads(raw))
    except (AssertionError, KeyError, TypeError, ValueError):
        print('JOB_MANUAL_CONFIG_REJECTED')
        sys.exit(1)
    print('JOB_MANUAL_CONFIG_OK')
