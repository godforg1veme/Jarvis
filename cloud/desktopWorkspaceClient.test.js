const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DesktopCloudClient } = require('./desktopCloudClient');
const { safeFailure } = require('./workspaceIpc');
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
function response(body, status = 200) { return new Response(JSON.stringify(body), { status }); }
function fixture(fetch) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-workspace-'));
  const options = { userDataPath: directory, fetch, safeStorage: {
    isEncryptionAvailable: () => true, decryptString: () => 'fixture-credential',
  } };
  fs.writeFileSync(path.join(directory, 'cloud-device.json'), JSON.stringify({ serverUrl: 'https://example.test', deviceId: 'fixture-device' }));
  fs.writeFileSync(path.join(directory, 'cloud-device.token'), 'fixture-encrypted-data');
  return { directory, client: () => new DesktopCloudClient(options), close: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
test('unknown survives restart; recovery inspects the original ID without another mutation', async () => {
  const calls = [];
  const f = fixture(async (url, options) => {
    calls.push({ url, method: options.method });
    if (options.method === 'POST') throw new Error('lost response');
    return response({ ok: true, status: 'completed', memoryId: other });
  });
  try {
    await assert.rejects(f.client().workspaceRequest({ path: '/memory/operations', method: 'POST', body: { operationId: id, content: 'Synthetic private text' } }));
    const restarted = f.client();
    assert.deepEqual(restarted.listWorkspacePending(), [{ kind: 'memory', id }]);
    assert.doesNotMatch(fs.readFileSync(path.join(f.directory, 'cloud-workspace-pending.json'), 'utf8'), /Synthetic|credential/);
    await assert.rejects(restarted.workspaceRequest({ path: '/memory/operations', method: 'POST', body: { operationId: other } }), { code: 'PENDING_OPERATION_EXISTS' });
    assert.equal(calls.length, 1);
    await restarted.workspaceRequest({ path: `/memory/operations/${id}`, method: 'GET' });
    assert.deepEqual(restarted.listWorkspacePending(), []);
    assert.deepEqual(calls.map((c) => c.method), ['POST', 'GET']);
  } finally { f.close(); }
});
test('post-commit permission rejection keeps the durable and renderer UUID', async () => {
  const f = fixture(async () => response({ ok: false, code: 'forbidden' }, 403));
  try {
    const client = f.client();
    const error = await client.workspaceRequest({ path: '/jobs/resumes/settings', method: 'POST', body: { requestId: id } }).catch((e) => e);
    assert.equal(safeFailure(error, true).uncertain, true);
    assert.equal(safeFailure(error, true).code, 'forbidden');
    assert.deepEqual(client.listWorkspacePending(), [{ kind: 'job-resumes', id }]);
  } finally { f.close(); }
});
test('only server proof of an unstarted operation releases its pending UUID', async () => {
  const f = fixture(async () => response({ ok: false, code: 'revision_conflict', notStarted: true }, 409));
  try {
    const client = f.client();
    const error = await client.workspaceRequest({ path: '/jobs/resumes/settings', method: 'POST', body: { requestId: id } }).catch((e) => e);
    assert.equal(safeFailure(error, true).uncertain, false);
    assert.equal(safeFailure(error, true).code, 'conflict');
    assert.deepEqual(client.listWorkspacePending(), []);
  } finally { f.close(); }
});
test('Telegram handoffs originate from authenticated sections in the current scope', async () => {
  const href = 'https://t.me/example_bot?start=mini_jobs';
  const f = fixture(async () => response({ ok: true, actions: [{ kind: 'telegram', href }] }));
  try {
    const client = f.client();
    assert.deepEqual(client.workspaceTelegramLinks(), []);
    await client.workspaceRequest({ path: '/sections/jobs', method: 'GET' });
    assert.deepEqual(client.workspaceTelegramLinks(), [href]);
    client.publicState.deviceId = 'other-device';
    assert.deepEqual(client.workspaceTelegramLinks(), []);
  } finally { f.close(); }
});
