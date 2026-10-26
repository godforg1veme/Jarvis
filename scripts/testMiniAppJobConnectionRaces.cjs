// Isolated browser tests for delayed HH replies. Uses no account or external API.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('../job-browser/node_modules/playwright');

const sourcePath = path.resolve(__dirname, '../mini-app/src/jobConnection.js');
const ids = [
  '12345678-1234-4234-8234-123456789abc',
  '12345678-1234-4234-8234-123456789abd',
];

async function setup(browser, width = 390, options = {}) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.route('http://127.0.0.1:41999/**', (route) => route.fulfill({
    contentType: 'text/html', body: '<main><p id="anchor"></p></main>',
  }));
  await page.goto('http://127.0.0.1:41999/');
  const source = (await fs.readFile(sourcePath, 'utf8')).replace(
    "import { createJobResumePanel } from './jobResumes.js';",
    'const createJobResumePanel = () => ({ show() {}, hide() {}, dispose() {} });',
  );
  await page.evaluate(async ({ source, ids, options }) => {
    window.fixture = { status: [], connection: [], login: [], confirmCalls: 0, cancelled: [] };
    const deferred = () => {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      return { promise, resolve, reject };
    };
    const api = { request: async (route, method, body) => {
      if (route === '/jobs/connection') {
        if (options.delayConnection) {
          const call = deferred(); window.fixture.connection.push(call); return call.promise;
        }
        return { available: true, connected: false };
      }
      if (route === '/jobs/login') {
        if (options.delayLogin) {
          const call = deferred(); window.fixture.login.push(call); return call.promise;
        }
        const index = window.fixture.login.length;
        window.fixture.login.push({});
        return { status: 'created', sessionId: ids[index], ticket: 'a'.repeat(64) };
      }
      if (route.startsWith('/jobs/login/owned/status/')) {
        const call = deferred();
        window.fixture.status.push({ id: route.split('/').at(-1), ...call });
        return call.promise;
      }
      if (route === '/jobs/login/cancel') {
        window.fixture.cancelled.push(body.sessionId);
        return { status: 'cancelled' };
      }
      if (route === '/jobs/login/confirm') {
        window.fixture.confirmCalls++;
        return { status: 'confirmed' };
      }
      throw Error(`Unexpected request: ${method} ${route}`);
    } };
    const module = await import(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
    window.fixture.panel = module.createJobConnectionPanel({ api, actor: { telegramId: '100' }, anchor: document.querySelector('#anchor') });
  }, { source, ids, options });
  return page;
}

async function connectedThenCancel(browser) {
  const page = await setup(browser);
  try {
    await page.getByRole('button', { name: 'Подключить HH', exact: true }).click();
    await page.waitForFunction(() => window.fixture.status.length === 1);
    await page.getByRole('button', { name: 'Отменить подключение' }).click();
    await page.getByText('Подключение отменено.', { exact: true }).waitFor();
    await page.evaluate(() => window.fixture.status[0].resolve({ status: 'authenticated', resumes: [{ id: 'r1', title: 'Fixture' }] }));
    await page.waitForTimeout(40);
    assert.equal(await page.getByRole('button', { name: 'Сохранить профиль' }).isVisible(), false);
    assert.equal(await page.evaluate(() => window.fixture.confirmCalls), 0);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('jarvis-job-login:session:100')), null);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  } finally { await page.close(); }
}

async function oldStatusAfterNewConnection(browser, rejectOld = false) {
  const page = await setup(browser, 1280);
  try {
    await page.getByRole('button', { name: 'Подключить HH', exact: true }).click();
    await page.waitForFunction(() => window.fixture.status.length === 1);
    await page.getByRole('button', { name: 'Отменить подключение' }).click();
    await page.getByText('Подключение отменено.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Подключить HH', exact: true }).click();
    await page.waitForFunction(() => window.fixture.status.length === 2);
    assert.equal(await page.getByRole('button', { name: 'Отменить подключение' }).isEnabled(), true);
    if (rejectOld) await page.evaluate(() => window.fixture.status[0].reject(new Error('Delayed old error')));
    else await page.evaluate(() => window.fixture.status[0].resolve({ status: 'authenticated', resumes: [{ id: 'old', title: 'Old' }] }));
    await page.waitForTimeout(40);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('jarvis-job-login:session:100')), ids[1]);
    assert.equal(await page.getByRole('button', { name: 'Сохранить профиль' }).isVisible(), false);
    await page.evaluate(() => window.fixture.status[1].resolve({ status: 'authenticated', resumes: [{ id: 'new', title: 'New' }] }));
    await page.getByRole('button', { name: 'Сохранить профиль' }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Основное резюме HH' }).inputValue(), 'new');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  } finally { await page.close(); }
}

async function disposedDuringReplies(browser) {
  for (const options of [{ delayConnection: true }, { delayLogin: true }, { delayLogin: true, rejectAfterDispose: true }]) {
    const page = await setup(browser, 390, options);
    try {
      if (options.delayLogin) {
        await page.getByRole('button', { name: 'Подключить HH', exact: true }).click();
        await page.waitForFunction(() => window.fixture.login.length === 1);
      } else await page.waitForFunction(() => window.fixture.connection.length === 1);
      const before = await page.evaluate(() => ({ ...sessionStorage }));
      const previousStatus = await page.evaluate(() => { window.fixture.oldStatus = document.querySelector('.job-status'); return window.fixture.oldStatus.textContent; });
      await page.evaluate(() => window.fixture.panel.dispose());
      if (options.rejectAfterDispose) await page.evaluate(() => window.fixture.login[0].reject(new Error('Delayed disposed error')));
      else if (options.delayLogin) await page.evaluate(({ id }) => window.fixture.login[0].resolve({ status: 'created', sessionId: id, ticket: 'a'.repeat(64) }), { id: ids[0] });
      else await page.evaluate(() => window.fixture.connection[0].resolve({ available: true, connected: true }));
      await page.waitForTimeout(40);
      assert.deepEqual(await page.evaluate(() => ({ ...sessionStorage })), before);
      assert.equal(await page.locator('.job-panel').count(), 0);
      assert.equal(await page.evaluate(() => window.fixture.status.length), 0);
      assert.equal(await page.evaluate(() => window.fixture.oldStatus.textContent), previousStatus);
    } finally { await page.close(); }
  }
}

async function staleInitialLoadError(browser) {
  const page = await setup(browser, 390, { delayConnection: true });
  try {
    await page.waitForFunction(() => window.fixture.connection.length === 1);
    await page.getByRole('button', { name: 'Подключить HH', exact: true }).click();
    await page.waitForFunction(() => window.fixture.status.length === 1);
    const currentStatus = await page.locator('.job-status').textContent();
    await page.evaluate(() => window.fixture.connection[0].reject(new Error('Delayed initial load error')));
    await page.waitForTimeout(40);
    assert.equal(await page.locator('.job-status').textContent(), currentStatus);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('jarvis-job-login:session:100')), ids[0]);
    assert.equal(await page.locator('.job-login-share').isVisible(), true);
  } finally { await page.close(); }
}

async function unavailableRequestStorage(browser) {
  for (const mode of ['read', 'write', 'silent']) {
    const page = await setup(browser, 390, { delayLogin: true });
    try {
      await page.evaluate((mode) => {
        const method = mode === 'read' ? 'getItem' : 'setItem';
        Storage.prototype[method] = () => { if (mode !== 'silent') throw new Error('fixture-storage-unavailable'); };
      }, mode);
      await page.getByRole('button', { name: 'Подключить HH', exact: true }).click();
      await page.getByText(/Запрос входа HH не отправлен/).waitFor();
      assert.equal(await page.evaluate(() => window.fixture.login.length), 0, 'no POST without recoverable original UUID');
      assert.equal(await page.getByRole('button', { name: 'Подключить HH', exact: true }).isEnabled(), true);
    } finally { await page.close(); }
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    await connectedThenCancel(browser);
    await oldStatusAfterNewConnection(browser);
    await oldStatusAfterNewConnection(browser, true);
    await disposedDuringReplies(browser);
    await staleInitialLoadError(browser);
    await unavailableRequestStorage(browser);
    console.log('PASS: delayed HH success/error after cancel, new session, and dispose; stale initial load error; unavailable request storage; 390/1280 px.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
