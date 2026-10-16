import copy
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('proxy', pathlib.Path(__file__).with_name('manual-loopback-proxy.py'))
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)


class ProxyBoundaryTest(unittest.TestCase):
    def fixture(self):
        return {'Name': '/' + proxy.CONTAINER, 'State': {'Running': True},
                'Config': {'Labels': {'com.docker.compose.service': 'job-manual', 'com.docker.compose.project': 'jarvis-family'}},
                'HostConfig': {'ReadonlyRootfs': True, 'PortBindings': {'8080/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '19123'}]}},
                'NetworkSettings': {'Networks': {proxy.NETWORK: {'IPAddress': '172.30.0.2'}}}}

    def test_fixed_gateway(self):
        self.assertEqual(proxy.target(self.fixture()), '172.30.0.2:8080')

    def test_foreign_container_or_network_denied(self):
        for field in ['name', 'network', 'public', 'stopped', 'writable']:
            value = copy.deepcopy(self.fixture())
            if field == 'name': value['Name'] = '/other'
            if field == 'network': value['NetworkSettings']['Networks']['other'] = {'IPAddress': '172.30.0.3'}
            if field == 'public': value['HostConfig']['PortBindings']['8080/tcp'][0]['HostIp'] = '0.0.0.0'
            if field == 'stopped': value['State']['Running'] = False
            if field == 'writable': value['HostConfig']['ReadonlyRootfs'] = False
            with self.subTest(field=field), self.assertRaises(AssertionError):
                proxy.target(value)

    def test_invalid_destination_denied(self):
        for address in ['127.0.0.1', '8.8.8.8', '::1', 'not-an-ip']:
            value = self.fixture()
            value['NetworkSettings']['Networks'][proxy.NETWORK]['IPAddress'] = address
            with self.subTest(address=address), self.assertRaises((AssertionError, ValueError)):
                proxy.target(value)


if __name__ == '__main__':
    unittest.main()
