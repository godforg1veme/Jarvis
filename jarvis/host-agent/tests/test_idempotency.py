import tempfile
import unittest
from pathlib import Path

from jarvis_host_agent.idempotency import IdempotencyJournal


class IdempotencyTests(unittest.TestCase):
    def test_claim_survives_restart_without_repeating_action(self):
        with tempfile.TemporaryDirectory() as directory:
            request = {'requestId': '2d2f9f55-6859-49d9-b54d-9d42d4251d52', 'operation': 'service.restart'}
            pending = {'result': {'state': 'unknown'}}
            journal = IdempotencyJournal(Path(directory))
            self.assertTrue(journal.claim(request, pending))
            restarted = IdempotencyJournal(Path(directory))
            self.assertFalse(restarted.claim(request, pending))
            self.assertEqual(restarted.get(request), pending)
            result = {'result': {'state': 'succeeded'}}
            restarted.complete(request, result)
            self.assertEqual(journal.get(request), result)

    def test_reads_a_completed_response_by_original_request_id(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = IdempotencyJournal(Path(directory))
            request = {
                "version": 1,
                "requestId": "2d2f9f55-6859-49d9-b54d-9d42d4251d52",
                "operation": "service.restart",
                "arguments": {"serviceId": "jarvis-server"},
                "sentAt": "2026-09-04T10:00:00.000Z",
            }
            response = {"result": {"state": "succeeded"}}
            journal.put(request, response)
            self.assertEqual(journal.get_response(request["requestId"]), response)
            self.assertIsNone(journal.get_response("11111111-1111-4111-8111-111111111111"))


if __name__ == "__main__":
    unittest.main()
