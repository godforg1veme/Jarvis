const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Capture the real default Pino destination, including Fastify lifecycle logs.
// This marker is artificial and never identifies a real subscription.
const marker = 'AUDIT_LOG_CANARY_42';
function requestLogs(route, outcome) {
  const script = `
    const { buildApp } = require('./src/app');
    const marker = ${JSON.stringify(marker)};
    const route = ${JSON.stringify(route)};
    const outcome = ${JSON.stringify(outcome)};
    const fail = () => {
      const error = new Error('provider URL /' + route + '/' + marker + '?copy=' + marker);
      if (outcome === 'client-error') error.statusCode = 418;
      error.cause = new Error(marker);
      error.privateDetail = marker;
      throw error;
    };
    const service = {
      resolveSubscription: async (token) => {
        if (token !== marker) throw new Error('route input was modified');
        if (['error', 'client-error'].includes(outcome)) fail();
        return { status: outcome === 'missing' ? 404 : 200,
          contentType: 'text/plain', body: 'fixture response' };
      },
      repository: { findActiveByTokenHash: async () => {
        if (['error', 'client-error'].includes(outcome)) fail();
        return outcome === 'missing' ? null : { label: 'fixture' };
      } },
      renderHappLandingHtml: ({ token }) => {
        if (token !== marker) throw new Error('route input was modified');
        return '<h1>fixture</h1>';
      },
    };
    (async () => {
      const app = buildApp({ config: { logLevel: 'trace', nodeEnv: 'test', trustProxy: false },
        vpnSubscriptionService: outcome === 'unavailable' ? undefined : service });
      app.get('/ordinary-error', async () => { throw new Error('ordinary diagnostic'); });
      const subscriptionPrefix = outcome === 'escaped' ?
        route.replace('s', '%73') : route;
      const url = route === 'ordinary' ? '/health/live?check=ready' :
        route === 'ordinary-error' ? '/ordinary-error' :
        '/' + subscriptionPrefix + '/' + marker +
        (outcome === 'malformed' ? '/extra' : '') + '?copy=' + marker;
      const response = await app.inject({ method: 'GET', url,
        headers: { host: 'fixture.example' } });
      const expected = outcome === 'unavailable' ? 503 : outcome === 'client-error' ? 418 :
        outcome === 'error' ? 500 : ['missing', 'malformed'].includes(outcome) ? 404 : 200;
      if (response.statusCode !== expected) {
        throw new Error('unexpected response status');
      }
      await app.close();
    })().catch(() => { process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
  });
  assert.equal(result.status, 0, 'logging fixture completed');
  return result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

for (const route of ['sub', 'happ-sub']) {
  for (const outcome of ['success', 'missing', 'error', 'client-error', 'unavailable', 'malformed', 'escaped']) {
    test(`${route} ${outcome} logs omit the subscription secret from path, query and errors`, () => {
      const logs = requestLogs(route, outcome);
      assert.equal(JSON.stringify(logs).includes(marker), false, 'canary must never reach logs');
      const incoming = logs.find((entry) => entry.msg === 'incoming request');
      assert.equal(incoming.req.url, `/${route}/:token`);
      assert.equal(incoming.req.method, 'GET');
      assert.equal(incoming.req.host, 'fixture.example');
      assert.ok(incoming.req.remoteAddress);
      assert.ok(incoming.reqId);
      const completed = logs.find((entry) => entry.msg === 'request completed');
      assert.equal(completed.reqId, incoming.reqId);
      const expected = outcome === 'unavailable' ? 503 : outcome === 'client-error' ? 418 :
        outcome === 'error' ? 500 : ['missing', 'malformed'].includes(outcome) ? 404 : 200;
      assert.equal(completed.res.statusCode, expected);
      if (['error', 'client-error'].includes(outcome)) {
        const failure = logs.find((entry) => entry.msg === 'request failed');
        assert.deepEqual(failure.err, { type: 'SubscriptionRequestError',
          ...(outcome === 'client-error' ? { statusCode: 418 } : {}) });
        assert.equal(failure.requestId, incoming.reqId);
      }
    });
  }
}

test('ordinary request paths and error diagnostics retain their metadata', () => {
  const logs = requestLogs('ordinary', 'success');
  assert.equal(logs.find((entry) => entry.req).req.url, '/health/live?check=ready');
  const errors = requestLogs('ordinary-error', 'error');
  const failure = errors.find((entry) => entry.msg === 'request failed');
  assert.equal(failure.err.message, 'ordinary diagnostic');
  assert.match(failure.err.stack, /ordinary diagnostic/);
});
