const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFile, writeFile, unlink, mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { chromium } = require('playwright');
const { ManualCoordinator } = require('../src/manualCoordinator');
const { initial, validate } = require('../src/manualState');
const { CaptchaTelegramBrowser } = require('../src/captchaTelegramBrowser');
const { CaptchaAutomatic } = require('../src/captchaAutomatic');
const { JobCaptchaClient } = require('../../server/src/jobs/jobCaptchaClient');
const { JobCaptchaWorker } = require('../../server/src/jobs/jobCaptchaWorker');
const { AUTOMATIC_CAPTION } = require('../../server/src/jobs/jobCaptchaService');
const { createCaptchaBroker } = require('../src/captchaBroker');
const { CaptchaAttemptStore } = require('../src/captchaAttemptStore');

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVQAAAAASUVORK5CYII=', 'base64');

async function scenario({ mode, recognize = async () => 'проверка картинки', png = pixel, expected = 'проверка картинки' }) {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.setOffline(true);
  const ownerId = randomUUID(), target = 'https://hh.ru/vacancy/123', token = 'fixture-only-captcha-credential-'.repeat(2);
  let saved = initial(ownerId), controller, key = 0, posts = 0, solved = false, photos = 0, claimed = false;
  let attemptedKey;
  const coordinator = new ManualCoordinator({
    store: { read: async () => structuredClone(saved), write: async value => (saved = structuredClone(validate(value, ownerId))) },
    open: url => controller.open(url), verify: (url, id) => controller.verify(url, id),
  });
  controller = new CaptchaTelegramBrowser({ context, coordinator, receiptTimeout: 200, dispatch: async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.pathname === '/captcha') { key++; await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ key: `picture-${key}` }) }); return; }
    posts++;
    const fields = new URLSearchParams(req.postData());
    assert.equal(fields.get('captchaText'), expected);
    assert.notEqual(attemptedKey, controller.current.key); attemptedKey = controller.current.key;
    if (mode === 'unknown') return route.abort();
    if (mode === 'success' || mode === 'second' && posts === 2 || mode === 'third' && posts === 3) solved = true;
    await route.fulfill({ status: 204 });
    return { acknowledged: mode !== 'redirect', httpStatus: mode === 'redirect' ? 302 : 200 };
  } });
  const archive = await mkdtemp(path.join(os.tmpdir(), 'hh-captcha-acceptance-'));
  const memory = new Map();
  const evidence = process.platform === 'linux'
    ? new CaptchaAttemptStore({ root: path.join(archive, 'evidence'), ownerId })
    : { start: async value => { const id = randomUUID(); memory.set(id, value); return { id }; },
      update: async (id, patch) => memory.set(id, { ...memory.get(id), ...patch }), export: async () => [...memory.values()] };
  controller.automatic = new CaptchaAutomatic({ coordinator, recognize, evidence });
  // Every request is fulfilled or aborted locally, including GET. Nothing
  // reaches HH, DNS or a real account, and no route.continue/fetch is used.
  await context.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin !== 'https://hh.ru') return route.abort();
    if (req.method() === 'POST') {
      if (await controller.permit(route)) return;
      return route.abort();
    }
    if (u.pathname === '/captcha/picture') return route.fulfill({ contentType: 'image/png', body: png });
    if (u.pathname === '/vacancy/123') {
      if (!solved) return route.fulfill({ contentType: 'text/html', body: "<script>location.replace('/account/captcha?backurl=%2Fvacancy%2F123&state=fixture')</script>" });
      return route.fulfill({ contentType: 'text/html', body: '<script type="application/ld+json">{"@type":"JobPosting","title":"Fixture","datePosted":"2026-10-18T00:00:00+03:00","hiringOrganization":{"name":"Fixture"}}</script><div data-qa="vacancy-description">Fixture</div>' });
    }
    if (u.pathname !== '/account/captcha') return route.abort();
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<h1>Подтвердите, что вы не робот</h1>
      <img id="picture" style="width:250px;height:90px;display:block"><form method="post" action="${u.href.replaceAll('&', '&amp;')}"><input type="hidden" name="_xsrf" value="fixture-xsrf"><input name="captchaText"><input type="hidden" name="isBot" value="false"><button type="submit">Go</button></form>
      <script>fetch('/captcha?lang=RU',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'}}).then(r=>r.json()).then(v=>picture.src='/captcha/picture?key='+v.key).catch(()=>{});</script>` });
  });
  await coordinator.load(); await coordinator.pending({ target, recoveryId: randomUUID() });
  const broker = createCaptchaBroker({ controller, coordinator, ownerId, token });
  await new Promise(resolve => broker.listen(0, '127.0.0.1', resolve));
  const client = new JobCaptchaClient({ ownerId, token, baseUrl: `http://127.0.0.1:${broker.address().port}/rpc`, allowTestHttp: true });
  const worker = new JobCaptchaWorker({ ownerId, client, automatic: true, repository: {
    scope: async () => ({ chatId: '101' }), getRequest: async () => null, recover: async () => {},
    hasUnknownDelivery: async () => null, enqueue: async () => {},
    claim: async () => { if (claimed) return null; claimed = true; return { id: randomUUID(), attempts: 1 }; },
    photoState: async () => 'sent', delivered: async () => {}, notify: async () => assert.fail('unexpected notice'),
  }, report: () => assert.fail('unexpected preparation failure'), sendPhoto: async value => {
    photos++; assert.equal(value.chatId, '101'); assert.equal(value.caption, AUTOMATIC_CAPTION);
    assert.ok(Buffer.isBuffer(value.png)); return { message_id: 123 };
  } });
  try {
    for (let i = 0; i < 5; i++) await worker.tick();
    const wanted = mode === 'success' || mode === 'unknown' || mode === 'redirect' ? 1 : mode === 'second' ? 2 : 3;
    assert.equal(posts, wanted); assert.equal(photos, solved ? 0 : 1);
    assert.equal(coordinator.status().phase, solved ? 'idle' : 'active');
    if (!solved) assert.equal(saved.automatic.phase, 'human');
    const records = await evidence.export();
    assert.equal(records.length, wanted);
    assert.ok(records.every(v => v.answer === expected && Buffer.from(v.pngBase64, 'base64').length > 33));
    assert.equal(records.at(-1).phase, solved ? 'solved' : mode === 'reject' ? 'new_challenge' : 'unknown');
    assert.equal(records.at(-1).receipt.httpStatus, mode === 'unknown' ? null : mode === 'redirect' ? 302 : 200);
  } finally {
    broker.closeAllConnections(); await new Promise(resolve => broker.close(resolve));
    worker.stop(); await controller.close(); await context.close(); await browser.close();
    await rm(archive, { recursive: true, force: true });
  }
}

test('real Chromium + broker + Telegram worker: first/second/third success, three rejections, unknown/redirect stop', { timeout: 90000 }, async () => {
  for (const mode of ['success', 'second', 'third', 'reject', 'unknown', 'redirect']) await scenario({ mode });
});

test('actual fine-tuned CPU model through PNG, Chromium native form, broker and Telegram worker', {
  timeout: 40000, skip: !process.env.JARVIS_FROZEN_TEST_PYTHON || !process.env.JARVIS_FROZEN_TEST_PNG,
}, async () => {
  const root = path.resolve(__dirname, '../..'), pngPath = process.env.JARVIS_FROZEN_TEST_PNG;
  const png = await readFile(pngPath);
  const { stdout } = await promisify(execFile)(process.env.JARVIS_FROZEN_TEST_PYTHON,
    [path.join(root, 'job-ocr/probe_frozen.py'), pngPath], { cwd: root, timeout: 20000, maxBuffer: 4096 });
  const value = JSON.parse(stdout.trim().split('\n').find(line => line.startsWith('{')));
  await scenario({ mode: 'success', png, expected: value.answer, recognize: async bytes => {
    // Decoding/re-encoding by canvas changes PNG compression, not image pixels.
    assert.equal(bytes.readUInt32BE(16), 250); assert.equal(bytes.readUInt32BE(20), 90);
    const file = `${pngPath}.canvas-${randomUUID()}.png`;
    try {
      await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
      const result = await promisify(execFile)(process.env.JARVIS_FROZEN_TEST_PYTHON,
        [path.join(root, 'job-ocr/probe_frozen.py'), file], { cwd: root, timeout: 20000, maxBuffer: 4096 });
      return JSON.parse(result.stdout.trim().split('\n').find(line => line.startsWith('{'))).answer;
    } finally { await unlink(file); }
  } });
});
