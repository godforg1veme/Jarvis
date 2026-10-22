// Synthetic local API only. Starts and stops its own Vite process.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../job-browser/node_modules/playwright');
const port = 5292;
const base = `http://127.0.0.1:${port}/ops/`;
const services = ['alpha', 'beta'].map((key) => ({ key, name: `Service ${key}`, state: 'healthy', observedAt: null, capabilities: ['restart', 'stop'] }));
const vite = spawn(process.execPath, [path.resolve(__dirname, '../ops-ui/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: path.resolve(__dirname, '../ops-ui'), windowsHide: true, stdio: 'ignore' });
let browser;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function ready() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (vite.exitCode !== null) throw new Error('Local fixture server exited');
    try { if ((await fetch(base)).ok) return; } catch {}
    await delay(100);
  }
  throw new Error('Local fixture server did not start');
}
async function assertModalFocus(page, dialog, background, label) {
  assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement)), true, `${label}: focus enters dialog`);
  await background.evaluate((el) => el.focus());
  assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement)), true, `${label}: background is inert`);
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press(i < 6 ? 'Tab' : 'Shift+Tab');
    assert.equal(await dialog.evaluate((el) => document.activeElement === document.body || el.contains(document.activeElement)), true, `${label}: Tab stays in dialog`);
  }
}
(async () => {
  await ready();
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  let releaseLogs; let releaseAction; let actionCount = 0; let alphaLogsCount = 0;
  await page.route('**/ops/api/**', async (route) => {
    const api = new URL(route.request().url()).pathname.replace('/ops/api', '');
    if (api === '/overview') return route.fulfill({ json: { overview: { host_key: 'fixture', label: 'Fixture', status: 'healthy', last_contact_at: null, services } } });
    if (api === '/services') return route.fulfill({ json: { services } });
    if (api === '/services/alpha/logs') {
      alphaLogsCount += 1;
      if (alphaLogsCount > 1) return route.fulfill({ json: { state: 'succeeded', logs: ['alpha current log'] } });
      await new Promise((resolve) => { releaseLogs = resolve; });
      return route.fulfill({ json: { state: 'succeeded', logs: ['alpha delayed log'] } });
    }
    if (api.includes('/logs')) return route.fulfill({ json: { state: 'succeeded', logs: ['beta log'] } });
    if (api.includes('/actions/')) {
      actionCount += 1;
      await new Promise((resolve) => { releaseAction = resolve; });
      return route.fulfill({ json: { operation: { id: 'fixture-operation', status: 'succeeded' } } });
    }
    if (api === '/stream') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
    return route.fulfill({ json: {} });
  });
  await page.goto(`${base}#/services`);
  const alpha = page.getByRole('button', { name: /Service alpha/ });
  const beta = page.getByRole('button', { name: /Service beta/ });
  await alpha.waitFor();
  assert.equal(await alpha.getAttribute('aria-expanded'), 'true', 'first service expands by default');

  await alpha.focus(); await page.keyboard.press('Enter');
  assert.equal(await alpha.getAttribute('aria-expanded'), 'false', 'Enter collapses accordion');
  await page.keyboard.press('Enter');
  assert.equal(await alpha.getAttribute('aria-expanded'), 'true', 'Enter reopens accordion');
  await page.getByRole('button', { name: 'Перезапустить' }).click();
  const confirmation = page.getByRole('dialog', { name: /Перезапустить \/ Service alpha/ });
  await confirmation.waitFor();
  assert.equal(await confirmation.getByRole('button', { name: 'Отмена' }).evaluate((el) => el === document.activeElement), true, 'safe choice receives focus');
  await assertModalFocus(page, confirmation, alpha, 'confirmation');
  await page.keyboard.press('Escape');
  await confirmation.waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('button', { name: 'Перезапустить' }).evaluate((el) => el === document.activeElement), true, 'cancel restores command focus');

  const alphaLogs = page.getByRole('dialog', { name: 'Service alpha', exact: true });
  await page.getByRole('button', { name: /Логи Просмотр логов сервиса/ }).click();
  await alphaLogs.waitFor();
  await assertModalFocus(page, alphaLogs, alpha, 'logs');
  await page.keyboard.press('Escape'); await alphaLogs.waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('button', { name: /Логи Просмотр логов сервиса/ }).evaluate((el) => el === document.activeElement), true, 'logs restore opener focus');
  await page.getByRole('button', { name: /Логи Просмотр логов сервиса/ }).click();
  await alphaLogs.waitFor();
  await page.waitForFunction(() => document.querySelector('dialog.service-logs-dialog pre')?.textContent.includes('alpha current log'));
  releaseLogs(); await delay(75);
  assert.equal(await alphaLogs.locator('pre').innerText(), 'alpha current log', 'delayed prior response cannot replace reopened logs');
  await page.keyboard.press('Escape'); await alphaLogs.waitFor({ state: 'detached' });

  await page.getByRole('button', { name: 'Остановить', exact: true }).click();
  const stopConfirmation = page.getByRole('dialog', { name: /Остановить \/ Service alpha/ });
  await stopConfirmation.getByRole('button', { name: 'Выполнить' }).click();
  await page.waitForFunction(() => document.querySelector('.service-accordion-result')?.textContent.includes('выполняется'));
  assert.equal(actionCount, 1, 'confirmation sends one request');
  assert.equal(await page.getByRole('button', { name: 'Остановить', exact: true }).isDisabled(), true, 'pending action locks command');
  assert.equal(await alpha.evaluate((el) => el === document.activeElement), true, 'submit restores focus to enabled accordion trigger');
  await beta.click();
  assert.equal(await beta.getAttribute('aria-expanded'), 'true', 'another service remains navigable while action waits');
  releaseAction();
  await page.waitForFunction(() => !document.querySelector('.service-accordion-actions button:disabled'));
  await alpha.click();
  assert.match(await page.locator('.service-accordion-item[data-service-key="alpha"] .service-accordion-result').innerText(), /Операция успешно завершена/, 'result persists after switching rows');
  assert.equal(actionCount, 1, 'row switch never repeats mutation');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 740 });
    await page.locator('.service-accordion-item[data-service-key="alpha"] .service-action-logs').click();
    await alphaLogs.waitFor();
    const logsBox = await alphaLogs.boundingBox();
    assert.ok(logsBox.x >= 0 && logsBox.x + logsBox.width <= width, 'logs dialog fits mobile viewport');
    await page.keyboard.press('Escape'); await alphaLogs.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Перезапустить' }).click();
    const box = await confirmation.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, 'confirmation fits mobile viewport');
    await page.keyboard.press('Escape'); await confirmation.waitFor({ state: 'detached' });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: accordion, native modal focus/inert/Tab/Escape, stale logs, pending result, single submission, mobile fit');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  vite.kill();
});
