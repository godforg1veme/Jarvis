#!/usr/bin/env python3
"""Check normalized Compose configuration; never print secret-bearing input."""
import json
import re
import sys


def require(condition):
    if not condition:
        raise ValueError('JOB_CAPTCHA_CONFIG_REJECTED')


def verify(config):
    services = config['services']
    browser, server, collector = (services[name] for name in ('job-browser', 'server', 'job-collector'))
    require('job-manual' not in services and 'job-manual-control' not in config.get('networks', {}))
    for name, service in services.items():
        require('job-manual-de' not in service.get('profiles', []))
        require('job-manual-control' not in service.get('networks', {}))
        env = service.get('environment', {})
        require(not any(key.startswith('JARVIS_JOB_MANUAL_') for key in env))
        if name not in {'server', 'job-browser'}:
            require('JARVIS_JOB_CAPTCHA_TOKEN' not in env)
    require(browser['profiles'] == ['job-search-de'])
    require(set(browser['networks']) == {'job-browser-rpc'})
    require({'server', 'job-browser', 'job-collector'} <= {
        name for name, service in services.items() if 'job-browser-rpc' in service.get('networks', {})})
    require(not browser.get('ports') and not server.get('ports') and not collector.get('ports'))
    require(not browser.get('privileged') and browser.get('network_mode') != 'host')
    require(browser.get('user') == 'pwuser')
    require('ALL' in browser.get('cap_drop', []) and browser.get('cap_add') == ['SYS_CHROOT'])
    require('no-new-privileges:true' in browser.get('security_opt', []))
    require(any(str(value).startswith('seccomp=') for value in browser.get('security_opt', [])))
    require(not any('docker.sock' in str(volume) for volume in browser.get('volumes', [])))
    profile = [v for v in browser['volumes'] if v['target'] == '/home/pwuser/profile']
    require(len(profile) == 1 and profile[0]['source'] == 'job-browser-profile')
    require(config['volumes']['job-browser-profile']['external'] is True)
    browser_env, server_env = browser['environment'], server['environment']
    require('JARVIS_JOB_CAPTCHA_TOKEN' in browser_env and 'JARVIS_JOB_CAPTCHA_TOKEN' in server_env)
    require(browser_env['JARVIS_JOB_CAPTCHA_TOKEN'] == server_env['JARVIS_JOB_CAPTCHA_TOKEN'])
    flag = browser_env.get('JARVIS_HH_CAPTCHA_TELEGRAM', '0')
    require(flag in {'0', '1'})
    require(server_env.get('JARVIS_HH_CAPTCHA_TELEGRAM', '0') == flag)
    require(collector['environment'].get('JARVIS_HH_CAPTCHA_TELEGRAM', '0') == flag)
    automatic = browser_env.get('JARVIS_HH_CAPTCHA_AUTOMATIC', '0')
    require(automatic in {'0', '1'})
    require(server_env.get('JARVIS_HH_CAPTCHA_AUTOMATIC', '0') == automatic)
    require(automatic != '1' or flag == '1')
    token = browser_env['JARVIS_JOB_CAPTCHA_TOKEN']
    if flag == '1' or token:
        require(isinstance(token, str) and 32 <= len(token) <= 256)
        require(not re.search(r'[\x00-\x20\x7f]', token))
        require(token not in [browser_env.get('JARVIS_JOB_BROWSER_TOKEN'),
                             browser_env.get('JARVIS_JOB_BROWSER_APPLY_TOKEN')])
    if flag == '1':
        owner = browser_env.get('JARVIS_JOB_BROWSER_OWNER_ID', '')
        require(re.fullmatch(r'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}', owner) is not None)
        require(owner == server_env.get('JARVIS_JOB_BROWSER_OWNER_ID'))
    return True


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
        require(len(raw) <= 2 * 1024 * 1024)
        verify(json.loads(raw))
    except (KeyError, TypeError, ValueError, AttributeError):
        print('JOB_CAPTCHA_CONFIG_REJECTED')
        sys.exit(1)
    print('JOB_CAPTCHA_CONFIG_OK')
