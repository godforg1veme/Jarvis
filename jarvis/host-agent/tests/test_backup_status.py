import json
import tempfile
import unittest
from pathlib import Path

from jarvis_host_agent.backup_status import read_backup_status


class BackupStatusTests(unittest.TestCase):
    def test_missing_invalid_and_bounded_results(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'last-result.json'
            self.assertFalse(read_backup_status(path)['data']['available'])
            path.write_text('x' * 4097)
            self.assertEqual(read_backup_status(path)['state'], 'failed')
            path.write_text(json.dumps({'runId': '20260905T010000Z', 'status': 'succeeded',
                'startedAt': '2026-09-05T01:00:00Z', 'completedAt': '2026-09-05T01:01:00Z',
                'password': 'must-not-leave-host'}))
            result = read_backup_status(path)
            self.assertTrue(result['data']['available'])
            self.assertNotIn('password', result['data']['result'])
