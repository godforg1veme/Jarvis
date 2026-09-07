const assert = require('node:assert/strict');
const test = require('node:test');
const { ConnectionAdminRepository } = require('../src/operations/repositories/connectionAdminRepository');
const { ConnectionAdminService } = require('../src/operations/connections/connectionAdminService');

test('connection administration returns metadata-only profile mappings', async () => {
  const service = new ConnectionAdminService({
    async listProfiles() { return [{ id: 'profile-1', display_name: 'Макс', role: 'owner', created_at: '2026-09-01T00:00:00Z' }]; },
    async listTelegramIdentities() { return [{ id: 'identity-1', user_id: 'profile-1', external_id: '123456', created_at: '2026-09-01T00:00:00Z' }]; },
    async listDevices() { return [{ id: 'device-1', user_id: 'profile-1', name: 'Домашний ПК', status: 'online', device_kind: 'computer', last_seen_at: '2026-09-04T10:00:00Z', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-04T10:00:00Z' }]; },
  });
  const profiles = await service.listConnections();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].telegram[0].externalId, '123456');
  assert.equal(profiles[0].devices[0].name, 'Домашний ПК');
  assert.equal(JSON.stringify(profiles).includes('capabilities'), false);
  assert.equal(JSON.stringify(profiles).includes('token'), false);
});

test('connection repository queries never join private family content', async () => {
  const statements = [];
  const repository = new ConnectionAdminRepository({
    async query(sql) { statements.push(String(sql)); return { rows: [] }; },
  });
  await repository.listProfiles();
  await repository.listTelegramIdentities();
  await repository.listDevices();
  const sql = statements.join('\n').toLowerCase();
  for (const privateTable of ['messages', 'memories', 'documents', 'document_chunks', 'commands']) {
    assert.equal(sql.includes(privateTable), false, `must not query ${privateTable}`);
  }
  assert.match(statements[1], /provider='telegram'/);
  assert.doesNotMatch(statements[2], /capabilities|token_hash/);
});
