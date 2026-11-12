const test = require('node:test');
const assert = require('node:assert/strict');
const { requestInput, uploadInput, externalUrl } = require('./workspaceProtocol');
const { registerWorkspaceIpc } = require('./workspaceIpc');
const id = '11111111-1111-4111-8111-111111111111';

test('workspace transport rejects guest auth, URLs, encoded traversal and arbitrary methods', () => {
  for (const path of ['/session', '/admin', '/jobs/login/claim', '/jobs/login/frame/' + id,
    'https://example.test/me', '//example.test/me', '/sections/memory?user=other',
    '/sections/memory/page/%2e%2e', '/sections/memory/page/a%2Fb']) {
    assert.throws(() => requestInput({ path }));
  }
  assert.throws(() => requestInput({ path: '/me', method: 'DELETE' }));
  assert.throws(() => requestInput({ path: '/me', body: {} }));
  assert.equal(requestInput({ path: `/memory/operations/${id}` }).method, 'GET');
  assert.equal(requestInput({ path: '/memory/operations', method: 'POST', body: { operationId: id } }).body,
    JSON.stringify({ operationId: id }));
});

test('uploads have bounded typed data, safe names and declared document MIME types', () => {
  const input = { operationId: id, name: 'example.txt', type: 'text/plain', data: new Uint8Array([65]) };
  assert.equal(uploadInput(input).data.toString(), 'A');
  for (const patch of [{ data: [] }, { data: new ArrayBuffer(0) }, { name: '../example.txt' },
    { type: 'text/html' }, { data: new ArrayBuffer(20 * 1024 * 1024 + 1) }]) {
    assert.throws(() => uploadInput({ ...input, ...patch }));
  }
});

test('external browser links are restricted to configured app and closed bot handoffs', () => {
  const server = 'https://jarvis.example.test';
  assert.equal(externalUrl(server + '/ops/', server), server + '/ops/');
  const bot = 'https://t.me/example_bot?start=mini_jobs';
  assert.equal(externalUrl(bot, server, [bot]), bot);
  assert.throws(() => externalUrl('https://t.me/SomeOtherBot?start=mini_jobs', server, [bot]));
  for (const href of ['file:///C:/Windows', 'javascript:alert(1)', 'https://evil.test/ops/',
    server + '/ops/?token=anything', 'https://t.me/example_bot?start=anything']) {
    assert.throws(() => externalUrl(href, server));
  }
});

test('foreign frames cannot reach workspace, uploads, external browser or settings', async () => {
  const handlers = new Map(); let calls = 0;
  const client = { workspaceRequest: async () => { calls++; return { ok: true }; } };
  registerWorkspaceIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    isTrustedRenderer: (event) => event.trusted, getClient: () => client,
    openExternal: () => { calls++; }, openVoiceSettings: () => { calls++; } });
  for (const handler of handlers.values()) assert.equal((await handler({}, {})).code, 'forbidden');
  assert.equal(calls, 0);
  assert.equal((await handlers.get('workspace:request')({ trusted: true }, { path: '/me' })).ok, true);
  assert.equal(calls, 1);
});

test('uncertain mutations stay uncertain and exception messages never escape IPC', async () => {
  const handlers = new Map();
  registerWorkspaceIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    isTrustedRenderer: () => true, getClient: () => ({ workspaceRequest: async () => { throw new Error('private diagnostic'); } }) });
  const result = await handlers.get('workspace:request')({}, { path: '/memory/operations', method: 'POST', body: { operationId: id } });
  assert.deepEqual(result, { ok: false, code: 'unknown', uncertain: true });
  const read = await handlers.get('workspace:request')({}, { path: '/me' });
  assert.equal(read.code, 'unavailable');
});
