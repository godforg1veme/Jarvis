#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('captcha_config', Path(__file__).with_name('verify-job-captcha-config.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture(flag='1'):
    owner = '11111111-1111-4111-8111-111111111111'
    return {'services': {
        'job-browser': {'profiles': ['job-search-de'], 'networks': {'job-browser-rpc': {}},
                        'user': 'pwuser', 'cap_drop': ['ALL'], 'cap_add': ['SYS_CHROOT'],
                        'security_opt': ['no-new-privileges:true', 'seccomp=./fixture.json'],
                        'volumes': [{'target': '/home/pwuser/profile', 'source': 'job-browser-profile'}],
                        'environment': {'JARVIS_HH_CAPTCHA_TELEGRAM': flag, 'JARVIS_JOB_CAPTCHA_TOKEN': 'c' * 40,
                                        'JARVIS_JOB_BROWSER_OWNER_ID': owner, 'JARVIS_JOB_BROWSER_TOKEN': 'r' * 40,
                                        'JARVIS_JOB_BROWSER_APPLY_TOKEN': 'a' * 40}},
        'server': {'networks': {'job-browser-rpc': {}}, 'environment': {
            'JARVIS_HH_CAPTCHA_TELEGRAM': flag, 'JARVIS_JOB_CAPTCHA_TOKEN': 'c' * 40, 'JARVIS_JOB_BROWSER_OWNER_ID': owner}},
        'job-collector': {'networks': {'job-browser-rpc': {}}, 'environment': {'JARVIS_HH_CAPTCHA_TELEGRAM': flag}}},
        'networks': {'job-browser-rpc': {}}, 'volumes': {'job-browser-profile': {'external': True}}}


class PolicyTests(unittest.TestCase):
    def test_retired_runtime_files_and_settings_are_removed(self):
        root = Path(__file__).resolve().parents[2]
        for relative in [
            'job-manual/package.json', 'job-manual/Dockerfile',
            'deploy/job-browser/jarvis-job-manual-proxy.socket',
            'deploy/job-browser/jarvis-job-manual-proxy.service',
            'deploy/scripts/manual-loopback-proxy.py',
            'deploy/scripts/verify-job-manual-config.py',
            'deploy/scripts/test-job-manual-config.py',
            'deploy/scripts/test-manual-loopback-proxy.py',
        ]:
            self.assertFalse((root / relative).exists(), relative)
        example = (root / 'deploy/env.example').read_text(encoding='utf-8')
        self.assertNotIn('JARVIS_JOB_MANUAL_', example)
        self.assertIn('JARVIS_HH_CAPTCHA_TELEGRAM=0', example)
        self.assertIn('JARVIS_JOB_CAPTCHA_TOKEN=', example)

    def test_enabled_and_disabled(self):
        self.assertTrue(module.verify(fixture()))
        config = fixture('0')
        for name in ['server', 'job-browser']:
            config['services'][name]['environment']['JARVIS_JOB_CAPTCHA_TOKEN'] = ''
        self.assertTrue(module.verify(config))

    def test_old_surface_or_public_access_is_rejected(self):
        changes = [
            lambda c: c['services'].update({'job-manual': {}}),
            lambda c: c['networks'].update({'job-manual-control': {}}),
            lambda c: c['services']['job-browser']['profiles'].append('job-manual-de'),
            lambda c: c['services']['server']['environment'].update({'JARVIS_JOB_MANUAL_ACCESS_URL': ''}),
            lambda c: c['services']['job-browser'].update(ports=[{'target': 8082, 'published': '8082'}]),
            lambda c: c['services']['server'].update(ports=[{'target': 8082, 'published': '8082'}]),
            lambda c: c['services']['job-browser'].update(privileged=True),
            lambda c: c['services']['job-browser'].update(network_mode='host'),
            lambda c: c['services']['job-browser']['volumes'].append({'source': '/var/run/docker.sock'}),
            lambda c: c['volumes']['job-browser-profile'].update(external=False),
        ]
        for change in changes:
            config = fixture()
            change(config)
            with self.assertRaises(ValueError):
                module.verify(config)

    def test_credential_distribution_and_owner(self):
        for token in ['', 'short', 'r' * 40, 'a' * 40, 'x' * 257, ' ' * 40]:
            config = fixture()
            for name in ['server', 'job-browser']:
                config['services'][name]['environment']['JARVIS_JOB_CAPTCHA_TOKEN'] = token
            with self.assertRaises(ValueError):
                module.verify(config)
        config = fixture()
        config['services']['job-collector']['environment']['JARVIS_JOB_CAPTCHA_TOKEN'] = 'c' * 40
        with self.assertRaises(ValueError):
            module.verify(config)
        config = fixture()
        config['services']['server']['environment']['JARVIS_JOB_CAPTCHA_TOKEN'] = 'd' * 40
        with self.assertRaises(ValueError):
            module.verify(config)
        config = fixture()
        config['services']['server']['environment']['JARVIS_JOB_BROWSER_OWNER_ID'] = 'foreign'
        with self.assertRaises(ValueError):
            module.verify(config)
        for name in ['server', 'job-collector']:
            config = fixture()
            config['services'][name]['environment']['JARVIS_HH_CAPTCHA_TELEGRAM'] = '0'
            with self.assertRaises(ValueError):
                module.verify(config)
        config = fixture('true')
        with self.assertRaises(ValueError):
            module.verify(config)


if __name__ == '__main__':
    unittest.main()
