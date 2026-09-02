const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp, loggerOptions } = require('../src/app');
const { loadConfig } = require('../src/config/loadConfig');

function testConfig() {
  return loadConfig({ NODE_ENV: 'test', JARVIS_LOG_LEVEL: 'silent' });
}

test('liveness endpoint is available with security headers', async (t) => {
  const app = buildApp({ config: testConfig() });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/health/live' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
});

test('readiness reports dependency failure without leaking its error', async (t) => {
  async function database() {
    throw new Error('postgres://secret');
  }
  const app = buildApp({
    config: testConfig(),
    readinessChecks: [database],
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/health/ready' });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    ok: false,
    checks: [{ name: 'database', ok: false, detail: 'check failed' }],
  });
  assert.equal(response.body.includes('secret'), false);
});

test('logger redacts every configured model-provider key', () => {
  const options = loggerOptions({ logLevel: 'info' });
  assert.ok(options.redact.paths.includes('openrouterFallbackApiKey'));
  assert.ok(options.redact.paths.includes('geminiApiKey'));
  assert.ok(options.redact.paths.includes('*.openrouterFallbackApiKey'));
  assert.ok(options.redact.paths.includes('*.geminiApiKey'));
});
