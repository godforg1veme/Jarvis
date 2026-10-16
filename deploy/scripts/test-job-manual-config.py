#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('manual_config', Path(__file__).with_name('verify-job-manual-config.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture():
    env = {'JARVIS_JOB_MANUAL_ORIGIN': 'https://fixture.example.ts.net',
           'JARVIS_JOB_MANUAL_OWNER_LOGIN': 'owner@example.invalid',
           'JARVIS_JOB_MANUAL_OWNER_ID': '11111111-1111-4111-8111-111111111111', 'JARVIS_JOB_MANUAL_TOKEN': 'm' * 40}
    return {'services': {
        'job-manual': {'profiles': ['job-manual-de'], 'networks': {'job-manual-control': {}},
                       'ports': [{'published': '19123', 'target': 8080, 'host_ip': '127.0.0.1'}],
                       'read_only': True, 'user': '1000:1000', 'cap_drop': ['ALL'],
                       'security_opt': ['no-new-privileges:true'], 'environment': env},
        'job-browser': {'profiles': ['job-search-de'], 'networks': {'job-manual-control': {}, 'job-browser-rpc': {}},
                        'volumes': [{'target': '/home/pwuser/profile', 'source': 'job-browser-profile'}],
                        'environment': {'JARVIS_JOB_MANUAL_ENABLED': '1', 'JARVIS_JOB_MANUAL_TOKEN': 'm' * 40,
                                        'JARVIS_JOB_BROWSER_OWNER_ID': '11111111-1111-4111-8111-111111111111', 'JARVIS_JOB_BROWSER_TOKEN': 'r' * 40,
                                        'JARVIS_JOB_BROWSER_APPLY_TOKEN': 'a' * 40}},
        'server': {'networks': {'job-browser-rpc': {}}, 'environment': {'JARVIS_JOB_MANUAL_ACCESS_URL': 'https://fixture.example.ts.net/hh/'}},
        'job-collector': {'networks': {'job-browser-rpc': {}}, 'environment': {'JARVIS_JOB_MANUAL_ACCESS_URL': 'https://fixture.example.ts.net/hh/'}}},
        'networks': {'job-manual-control': {'internal': True}},
        'volumes': {'job-browser-profile': {'external': True}}}


class PolicyTests(unittest.TestCase):
    def test_private_configuration(self):
        self.assertTrue(module.verify(fixture()))

    def test_rejects_privilege_and_network_regressions(self):
        changes = [
            lambda c: c['services']['job-manual']['ports'][0].update(host_ip='0.0.0.0'),
            lambda c: c['services']['job-browser'].update(ports=[{'published': '5900', 'target': 5900}]),
            lambda c: c['services']['job-manual'].update(volumes=[{'source': '/var/run/docker.sock'}]),
            lambda c: c['services']['server']['networks'].update({'job-manual-control': {}}),
            lambda c: c['networks']['job-manual-control'].update(internal=False),
            lambda c: c['services']['job-manual'].update(privileged=True),
            lambda c: c['services']['job-manual'].update(network_mode='host'),
            lambda c: c['services']['job-browser']['profiles'].append('job-manual-de'),
            lambda c: c['volumes']['job-browser-profile'].update(external=False),
            lambda c: c['services']['job-collector']['environment'].update(JARVIS_JOB_MANUAL_ACCESS_URL=''),
        ]
        for change in changes:
            config = fixture()
            change(config)
            with self.assertRaises(AssertionError):
                module.verify(config)

    def test_rejects_shared_missing_or_mismatched_identity_and_credentials(self):
        for key, value in [('JARVIS_JOB_MANUAL_TOKEN', ''), ('JARVIS_JOB_MANUAL_TOKEN', 'r' * 40),
                           ('JARVIS_JOB_MANUAL_OWNER_ID', 'foreign'), ('JARVIS_JOB_MANUAL_OWNER_LOGIN', ''),
                           ('JARVIS_JOB_MANUAL_ORIGIN', 'http://fixture.example.ts.net'),
                           ('JARVIS_JOB_MANUAL_ORIGIN', 'https://fixture.example.ts.net/hh/')]:
            config = fixture()
            config['services']['job-manual']['environment'][key] = value
            if key == 'JARVIS_JOB_MANUAL_TOKEN':
                config['services']['job-browser']['environment'][key] = value
            with self.assertRaises(AssertionError):
                module.verify(config)
        config = fixture()
        config['services']['server']['environment'] = {'JARVIS_JOB_MANUAL_TOKEN': 'm' * 40}
        with self.assertRaises(AssertionError):
            module.verify(config)


if __name__ == '__main__':
    unittest.main()
