"""Exercise the real Caddy route table against a private HTTP fixture.

Usage: python test-subscription-direct.py --caddy /path/to/caddy
The fixture removes TLS solely for loopback HTTP assertions. Production TLS
configuration is separately validated by the real Caddy adapter.
"""
import argparse
import base64
import http.client
import http.server
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import unittest


parser = argparse.ArgumentParser()
parser.add_argument('--caddy', required=True)
args, unittest_args = parser.parse_known_args()
SOURCE = Path(__file__).resolve().parents[1] / 'Caddyfile.subscriptions'
TOKEN = 'sub_' + 'a' * 64  # Synthetic; never a production credential.
REVOKED = 'sub_' + 'b' * 64
CALLS = []


class Upstream(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        CALLS.append((self.path, dict(self.headers)))
        active = self.path.split('?')[0] == '/sub/' + TOKEN
        payload = base64.b64encode(b'vless://fixture@fixture.invalid:8443') if active else b'not found'
        self.send_response(200 if active else 404)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'public, max-age=3600')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(payload)

    do_HEAD = do_GET

    def log_message(self, *_):
        pass


def rewrite_upstream(value, address):
    if isinstance(value, dict):
        if value.get('dial') == 'server:3210':
            value['dial'] = address
        for child in value.values():
            rewrite_upstream(child, address)
    elif isinstance(value, list):
        for child in value:
            rewrite_upstream(child, address)


class GatewayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='jarvis-subscription-fixture-')
        cls.upstream = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        threading.Thread(target=cls.upstream.serve_forever, daemon=True).start()
        env = dict(os.environ, JARVIS_SUBSCRIPTION_DOMAIN='subscriptions.example.test')
        result = subprocess.run([args.caddy, 'adapt', '--config', str(SOURCE),
                                 '--adapter', 'caddyfile'], env=env, capture_output=True, text=True, check=True)
        config = json.loads(result.stdout)
        server = config['apps']['http']['servers']['srv0']
        # Assert production listener and issuer before replacing TLS in the fixture.
        assert server['listen'] == [':9443']
        assert config['apps']['tls']['automation']['policies'][0]['issuers'][0]['challenges']['tls-alpn']['disabled']
        assert config['admin']['disabled']
        assert config['logging']['logs']['default']['writer']['output'] == 'discard'
        with socket.socket() as reserved:
            reserved.bind(('127.0.0.1', 0))
            cls.port = reserved.getsockname()[1]
        server['listen'] = ['127.0.0.1:' + str(cls.port)]
        server.pop('tls_connection_policies', None)
        server['automatic_https'] = {'disable': True}
        config['apps'].pop('tls', None)
        rewrite_upstream(config, '127.0.0.1:' + str(cls.upstream.server_port))
        fixture = Path(cls.temp.name) / 'fixture.json'
        fixture.write_text(json.dumps(config), encoding='utf-8')
        cls.proc = subprocess.Popen([args.caddy, 'run', '--config', str(fixture)],
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        for _ in range(100):
            if cls.proc.poll() is not None:
                raise RuntimeError('fixture process exited')
            try:
                with socket.create_connection(('127.0.0.1', cls.port), timeout=0.1):
                    return
            except OSError:
                time.sleep(0.05)
        raise RuntimeError('fixture did not become ready')

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        stdout, stderr = cls.proc.communicate(timeout=10)
        cls.upstream.shutdown()
        cls.upstream.server_close()
        cls.temp.cleanup()
        # Error and access logs must not disclose even synthetic URL credentials.
        assert TOKEN.encode() not in stdout + stderr
        assert REVOKED.encode() not in stdout + stderr

    def request(self, path, method='GET', **headers):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=3)
        try:
            connection.request(method, path, headers={'Host': 'subscriptions.example.test', **headers})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_subscription_forwarded_without_browser_credentials(self):
        status, headers, body = self.request('/sub/' + TOKEN + '?format=sing-box',
                                             Cookie='session=fixture', Authorization='Bearer fixture',
                                             Forwarded='for=192.0.2.1')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Cache-Control'], 'private, no-store')
        self.assertEqual(base64.b64decode(body), b'vless://fixture@fixture.invalid:8443')
        path, received = CALLS[-1]
        self.assertTrue(path.endswith('?format=sing-box'))
        self.assertFalse({'cookie', 'authorization', 'forwarded'} & {key.lower() for key in received})

    def test_revocation_remains_upstream_authoritative(self):
        self.assertEqual(self.request('/sub/' + REVOKED)[0], 404)
        self.assertEqual(CALLS[-1][0], '/sub/' + REVOKED)

    def test_head_preserves_status_without_body(self):
        status, headers, body = self.request('/sub/' + TOKEN, method='HEAD')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Cache-Control'], 'private, no-store')
        self.assertEqual(body, b'')

    def test_wrong_host_is_not_forwarded(self):
        before = len(CALLS)
        # Caddy's unmatched virtual host returns an empty response; it must
        # never expose the profile or reach the upstream.
        self.assertEqual(self.request('/sub/' + TOKEN, Host='other.example.test')[2], b'')
        self.assertEqual(len(CALLS), before)

    def test_private_and_malformed_routes_never_reach_backend(self):
        before = len(CALLS)
        for path in ['/mini/', '/api/users', '/health/ready', '/happ-sub/' + TOKEN,
                     '/sub/short', '/sub/' + TOKEN + '/extra', '/sub/../mini/',
                     '/sub/%2e%2e/mini/', '/sub/' + TOKEN + '%2fextra']:
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)
        self.assertEqual(len(CALLS), before)

    def test_post_is_not_forwarded(self):
        before = len(CALLS)
        self.assertEqual(self.request('/sub/' + TOKEN, method='POST')[0], 404)
        self.assertEqual(len(CALLS), before)


if __name__ == '__main__':
    unittest.main(argv=[__file__, *unittest_args])
