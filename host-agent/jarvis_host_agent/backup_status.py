"""Read only the bounded public backup result, never repository credentials."""

import json
import re
from datetime import datetime
from pathlib import Path

RESULT_PATH = Path('/var/lib/jarvis-backup/last-result.json')


def read_backup_status(path=None):
    try:
        with (path or RESULT_PATH).open('rb') as stream:
            raw = stream.read(4097)
        if len(raw) > 4096:
            raise ValueError('oversized result')
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError('invalid result')
        run_id = value.get('runId')
        if not isinstance(run_id, str) or not re.fullmatch(r'\d{8}T\d{6}Z', run_id):
            raise ValueError('invalid run')
        if value.get('status') not in {'succeeded', 'failed'}:
            raise ValueError('invalid state')
        for key in ('startedAt', 'completedAt'):
            timestamp = value.get(key)
            if not isinstance(timestamp, str) or len(timestamp) > 40 or datetime.fromisoformat(timestamp.replace('Z', '+00:00')).tzinfo is None:
                raise ValueError('invalid timestamp')
        result = {key: value[key] for key in ('runId', 'status', 'startedAt', 'completedAt')}
        return {'state': 'succeeded', 'data': {'available': True, 'result': result}}
    except FileNotFoundError:
        return {'state': 'succeeded', 'data': {'available': False}}
    except (OSError, ValueError, TypeError):
        return {'state': 'failed', 'errorCode': 'BACKUP_STATUS_UNAVAILABLE'}
