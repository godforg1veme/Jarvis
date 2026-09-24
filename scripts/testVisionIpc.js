const assert = require('node:assert/strict');
const { registerVisionIpc } = require('../vision/visionIpc');

(async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  const calls = [];
  const runtime = {
    publicState() { return { state: 'off' }; },
    async discover() { return { ok: true, cameras: [], displays: [] }; },
    async start(input) { calls.push(['start', input]); return { ok: true }; },
    async analyze(input) { calls.push(['analyze', input]); return { ok: true }; },
    async stop(reason) { calls.push(['stop', reason]); return { ok: true }; },
    async setSensitiveConsent(sourceId, allow) { calls.push(['consent', sourceId, allow]); },
    transport: {
      async listMemories(limit) { calls.push(['list', limit]); return { ok: true }; },
      async getMemory(id) { calls.push(['get', id]); return { ok: true }; },
      async updateMemory(id, patch) { calls.push(['update', id, patch]); return { ok: true }; },
      async deleteMemory(id) { calls.push(['delete', id]); return { ok: true }; },
    },
  };
  registerVisionIpc({ ipcMain, isTrustedRenderer: (event) => event.trusted === true, getRuntime: () => runtime });
  assert.equal(handlers.size, 11);
  assert.deepEqual(await handlers.get('vision:get-state')({ trusted: false }), { ok: false, error: 'Access denied.' });
  await handlers.get('vision:start')({ trusted: true }, { includeCamera: true, includeScreens: false, kind: 'unexpected' });
  await handlers.get('vision:analyze')({ trusted: true }, { prompt: 'x'.repeat(5000), target: 'unknown' });
  assert.deepEqual(calls[0], ['start', { cameraSourceId: '', includeCamera: true, includeScreens: false, kind: 'active' }]);
  assert.equal(calls[1][1].prompt.length, 4000);
  assert.equal(calls[1][1].target, 'all');
  assert.deepEqual(handlers.get('vision:classify-intent')({ trusted: false }, { text: 'посмотри в камеру' }), { visual: false });
  console.log('Vision IPC tests passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
