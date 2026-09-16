const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/app');
const { hashToken } = require('../src/vpn/vpnSubscriptionService');

function testConfig() {
  return {
    nodeEnv: 'test',
    logLevel: 'silent',
    trustProxy: false,
  };
}

test('GET /sub/:token returns 404 for unknown token', async (t) => {
  const mockSvc = {
    repository: {
      findActiveByTokenHash: async () => null,
    },
    resolveSubscription: async (token) => {
      return { status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'SUBSCRIPTION_NOT_FOUND' }) };
    },
  };
  const app = buildApp({ config: testConfig(), vpnSubscriptionService: mockSvc });
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/sub/sub_nonexistent' });
  assert.equal(response.statusCode, 404);
  assert.equal(JSON.parse(response.body).error, 'SUBSCRIPTION_NOT_FOUND');
});

test('GET /sub/:token returns the ordinary subscription for Happ user agent', async (t) => {
  const mockSvc = {
    resolveSubscription: async (token, { userAgent }) => {
      assert.equal(token, 'sub_active123');
      assert.match(userAgent, /Happ/);
      return {
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: Buffer.from('vless://fixture@vpn.rilora.ru:8443', 'utf8').toString('base64'),
      };
    },
  };
  const app = buildApp({ config: testConfig(), vpnSubscriptionService: mockSvc });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/sub/sub_active123',
    headers: { 'user-agent': 'Happ/3.2.0 (iOS)' },
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /text\/plain/);
  assert.match(Buffer.from(response.body, 'base64').toString('utf8'), /^vless:\/\//);
});

test('GET /sub/:token returns 200 text/plain Base64 for curl user agent', async (t) => {
  const mockSvc = {
    resolveSubscription: async (token, { userAgent }) => {
      assert.equal(token, 'sub_active123');
      return {
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: Buffer.from('hy2://test@vpn.rilora.ru:20000-50000', 'utf8').toString('base64'),
      };
    },
  };
  const app = buildApp({ config: testConfig(), vpnSubscriptionService: mockSvc });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/sub/sub_active123',
    headers: { 'user-agent': 'curl/7.81.0' },
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /text\/plain/);
  const decoded = Buffer.from(response.body, 'base64').toString('utf8');
  assert.ok(decoded.includes('hy2://test@vpn.rilora.ru:20000-50000'));
});

test('GET /happ-sub/:token serves a landing page with the documented Happ deeplink', async (t) => {
  const token = 'sub_active123';
  const mockSvc = {
    repository: {
      findActiveByTokenHash: async (hash) => {
        if (hash === hashToken(token)) return { id: 's1', label: 'Тестовый iPhone' };
        return null;
      },
    },
    renderHappLandingHtml: ({ token, label }) => {
      return `<html><body><h1>Подписка Jarvis VPN</h1><a href="happ://add/https%3A%2F%2Fjarvis.rilora.ru%2Fsub%2F${token}">Активировать</a><span>${label}</span></body></html>`;
    },
  };
  const app = buildApp({ config: testConfig(), vpnSubscriptionService: mockSvc });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: `/happ-sub/${token}`,
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.ok(response.body.includes('happ://add/https%3A%2F%2Fjarvis.rilora.ru%2Fsub%2Fsub_active123'));
  assert.ok(response.body.includes('Тестовый iPhone'));
});
