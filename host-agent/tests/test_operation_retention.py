"""Exercise authenticated handlers and a disposable journal; never run actions."""

import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

from jarvis_host_agent.idempotency import IdempotencyJournal, request_mac
from jarvis_host_agent.operations import (
    CHANGING_OPERATIONS, EPHEMERAL_SECRET_OPERATIONS, READ_ONLY_OPERATIONS,
    SECRET_OUTPUT_MUTATIONS,
)
from jarvis_host_agent.protocol import OPERATIONS, ProtocolError
from jarvis_host_agent.server import handle, journal_safe_result, response_for


def request_for(operation, arguments=None):
    if arguments is None:
        if operation.startswith('service.'):
            arguments = {'serviceId': 'jarvis-server'}
        elif operation.endswith('.issue'):
            arguments = {'label': 'Fixture'}
        elif operation.endswith(('.revoke', '.rotate', '.export')):
            arguments = {'clientId': 'vpn-123456789abc'}
        elif operation == 'vpn.external_probe.credential.install':
            arguments = {'targetNode': 'nl', 'protocol': 'vless', 'credential': 'fixture-marker'}
        elif operation.startswith('vpn.external_probe.'):
            arguments = {'targetNode': 'nl'}
        else:
            arguments = {}
    return {'version': 1, 'requestId': str(uuid.uuid4()), 'operation': operation,
            'arguments': arguments, 'sentAt': '2026-09-16T12:00:00.000Z'}


class Writer:
    def __init__(self):
        self.written = b''

    def write(self, value):
        self.written += value

    async def drain(self):
        pass

    def close(self):
        pass

    async def wait_closed(self):
        pass


async def send(request, journal):
    authenticator = b'fixture-authenticator-not-a-real-key'
    reader = asyncio.StreamReader()
    reader.feed_data(json.dumps({'auth': request_mac(authenticator, request),
                                 'request': request}).encode() + b'\n')
    reader.feed_eof()
    writer = Writer()
    await handle(reader, writer, object(), authenticator, journal)
    return json.loads(writer.written)


def age_and_clean(journal):
    with journal._connect() as connection:
        connection.execute("UPDATE requests SET created_at='2000-01-01T00:00:00.000Z'")
    # Use the actual read handler; this is the production housekeeping trigger.
    with patch('jarvis_host_agent.server.execute', return_value={'state': 'succeeded'}):
        asyncio.run(send(request_for('host.snapshot'), journal))


class OperationRetentionTests(unittest.TestCase):
    def test_closed_operation_classification_is_complete_and_disjoint(self):
        self.assertEqual(OPERATIONS, CHANGING_OPERATIONS | READ_ONLY_OPERATIONS | EPHEMERAL_SECRET_OPERATIONS)
        self.assertFalse(CHANGING_OPERATIONS & READ_ONLY_OPERATIONS)
        self.assertFalse(CHANGING_OPERATIONS & EPHEMERAL_SECRET_OPERATIONS)
        self.assertFalse(READ_ONLY_OPERATIONS & EPHEMERAL_SECRET_OPERATIONS)
        self.assertTrue(SECRET_OUTPUT_MUTATIONS <= CHANGING_OPERATIONS)

    def test_every_mutation_retains_original_result_and_never_reexecutes(self):
        for operation in sorted(CHANGING_OPERATIONS):
            for state in ('succeeded', 'failed', 'unknown'):
                with self.subTest(operation=operation, state=state), tempfile.TemporaryDirectory() as directory:
                    journal = IdempotencyJournal(Path(directory))
                    request = request_for(operation)
                    result = {'state': state}
                    if state != 'succeeded':
                        result['errorCode'] = 'FIXTURE_OUTCOME'
                    if operation in SECRET_OUTPUT_MUTATIONS:
                        result['data'] = {'client': {'id': 'vpn-123456789abc'},
                                          'shareUri': 'fixture-private-response-marker'}
                    with patch('jarvis_host_agent.server.execute', return_value=result) as execute:
                        first = asyncio.run(send(request, journal))
                        execute.assert_called_once()
                    self.assertEqual(first['result'], result)
                    age_and_clean(journal)
                    restarted = IdempotencyJournal(Path(directory))
                    expected = journal_safe_result(result) if operation in SECRET_OUTPUT_MUTATIONS else result
                    with patch('jarvis_host_agent.server.execute') as execute:
                        replay = asyncio.run(send(request, restarted))
                        status = asyncio.run(send(request_for('operation.status', {'requestId': request['requestId']}), restarted))
                        execute.assert_not_called()
                    self.assertEqual(replay['result'], expected)
                    self.assertEqual(status['result']['data'], {'found': True, 'response': replay})
                    self.assertFalse(restarted.claim(request, response_for(request, {'state': 'unknown'})))
                    with self.assertRaises(ProtocolError):
                        restarted.claim({**request, 'sentAt': '2026-09-17T12:00:00.000Z'}, {})
                    stored = restarted.path.read_bytes()
                    self.assertNotIn(b'fixture-private-response-marker', stored)
                    self.assertNotIn(b'fixture-marker', stored)

    def test_every_interrupted_mutation_retains_pending_unknown_after_restart(self):
        for operation in sorted(CHANGING_OPERATIONS):
            with self.subTest(operation=operation), tempfile.TemporaryDirectory() as directory:
                journal = IdempotencyJournal(Path(directory))
                request = request_for(operation)
                with patch('jarvis_host_agent.server.execute', side_effect=RuntimeError('fixture interruption')):
                    with self.assertRaises(RuntimeError):
                        asyncio.run(send(request, journal))
                age_and_clean(journal)
                restarted = IdempotencyJournal(Path(directory))
                with patch('jarvis_host_agent.server.execute') as execute:
                    replay = asyncio.run(send(request, restarted))
                    status = asyncio.run(send(request_for('operation.status', {'requestId': request['requestId']}), restarted))
                    execute.assert_not_called()
                self.assertEqual(replay['result'], {'state': 'unknown', 'errorCode': 'ACTION_OUTCOME_PENDING'})
                self.assertEqual(status['result']['data']['response'], replay)

    def test_housekeeping_expires_only_explicit_read_responses(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = IdempotencyJournal(Path(directory))
            old_reads = []
            for operation in sorted(READ_ONLY_OPERATIONS):
                request = {'requestId': str(uuid.uuid4()), 'operation': operation}
                journal.put(request, response_for(request, {'state': 'succeeded'}))
                old_reads.append(request)
            # Old versions may have incomplete responses or retired operations.
            legacy = [({'requestId': str(uuid.uuid4())}, {'result': {'state': 'unknown'}}),
                      ({'requestId': str(uuid.uuid4()), 'operation': 'retired.operation'},
                       {'operation': 'retired.operation', 'result': {'state': 'unknown'}})]
            for request, response in legacy:
                journal.put(request, response)
            age_and_clean(journal)
            restarted = IdempotencyJournal(Path(directory))
            for request in old_reads:
                self.assertIsNone(restarted.get_response(request['requestId']))
            for request, response in legacy:
                self.assertEqual(restarted.get_response(request['requestId']), response)

    def test_both_exports_remain_ephemeral_after_housekeeping(self):
        for operation in sorted(EPHEMERAL_SECRET_OPERATIONS):
            with self.subTest(operation=operation), tempfile.TemporaryDirectory() as directory:
                journal = IdempotencyJournal(Path(directory))
                request = request_for(operation)
                with patch('jarvis_host_agent.server.execute', return_value={
                    'state': 'succeeded', 'data': {'shareUri': 'fixture-private-response-marker'},
                }):
                    payload = asyncio.run(send(request, journal))
                self.assertEqual(payload['result']['data']['shareUri'], 'fixture-private-response-marker')
                age_and_clean(journal)
                self.assertIsNone(IdempotencyJournal(Path(directory)).get_response(request['requestId']))
                self.assertNotIn(b'fixture-private-response-marker', journal.path.read_bytes())
