const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { HhBrowser } = require('../src/hhBrowser');

function makeHarness() {
  const mainFrame = {};
  const handlers = [];
  const page = {
    closed: false,
    mouse: { async move() {}, async click() {}, async down() {}, async up() {}, async wheel() {} },
    keyboard: { async insertText() {}, async press() {}, async down() {}, async up() {} },
    setViewportSize() {}, setDefaultTimeout() {}, on() {},
    async route(_pattern, handler) { handlers.push(handler); },
    async goto(url) { page.currentUrl = url; },
    url() { return page.currentUrl; },
    mainFrame() { return mainFrame; },
    isClosed() { return page.closed; },
    async evaluate() { return { pathname: '/account/login', text: 'Войти в HH', iframeSources: [] }; },
    async close() { page.closed = true; },
  };
  const browser = new HhBrowser({ context: { async newPage() { return page; } } });
  const sessionId = randomUUID();
  return { browser, page, mainFrame, handlers, sessionId };
}

function makeRequest({ url = 'https://hh.ru/captcha?lang=RU', method = 'POST', type = 'xhr',
  frame, body = null, contentType = 'application/x-www-form-urlencoded' } = {}) {
  return {
    url: () => url,
    method: () => method,
    resourceType: () => type,
    frame: () => frame,
    headers: () => ({ 'content-type': contentType }),
    postDataBuffer: () => body,
  };
}

function makeRoute(request, { upstreamStatus = 200, upstreamBody = Buffer.from('{"key":"fixture-picture"}') } = {}) {
  const actions = [];
  const route = {
    request: () => request,
    async fetch(options) {
      actions.push(['fetch', options]);
      return { status: () => upstreamStatus,
        headers: () => ({ 'content-type': 'application/json' }),
        body: async () => upstreamBody,
        async dispose() { actions.push(['dispose']); } };
    },
    async fulfill(response) { actions.push(['fulfill', response]); },
    async continue() { actions.push(['continue']); },
    async abort() { actions.push(['abort']); },
  };
  return { route, actions };
}

async function start(harness = makeHarness()) {
  await harness.browser.startLogin({ sessionId: harness.sessionId });
  return harness;
}

test('login captcha initialization dispatches an empty same-origin POST before any user gesture', async () => {
  const h = await start();
  try {
    assert.equal(h.handlers.length, 1);
    const { route, actions } = makeRoute(makeRequest({ frame: h.mainFrame }));
    await h.handlers[0](route);

    assert.equal(actions.filter(([name]) => name === 'fetch').length, 1);
    const fetch = actions.find(([name]) => name === 'fetch')[1];
    assert.deepEqual(fetch, { maxRedirects: 0, maxRetries: 0, timeout: 10000 });
    const fulfillment = actions.find(([name]) => name === 'fulfill')[1];
    assert.equal(fulfillment.status, 200);
    assert.equal(fulfillment.body.toString(), '{"key":"fixture-picture"}');
    assert.equal(actions.some(([name]) => name === 'abort' || name === 'continue'), false);
  } finally { await h.browser.closeLogin({ sessionId: h.sessionId }).catch(() => {}); }
});

test('captcha refresh supports the other declared language while picture GET uses the normal read route', async () => {
  const h = await start();
  try {
    const refresh = makeRoute(makeRequest({ url: 'https://hh.ru/captcha?lang=EN', frame: h.mainFrame }));
    await h.handlers[0](refresh.route);
    assert.equal(refresh.actions.some(([name]) => name === 'fulfill'), true);

    const picture = makeRoute(makeRequest({ url: 'https://hh.ru/captcha/picture?key=fixture-picture',
      method: 'GET', type: 'image', frame: h.mainFrame }));
    await h.handlers[0](picture.route);
    assert.deepEqual(picture.actions.map(([name]) => name), ['continue']);
  } finally { await h.browser.closeLogin({ sessionId: h.sessionId }).catch(() => {}); }
});

test('login callback carrying CAPTCHA fields still needs a fresh main-frame user gesture', async () => {
  const h = await start();
  const callback = makeRequest({ url: 'https://hh.ru/account/otp_generate?captchaText=fixture-answer&captchaKey=fixture-picture&captchaState=fixture-state',
    frame: h.mainFrame });
  try {
    const beforeGesture = makeRoute(callback);
    await h.handlers[0](beforeGesture.route);
    assert.deepEqual(beforeGesture.actions.map(([name]) => name), ['abort']);

    await h.browser.loginInput({ sessionId: h.sessionId, sequence: 1,
      event: { type: 'pointer', action: 'click', button: 'left', x: 20, y: 20 } });
    const afterGesture = makeRoute(callback);
    await h.handlers[0](afterGesture.route);
    assert.deepEqual(afterGesture.actions.map(([name]) => name), ['continue']);
    assert.equal(JSON.stringify(afterGesture.actions).includes('fixture-answer'), false);

    await h.browser.loginInput({ sessionId: h.sessionId, sequence: 2,
      event: { type: 'pointer', action: 'click', button: 'left', x: 24, y: 24 } });
    h.browser.loginGestureAt = Date.now() - 3000;
    const staleGesture = makeRoute(callback);
    await h.handlers[0](staleGesture.route);
    assert.deepEqual(staleGesture.actions.map(([name]) => name), ['abort']);
  } finally { await h.browser.closeLogin({ sessionId: h.sessionId }).catch(() => {}); }
});

test('login CAPTCHA initialization rejects malformed requests and requests outside the active main-frame session', async () => {
  const h = await start();
  try {
    const invalid = [
      { url: 'https://hh.ru/captcha?lang=RU&extra=1' },
      { url: 'https://hh.ru/captcha?lang=RU&lang=EN' },
      { url: 'https://evil.example/captcha?lang=RU' },
      { url: 'https://user@hh.ru/captcha?lang=RU' },
      { body: Buffer.from('state=fixture') },
      { contentType: 'application/json' },
      { type: 'document' },
      { frame: {} },
    ];
    for (const patch of invalid) {
      const request = makeRequest({ frame: h.mainFrame, ...patch });
      const { route, actions } = makeRoute(request);
      await h.handlers[0](route);
      assert.deepEqual(actions.map(([name]) => name), ['abort']);
    }

    h.page.currentUrl = 'https://hh.ru/applicant/resumes';
    const wrongPage = makeRoute(makeRequest({ frame: h.mainFrame }));
    await h.handlers[0](wrongPage.route);
    assert.deepEqual(wrongPage.actions.map(([name]) => name), ['abort']);

    h.page.currentUrl = 'https://hh.ru/account/login';
    h.browser.loginExpiresAt = Date.now() - 1;
    const expired = makeRoute(makeRequest({ frame: h.mainFrame }));
    await h.handlers[0](expired.route);
    assert.deepEqual(expired.actions.map(([name]) => name), ['abort']);

    h.browser.loginExpiresAt = Date.now() + 60000;
    h.browser.loginState = 'closed';
    const closed = makeRoute(makeRequest({ frame: h.mainFrame }));
    await h.handlers[0](closed.route);
    assert.deepEqual(closed.actions.map(([name]) => name), ['abort']);
  } finally { await h.browser.closeLogin({ sessionId: h.sessionId }).catch(() => {}); }
});

test('login CAPTCHA init redirect is never forwarded to browser or followed', async () => {
  const h = await start();
  try {
    const { route, actions } = makeRoute(makeRequest({ frame: h.mainFrame }), { upstreamStatus: 307 });
    await h.handlers[0](route);
    assert.deepEqual(actions.filter(([name]) => name !== 'dispose').map(([name]) => name), ['fetch', 'abort']);
    assert.deepEqual(actions.find(([name]) => name === 'fetch')[1],
      { maxRedirects: 0, maxRetries: 0, timeout: 10000 });
    assert.equal(actions.some(([name]) => name === 'fulfill' || name === 'continue'), false);
  } finally { await h.browser.closeLogin({ sessionId: h.sessionId }).catch(() => {}); }
});

test('real browser keeps login CAPTCHA on the guarded route and rejects malformed init without network access',
  { timeout: 30000 }, async () => {
    const browserEngine = await chromium.launch({ headless: true,
      ...(process.env.PLAYWRIGHT_CHANNEL || process.platform === 'win32'
        ? { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' } : {}) });
    const context = await browserEngine.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    let loginDocumentRequests = 0;
    await page.route('**/*', async route => {
      const request = route.request();
      if (request.method() === 'GET' && new URL(request.url()).pathname === '/account/login') {
        loginDocumentRequests++;
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Fixture login</title><h1>Войти в HH</h1>' });
      }
      return route.abort();
    });
    await page.goto('https://hh.ru/account/login?role=applicant');
    // Keep this already fixture-served document in place when startLogin installs
    // its production guard. No request from the fixture reaches the live site.
    page.goto = async () => {};
    const contextWithPage = { async newPage() { return page; } };
    const hh = new HhBrowser({ context: contextWithPage });
    const sessionId = randomUUID();
    try {
      await hh.startLogin({ sessionId });
      const malformed = await page.evaluate(async () => {
        try {
          await fetch('/captcha?lang=RU&extra=1', { method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '' });
          return 'unexpected-response';
        } catch { return 'blocked'; }
      });
      assert.equal(malformed, 'blocked');
      assert.equal(loginDocumentRequests, 1);
    } finally {
      await hh.closeLogin({ sessionId }).catch(() => {});
      await page.close();
      await context.close();
      await browserEngine.close();
    }
  });

