const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { HhBrowser } = require('../src/hhBrowser');

function fixturePage() {
  const page = { closed: false, focused: null, value: '', calls: [],
    mouse: { async move(x, y) { page.calls.push(['move', x, y]); }, async click(x, y) {
      page.calls.push(['click', x, y]); page.focused = y < 150 ? 'login' : 'password';
    }, async down() {}, async up() {}, async wheel() {} },
    keyboard: { async insertText(value) { page.calls.push(['text', value.length]); page.value += value; },
      async press(key) { page.calls.push(['key', key]); }, async down() {}, async up() {} },
    isClosed() { return page.closed; },
    async evaluate(fn) { return fn.toString().includes('querySelectorAll') ? [] : { pathname: '/account/login', text: 'Войти в HH', iframeSources: [] }; },
    async screenshot() { return Buffer.from('fixture-frame'); },
    async close() { page.closed = true; },
  };
  return page;
}

test('HH login relay consumes each input sequence once and never echoes text values', async () => {
  const page = fixturePage(), sessionId = randomUUID();
  const browser = new HhBrowser({ context: { newPage() {} } });
  browser.loginPage = page; browser.loginSessionId = sessionId; browser.loginState = 'waiting';
  browser.loginExpiresAt = Date.now() + 60000;
  try {
    const frame = await browser.loginFrame({ sessionId });
    assert.deepEqual(frame, { state: 'waiting', mimeType: 'image/jpeg', frameBase64: Buffer.from('fixture-frame').toString('base64'), width: 1024, height: 768, inputFields: [] });
    await browser.loginInput({ sessionId, sequence: 1, event: { type: 'pointer', action: 'click', button: 'left', x: 120, y: 100 } });
    const inserted = await browser.loginInput({ sessionId, sequence: 2, event: { type: 'text', value: 'fixture-user' } });
    const replay = await browser.loginInput({ sessionId, sequence: 2, event: { type: 'text', value: 'must-not-be-inserted' } });
    assert.equal(page.value, 'fixture-user');
    assert.equal(page.calls.filter(([name]) => name === 'text').length, 1);
    assert.deepEqual(inserted, { state: 'waiting', nextSequence: 3 });
    assert.deepEqual(replay, { state: 'waiting', nextSequence: 3 });
    assert.equal(JSON.stringify([inserted, replay]).includes('fixture-user'), false);
    await assert.rejects(browser.loginInput({ sessionId, sequence: 4, event: { type: 'text', value: 'gap' } }), { code: 'JOB_BROWSER_INVALID_REQUEST' });
    await assert.rejects(browser.loginInput({ sessionId, sequence: 3, event: { type: 'text', value: 'x'.repeat(65) } }), { code: 'JOB_BROWSER_INVALID_REQUEST' });
    assert.equal(page.value, 'fixture-user');
  } finally { await browser.closeLogin({ sessionId }).catch(() => {}); }
});
