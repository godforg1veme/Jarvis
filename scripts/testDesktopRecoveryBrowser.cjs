const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

async function run() {
  const output = path.join(__dirname, '..', 'build', 'desktop-recovery-screenshots');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  try {
    // Electron's main window has minWidth=760 and minHeight=560.
    for (const width of [1440, 760]) {
      const page = await browser.newPage({ viewport: { width, height: width === 760 ? 560 : 900 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.addInitScript(() => {
        const id = '11111111-1111-4111-8111-111111111111';
        let pending = [{ clientMessageId: id, kind: 'text', createdAt: '2026-10-20T10:00:00Z' }];
        let status = 'processing';
        let rejectAck = true;
        const noop = () => {};
        window.__calls = { send: 0, check: 0, ack: 0 };
        window.__state = (connection) => window.jarvisCloud.stateListener({
          paired: connection !== 'unpaired', connection, deviceId: 'fixture-device', serverUrl: 'https://example.test',
        });
        window.__status = (value) => { status = value; };
        window.jarvisCloud = {
          onState(listener) { this.stateListener = listener; }, onVoiceStatus: noop, onMessage: noop, onCoreMode: noop,
          async getState() { return { ok: true, paired: true, connection: 'online', deviceId: 'fixture-device', serverUrl: 'https://example.test' }; },
          async getVoiceState() { return { ok: true, enabled: false, phase: 'off' }; },
          async listPendingRequests() { return { ok: true, requests: pending }; },
          async getRequestStatus(clientMessageId) {
            window.__calls.check += 1;
            return { ok: true, clientMessageId, status,
              ...(status === 'completed' ? { response: { answer: 'Восстановленный ответ', artifactUnavailable: true,
                confirmation: { commandId: '22222222-2222-4222-8222-222222222222' } } } : {}) };
          },
          async acknowledgeRequest() {
            window.__calls.ack += 1;
            if (rejectAck) { rejectAck = false; return { ok: false }; }
            pending = [];
            return { ok: true };
          },
          async sendMessage() { window.__calls.send += 1; return { ok: false, outcome: 'unknown', clientMessageId: id }; },
          async classifyVisualIntent() { return { visual: false }; },
        };
      });
      await page.goto(pathToFileURL(path.join(__dirname, '..', 'renderer', 'cloud-chat', 'index.html')).href);
      await page.getByRole('heading', { name: 'Я на связи' }).waitFor();
      assert.equal(await page.getByRole('textbox', { name: 'Сообщение для Jarvis' }).count(), 1);
      await page.evaluate(() => window.__state('offline'));
      await page.getByRole('heading', { name: 'Нет соединения с облаком' }).waitFor();
      await page.evaluate(() => window.__state('connecting'));
      await page.getByRole('heading', { name: 'Подключаюсь к облаку' }).waitFor();
      await page.evaluate(() => window.__state('online'));
      const check = page.getByRole('button', { name: 'Проверить результат: сообщение', exact: true });
      await check.click();
      await page.getByText('Сообщение: сервер обрабатывает запрос.', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `pending-${width}.png`), fullPage: true, animations: 'disabled' });
      await page.evaluate(() => window.__status('completed'));
      await check.click();
      await page.getByText('Восстановленный ответ', { exact: true }).waitFor();
      await page.getByText(/файл из потерянного ответа восстановить нельзя/).waitFor();
      await page.getByRole('button', { name: '✅ Подтвердить', exact: true }).waitFor();
      await check.click();
      await page.waitForFunction(() => document.getElementById('pending-requests').hidden);
      assert.equal(await page.getByText('Восстановленный ответ', { exact: true }).count(), 1);
      assert.deepEqual(await page.evaluate(() => window.__calls), { send: 0, check: 3, ack: 2 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
      await page.screenshot({ path: path.join(output, `recovered-${width}.png`), fullPage: true, animations: 'disabled' });
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Desktop recovery browser fixtures passed at 1440x900 and 760x560; no POST resends, overflow or page errors.');
  } finally { await browser.close(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
