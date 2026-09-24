import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from jarvis_host_agent.idempotency import IdempotencyJournal, request_mac
from jarvis_host_agent.server import SECRET_OUTPUT_MUTATIONS, handle, journal_safe_result, response_for
from jarvis_host_agent.protocol import MAX_ENVELOPE_BYTES


class ServerTests(unittest.TestCase):
    def test_json_escaping_cannot_expand_output_beyond_wire_limit(self):
        request = {'requestId': '2d2f9f55-6859-49d9-b54d-9d42d4251d52', 'operation': 'service.logs.read'}
        response = response_for(request, {'state': 'succeeded', 'data': {'output': '\x00' * 32000}})
        self.assertLess(len(json.dumps(response).encode()), MAX_ENVELOPE_BYTES)
        self.assertEqual(response['result']['state'], 'unknown')

    def test_vpn_export_uri_is_not_durably_journaled(self):
        request = {
            'version': 1,
            'requestId': '2d2f9f55-6859-49d9-b54d-9d42d4251d52',
            'operation': 'vpn.client.export',
            'arguments': {'clientId': 'vpn-123456789abc'},
            'sentAt': '2026-09-16T12:00:00.000Z',
        }
        secret = b'secret-key-at-least-32-chars-long!'
        wrapper = {'auth': request_mac(secret, request), 'request': request}

        class Writer:
            def __init__(self):
                self.written = b''

            def write(self, value):
                self.written += value

            async def drain(self):
                return None

            def close(self):
                return None

            async def wait_closed(self):
                return None

        async def run_case(journal):
            reader = asyncio.StreamReader()
            reader.feed_data(json.dumps(wrapper).encode('utf-8') + b'\n')
            reader.feed_eof()
            writer = Writer()
            with patch('jarvis_host_agent.server.execute', return_value={
                'state': 'succeeded', 'data': {'shareUri': 'vless://synthetic-secret'},
            }):
                await handle(reader, writer, object(), secret, journal)
            return writer.written

        with TemporaryDirectory() as directory:
            journal = IdempotencyJournal(Path(directory))
            payload = asyncio.run(run_case(journal))
            self.assertIn(b'vless://synthetic-secret', payload)
            self.assertIsNone(journal.get_response(request['requestId']))
            self.assertNotIn(b'vless://synthetic-secret', (Path(directory) / 'requests.sqlite3').read_bytes())

    def test_vpn_issue_and_rotate_journal_only_public_result_metadata(self):
        self.assertIn('vpn.client.rotate', SECRET_OUTPUT_MUTATIONS)
        raw = {
            'state': 'succeeded',
            'data': {
                'client': {'id': 'vpn-123456789abc', 'label': 'Probe', 'createdAt': '2026-09-16T12:00:00Z'},
                'shareUri': 'vless://synthetic-secret',
            },
        }
        public = journal_safe_result(raw)
        self.assertEqual(public['data']['client']['id'], 'vpn-123456789abc')
        self.assertNotIn('shareUri', public['data'])
        self.assertNotIn('synthetic-secret', json.dumps(public))
