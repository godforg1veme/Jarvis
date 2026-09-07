import json
import unittest
from jarvis_host_agent.server import response_for
from jarvis_host_agent.protocol import MAX_ENVELOPE_BYTES


class ServerTests(unittest.TestCase):
    def test_json_escaping_cannot_expand_output_beyond_wire_limit(self):
        request = {'requestId': '2d2f9f55-6859-49d9-b54d-9d42d4251d52', 'operation': 'service.logs.read'}
        response = response_for(request, {'state': 'succeeded', 'data': {'output': '\x00' * 32000}})
        self.assertLess(len(json.dumps(response).encode()), MAX_ENVELOPE_BYTES)
        self.assertEqual(response['result']['state'], 'unknown')
