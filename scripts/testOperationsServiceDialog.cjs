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
(async () => {
  await ready();
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  const page = await browser.newPage();
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
  await alpha.focus(); await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Service alpha', exact: true });
  await drawer.waitFor();
  assert.equal(await drawer.evaluate((element) => element.contains(document.activeElement)), true, 'focus enters service dialog');
  await alpha.evaluate((element) => element.focus());
  assert.equal(await alpha.evaluate((element) => element === document.activeElement), false, 'modal background is inert even to programmatic focus');
  for (let i = 0; i < 16; i += 1) {
    await page.keyboard.press(i < 8 ? 'Tab' : 'Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement === document.body || Boolean(document.activeElement.closest('dialog[open]'))), true, 'background cannot receive keyboard focus');
  }
  await drawer.getByRole('button', { name: 'RESTART', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: /RESTART \/ Service alpha/ });
  await confirmation.waitFor();
  assert.equal(await confirmation.getByRole('button', { name: 'Отмена' }).evaluate((el) => el === document.activeElement), true, 'safe confirmation choice receives focus');
  await drawer.getByRole('button', { name: 'RESTART', exact: true }).evaluate((element) => element.focus());
  assert.equal(await confirmation.evaluate((element) => element.contains(document.activeElement)), true, 'underlying drawer becomes inert during confirmation');
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press(i < 4 ? 'Tab' : 'Shift+Tab');
    assert.equal(await confirmation.evaluate((el) => document.activeElement === document.body || el.contains(document.activeElement)), true, 'confirmation excludes underlying drawer controls');
  }
  await page.keyboard.press('Escape');
  await confirmation.waitFor({ state: 'detached' });
  assert.equal(await drawer.getByRole('button', { name: 'RESTART', exact: true }).evaluate((el) => el === document.activeElement), true, 'focus returns to confirmation trigger');
  await page.keyboard.press('Escape'); await drawer.waitFor({ state: 'detached' });
  assert.equal(await alpha.evaluate((el) => el === document.activeElement), true, 'focus returns to service trigger');
  await alpha.click(); await drawer.waitFor();
  releaseLogs();
  await page.waitForTimeout(50);
  assert.equal(await drawer.locator('pre').innerText(), 'alpha current log', 'old logs cannot overwrite reopened same service');
  await page.keyboard.press('Escape');
  await beta.click();
  const betaDrawer = page.getByRole('dialog', { name: 'Service beta', exact: true });
  await betaDrawer.waitFor();
  releaseLogs();
  await page.waitForTimeout(50);
  assert.match(await betaDrawer.locator('pre').innerText(), /beta log/);
  assert.doesNotMatch(await betaDrawer.innerText(), /alpha delayed log/);
  await betaDrawer.getByRole('button', { name: 'STOP', exact: true }).click();
  const stopConfirmation = page.getByRole('dialog', { name: /STOP \/ Service beta/ });
  await stopConfirmation.getByRole('button', { name: 'Выполнить' }).click();
  await page.waitForFunction(() => document.querySelector('.operation-state')?.textContent.includes('выполняется'));
  assert.equal(actionCount, 1);
  assert.equal(await betaDrawer.getByRole('button', { name: 'STOP', exact: true }).isDisabled(), true);
  assert.equal(await betaDrawer.getByRole('button', { name: 'ЗАКРЫТЬ ×' }).evaluate((el) => document.activeElement === el), true, 'pending action returns focus to enabled close control');
  await page.keyboard.press('Escape'); await betaDrawer.waitFor({ state: 'detached' });
  await alpha.click(); await drawer.waitFor();
  releaseAction();
  await page.waitForTimeout(75);
  assert.doesNotMatch(await drawer.innerText(), /операция успешно завершена/);
  assert.equal(actionCount, 1, 'close and reopen never repeats mutation');
  await page.keyboard.press('Escape');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 740 });
    await beta.click(); await betaDrawer.waitFor();
    const box = await betaDrawer.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, 'drawer fits mobile viewport');
    await betaDrawer.getByRole('button', { name: 'STOP', exact: true }).click();
    await stopConfirmation.waitFor();
    const confirmationBox = await stopConfirmation.boundingBox();
    assert.ok(confirmationBox.x >= 0 && confirmationBox.x + confirmationBox.width <= width, 'confirmation fits mobile viewport');
    await stopConfirmation.getByRole('button', { name: 'Отмена' }).click();
    await betaDrawer.getByRole('button', { name: 'ЗАКРЫТЬ ×' }).click();
    assert.equal(await beta.evaluate((el) => document.activeElement === el), true);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: modal semantics, focus, nested Escape, return focus, stale logs/action and single submission');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  vite.kill();
});
