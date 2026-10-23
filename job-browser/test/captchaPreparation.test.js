const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createCaptchaBroker } = require('../src/captchaBroker');
const { CaptchaTelegramBrowser } = require('../src/captchaTelegramBrowser');
const { hashKey } = require('../src/captchaTelegramBrowser');

test('authenticated preparation diagnostics distinguish reader failure without exposing website data', async () => {
  const ownerId = randomUUID(), token = 'fixture-preparation-token-'.repeat(2), reports = [];
  const coordinator = { state: { claims: [], seedRequired: false }, status: () => ({ phase: 'active', revision: 4 }),
    start: async () => ({ phase: 'active' }), finish: async () => ({ phase: 'active' }) };
  const controller = new CaptchaTelegramBrowser({ coordinator });
  controller.page = { waitForTimeout: async () => {} };
  controller.picture = async () => null;
  controller.verificationReason = 'reader_failed';
  const broker = createCaptchaBroker({ ownerId, token, coordinator, controller, report: code => reports.push(code) });
  await new Promise(resolve => broker.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${broker.address().port}/rpc`, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-jarvis-owner-id': ownerId, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: ownerId, operation: 'challenge', args: { refresh: true } }) });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, code: 'JOB_CAPTCHA_UNAVAILABLE' });
    assert.deepEqual(reports, ['JOB_CAPTCHA_VERIFY_READER_FAILED']);
  } finally { broker.closeAllConnections(); await new Promise(resolve => broker.close(resolve)); }
});

test('preparation diagnostics reject arbitrary error fields and retain the public RPC contract', async () => {
  const ownerId = randomUUID(), token = 'fixture-preparation-token-'.repeat(2), reports = [];
  const privateValue = 'private-cookie-and-answer';
  const coordinator = { status: () => ({ phase: 'active', revision: 1 }) };
  const controller = { challenge: async () => { throw Object.assign(new Error(privateValue),
    { code: privateValue, failureCode: privateValue, stage: privateValue }); } };
  const broker = createCaptchaBroker({ ownerId, token, coordinator, controller, report: code => reports.push(code) });
  await new Promise(resolve => broker.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${broker.address().port}/rpc`, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-jarvis-owner-id': ownerId, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: ownerId, operation: 'challenge', args: { refresh: true } }) });
    assert.deepEqual(await response.json(), { ok: false, code: 'JOB_CAPTCHA_UNAVAILABLE' });
    assert.deepEqual(reports, ['JOB_CAPTCHA_PREPARATION_FAILED']);
    assert.equal(JSON.stringify(reports).includes(privateValue), false);
  } finally { broker.closeAllConnections(); await new Promise(resolve => broker.close(resolve)); }
});

test('preparation distinguishes unavailable open and target verification reasons', async () => {
  for (const [reason, failureCode] of [
    ['reader_failed', 'JOB_CAPTCHA_VERIFY_READER_FAILED'], ['http_status', 'JOB_CAPTCHA_VERIFY_HTTP_STATUS'],
    ['navigation_failed', 'JOB_CAPTCHA_VERIFY_NAVIGATION_FAILED'], ['different_location', 'JOB_CAPTCHA_VERIFY_DIFFERENT_LOCATION'],
    ['captcha', 'JOB_CAPTCHA_PICTURE_MISSING'],
  ]) {
    const coordinator = { state: { claims: [], seedRequired: false }, status: () => ({ phase: 'active', revision: 1 }),
      start: async () => ({ phase: 'active' }), finish: async () => ({ phase: 'active' }) };
    const controller = new CaptchaTelegramBrowser({ coordinator });
    controller.page = { waitForTimeout: async () => {} }; controller.picture = async () => null;
    controller.verificationReason = reason;
    await assert.rejects(controller.challenge(true), error => error.code === 'JOB_CAPTCHA_UNAVAILABLE' && error.failureCode === failureCode);
  }
  const coordinator = { state: { claims: [], seedRequired: false }, status: () => ({ phase: 'pending', revision: 1 }),
    start: async () => ({ phase: 'pending' }) };
  const controller = new CaptchaTelegramBrowser({ coordinator });
  await assert.rejects(controller.challenge(true), error => error.failureCode === 'JOB_CAPTCHA_OPEN_FAILED');
});

test('a missing or crashed challenge tab reports page unavailable without attempting another picture wait', async () => {
  for (const kind of ['missing', 'closed', 'crashed', 'closed-during-wait']) {
    const coordinator = { state: { claims: [], seedRequired: false }, status: () => ({ phase: 'active', revision: 1 }),
      start: async () => ({ phase: 'active' }), finish: async () => ({ phase: 'active' }) };
    const controller = new CaptchaTelegramBrowser({ coordinator });
    if (kind !== 'missing') {
      controller.page = { isClosed: () => kind !== 'crashed', waitForTimeout: async () => { throw new Error('private renderer exception'); } };
      if (kind === 'crashed') controller.crashed.add(controller.page);
      if (kind === 'closed-during-wait') controller.picture = async () => null;
    }
    await assert.rejects(controller.challenge(true), error => error.code === 'JOB_CAPTCHA_UNAVAILABLE'
      && error.failureCode === 'JOB_CAPTCHA_PAGE_UNAVAILABLE');
  }
});

test('already consumed picture key fails before PNG export and is reported as a closed reason', async () => {
  const key = 'fixture-used-key';
  const coordinator = { state: { claims: [hashKey(key)], seedRequired: false }, status: () => ({ phase: 'active', revision: 1 }),
    start: async () => ({ phase: 'active' }) };
  const controller = new CaptchaTelegramBrowser({ coordinator });
  controller.picture = async () => ({ key });
  await assert.rejects(controller.challenge(true), error => error.failureCode === 'JOB_CAPTCHA_PICTURE_ALREADY_USED');
});

test('renderer closure during the actual form read retains page-unavailable diagnostics', async () => {
  const coordinator = { state: { target: 'https://hh.ru/vacancy/123', claims: [], seedRequired: false },
    status: () => ({ phase: 'active', revision: 1 }), start: async () => ({ phase: 'active' }) };
  const controller = new CaptchaTelegramBrowser({ coordinator });
  let closed = false;
  controller.page = { isClosed: () => closed, url: () => 'https://hh.ru/account/captcha',
    evaluate: async () => { closed = true; throw new Error('private Playwright renderer exception'); } };
  await assert.rejects(controller.challenge(true), error => error.code === 'JOB_CAPTCHA_UNAVAILABLE'
    && error.failureCode === 'JOB_CAPTCHA_PAGE_UNAVAILABLE');
});
