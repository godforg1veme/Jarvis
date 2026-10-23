const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/app');
const { registerMiniAppAssets, ASSETS } = require('../src/miniAppAssets');
const { loadConfig } = require('../src/config/loadConfig');
const { AssistantService } = require('../src/assistant/assistantService');
const { ReminderDeliveryRouter } = require('../src/life/reminders/reminderDeliveryRouter');
const { ServerActionExecutor } = require('../src/orchestrator/executorRegistry');

test('Mini App opt-in requires explicit HTTPS, owner and configured Telegram/database', () => {
  assert.equal(loadConfig({}).miniAppEnabled, false);
  const env = { JARVIS_MINI_APP_ENABLED: 'true', DATABASE_URL: 'postgres://fixture',
    TELEGRAM_BOT_TOKEN: 'fixture', JARVIS_OPERATIONS_OWNER_TELEGRAM_ID: '101',
    JARVIS_MINI_APP_PUBLIC_ORIGIN: 'https://mini.example' };
  assert.equal(loadConfig(env).miniAppPublicOrigin, 'https://mini.example');
  for (const value of ['http://mini.example', 'https://mini.example/mini/', 'https://x:y@mini.example', 'https://mini.example/?credential=fixture']) {
    assert.throws(() => loadConfig({ ...env, JARVIS_MINI_APP_PUBLIC_ORIGIN: value }));
  }
  assert.throws(() => loadConfig({ ...env, JARVIS_OPERATIONS_OWNER_TELEGRAM_ID: '0' }));
});

test('production static allowlist, missing build, Telegram framing scope and no inline/eval', async () => {
  const app = buildApp({ config: { logLevel: 'silent', miniAppEnabled: true } });
  registerMiniAppAssets(app, { root: '/nonexistent-mini-fixture' });
  try {
    const mini = await app.inject('/mini/');
    assert.equal(mini.statusCode, 503);
    assert.equal(mini.headers['x-frame-options'], undefined);
    assert.match(mini.headers['content-security-policy'], /https:\/\/web\.telegram\.org/);
    assert.doesNotMatch(mini.headers['content-security-policy'], /unsafe-inline|unsafe-eval/);
    const health = await app.inject('/health/live');
    assert.equal(health.headers['x-frame-options'], 'DENY');
    assert.doesNotMatch(health.headers['content-security-policy'], /web\.telegram/);
    for (const route of ['/mini/preview.html', '/mini/preview.js', '/mini/node_modules/three/package.json', '/mini/package.json']) {
      assert.equal((await app.inject(route)).statusCode, 404);
    }
    assert.equal(Object.hasOwn(ASSETS, 'preview.html'), false);
  } finally { await app.close(); }
});

test('production Mini App serves resume and orbital modules and stylesheets', async () => {
  const path = require('node:path');
  const fs = require('node:fs/promises');
  const root = path.resolve(__dirname, '../../mini-app/src');
  const app = buildApp({ config: { logLevel: 'silent', miniAppEnabled: true } });
  registerMiniAppAssets(app, { root });
  try {
    for (const name of ['jobConnection.js', 'jobResumes.js', 'jobResumes.css', 'core.js', 'orbitalBodies.js', 'orbitMotion.js', 'orbital.css', 'interior.css', 'sectionViews.js']) {
      const response = await app.inject(`/mini/${name}`);
      assert.equal(response.statusCode, 200, name);
      assert.equal(response.body, await fs.readFile(path.join(root, name), 'utf8'));
      assert.match(response.headers['content-type'], name.endsWith('.css') ? /^text\/css/ : /^text\/javascript/);
      assert.equal(response.headers['cache-control'], 'no-store');
    }
  } finally { await app.close(); }
});

test('orbital sky is explicitly served with image MIME while unrelated assets stay private', async () => {
  const path = require('node:path');
  const fs = require('node:fs/promises');
  const root = path.resolve(__dirname, '../../ops-ui/public');
  const app = buildApp({ config: { logLevel: 'silent', miniAppEnabled: true } });
  registerMiniAppAssets(app, { root });
  try {
    const sky = await app.inject('/mini/assets/milky-way-gaia-4k.webp');
    assert.equal(sky.statusCode, 200);
    assert.match(sky.headers['content-type'], /^image\/webp/);
    assert.deepEqual(sky.rawPayload, await fs.readFile(path.join(root, 'assets/milky-way-gaia-4k.webp')));
    for (const route of ['/mini/assets/milky-way-gaia-8k.webp', '/mini/assets/private.json', '/mini/preview.html']) assert.equal((await app.inject(route)).statusCode, 404);
  } finally { await app.close(); }
});

test('Mini App logs suppress encoded URL/query credentials and parser errors', async () => {
  let output = '';
  const app = buildApp({ config: { miniAppEnabled: true, logLevel: 'info' } });
  // Capture Pino output without changing serializers used in production.
  const stream = app.log[require('pino').symbols.streamSym];
  const write = stream.write;
  stream.write = (chunk) => { output += String(chunk); return true; };
  try {
    app.post('/mini/api/session', async () => { throw new Error('fixture-secret-body'); });
    await app.inject({ method: 'POST', url: '/m%69ni/api/session?initData=fixture-secret-query', payload: {} });
    await app.inject({ method: 'POST', url: '/mini/api/session', headers: { 'content-type': 'application/json' }, payload: '{"fixture-secret-parser' });
    assert.doesNotMatch(output, /fixture-secret/);
  } finally { stream.write = write; await app.close(); }
});

test('shared assistant omits denied sources and Life composer for every client', async () => {
  let composed = false, supplied;
  const service = new AssistantService({ profile: { provider: 'echo' },
    accessService: { async getAccessForUser() { return { permissions: ['assistant'], blocked: false }; } },
    lifeContextComposer: { async compose() { composed = true; return { lifeContext: { private: true } }; } },
    provider: { async answer(input) { supplied = input; return 'Ответ готов.'; } } });
  await service.answer({ userId: 'fixture', currentRequest: 'Вопрос', memories: [{ content: 'private' }],
    documents: [{ content: 'private' }], devices: [{ name: 'private' }], visualMemories: [{ content: 'private' }],
    lifeContext: { private: true }, runtimeContext: { toolsAvailable: [] } });
  assert.equal(composed, false);
  for (const field of ['memories','documents','devices','visualMemories']) assert.deepEqual(supplied[field], []);
  assert.equal(supplied.lifeContext, null);
});

test('shared assistant withholds in-flight Life context after revocation', async () => {
  let permissions = ['assistant', 'life'];
  const service = new AssistantService({ profile: { provider: 'echo' },
    accessService: { async getAccessForUser() { return { permissions, blocked: false }; } },
    lifeContextComposer: { async compose() { return { lifeContext: { mission: 'Private' } }; } },
    provider: { async answer() { permissions = ['assistant']; return 'Ответ с данными.'; } } });
  await assert.rejects(service.answer({ userId: 'fixture', currentRequest: 'Вопрос', runtimeContext: {} }), { publicCode: 'PERMISSION_DENIED' });
});

test('revoked Life cannot deliver reminders or execute server actions, reconciliation stays available', async () => {
  let delivered = false;
  const accessService = { async allows() { return false; } };
  const router = new ReminderDeliveryRouter({ accessService, telegram: {
    async deliver() { delivered = true; }, async reconcile() { return { status: 'delivered' }; } } });
  assert.equal((await router.deliver({ reminder: { user_id: 'fixture' }, channel: 'telegram' })).errorCode, 'PERMISSION_DENIED');
  assert.equal(delivered, false);
  assert.equal((await router.reconcile({ channel: 'telegram' })).status, 'delivered');
  const executor = new ServerActionExecutor({ accessService, reminderService: { async create() { delivered = true; } } });
  await assert.rejects(executor.execute({ userId: 'fixture', action: 'reminder.create', args: {} }), { publicCode: 'PERMISSION_DENIED' });
  assert.equal(delivered, false);
});
