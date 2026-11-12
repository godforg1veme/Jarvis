const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('../job-browser/node_modules/playwright')); }
catch { ({ chromium } = require('playwright')); }
const { desktopWorkspaceFixture } = require('./fixtures/desktopWorkspaceFixture');
const { prepareDesktopWorkspace } = require('./prepareDesktopWorkspace');

const root = path.resolve(__dirname, '..');
const screenshots = path.join(root, 'build', 'desktop-workspace-screenshots');
fs.mkdirSync(screenshots, { recursive: true });
prepareDesktopWorkspace();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let file; try { file = path.resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname)}`); } catch { res.writeHead(400).end(); return; }
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, bytes) => { if (error) { res.writeHead(404).end('missing'); return; } res.setHeader('content-type', mime[path.extname(file)] || 'application/octet-stream'); res.end(bytes); });
});
const failures = [];
const check = (name, fn) => fn().then(() => console.log(`PASS ${name}`)).catch((e) => { failures.push(`${name}: ${e.stack || e}`); console.error(`FAIL ${name}: ${e.message}`); });
async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  const notFound = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(6000);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('response', (response) => { if (response.status() === 404) notFound.push(response.url()); });
  await page.addInitScript(desktopWorkspaceFixture.toString() + `; desktopWorkspaceFixture(${JSON.stringify({ paired: true })});`);
  await page.goto(`http://127.0.0.1:${server.address().port}/renderer/cloud-chat/index.html`);
  await page.waitForSelector('#desktop-page-content', { state: 'attached' }); await page.waitForTimeout(300);
  await check('Home animation controls + no WebGL crash', async () => {
    await page.click('[data-desktop-page="home"]');
    assert.equal(await page.locator('#desktop-home').isVisible(), true);
    await page.screenshot({ path: path.join(screenshots, 'home-1440x900.png') });
    await page.click('[data-desktop-page="settings"]'); await page.getByRole('button', { name: 'Приостановить анимацию' }).click();
    assert.equal(await page.locator('body').getAttribute('data-scene-paused'), 'true');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(errors.filter((x) => /WebGL|shader|context/i.test(x)).length, 0);
  });
  await check('Assistant text, error recovery, history deduplication and scope', async () => {
    await page.click('[data-desktop-page="assistant"]');
    await page.locator('#message-input').fill('Проверка ответа'); await page.locator('#message-form button[type="submit"]').click();
    await page.getByText('Ответ: Проверка ответа').waitFor();
    await page.getByRole('button', { name: 'История Mini App' }).click(); await page.waitForTimeout(120);
    await page.locator('#desktop-page-content').getByText('Ответ из истории').waitFor(); assert.equal(await page.locator('#desktop-page-content').getByText('Старое сообщение').count(), 1);
    assert.equal(await page.locator('#desktop-page-content').getByText('Дубликат').count(), 0);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#desktop-chat-panel').isVisible(), true);
    await page.screenshot({ path: path.join(screenshots, 'assistant-1440x900.png') });
  });
  for (const section of ['memory', 'documents', 'jobs', 'devices', 'operations']) {
    await check(`Navigation and populated ${section}`, async () => {
      await page.click(`[data-desktop-page="${section}"]`); await page.waitForTimeout(300);
      assert.equal(await page.locator('#desktop-workspace').isVisible(), true);
      assert.equal(await page.locator('[aria-current="page"]').getAttribute('data-desktop-page'), section);
      await page.screenshot({ path: path.join(screenshots, `${section}-1440x900.png`) });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${section} horizontal overflow`);
    });
  }
  await check('Memory add preview and confirmation use one operation', async () => {
    await page.click('[data-desktop-page="memory"]'); await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Добавить запись' }).click();
    await page.locator('#memory-content').fill('User prefers concise answers');
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.getByRole('button', { name: 'Подтвердить сохранение' }).click();
    await page.waitForFunction(() => window.__workspaceCalls.some((x) => x.path === '/memory/operations' && x.method === 'POST'));
    const submitted = await page.evaluate(() => window.__workspaceCalls.filter((x) => x.path === '/memory/operations' && x.method === 'POST'));
    assert.equal(submitted.length, 1); assert.equal(submitted[0].body.content, 'User prefers concise answers');
  });
  await check('Documents upload limit and confirmation path', async () => {
    await page.click('[data-desktop-page="documents"]'); await page.waitForTimeout(160);
    await page.getByRole('button', { name: 'Добавить документ' }).click();
    const file = page.locator('#personal-file');
    await file.setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture note') });
    await page.locator('.personal-actions__form button[type="submit"]').click();
    await page.getByRole('button', { name: 'Подтвердить' }).click();
    await page.waitForFunction(() => window.__workspaceCalls.some((x) => x.path === 'upload'));
    assert.equal(await page.evaluate(() => window.__workspaceCalls.filter((x) => x.path === 'upload').length), 1);
    await page.getByRole('button', { name: 'Добавить документ' }).click();
    await page.locator('#personal-file').setInputFiles({ name: 'too-large.txt', mimeType: 'text/plain', buffer: Buffer.alloc(21 * 1024 * 1024) });
    await page.locator('.personal-actions__form button[type="submit"]').click();
    assert.match(await page.locator('.personal-actions__status').innerText(), /допустимом размере/i);
  });
  await check('Device pairing requires review and invokes one operation', async () => {
    await page.click('[data-desktop-page="devices"]'); await page.waitForTimeout(150);
    await page.getByRole('button', { name: 'Подключить устройство' }).click();
    await page.locator('#personal-name').fill('Test device');
    await page.locator('.personal-actions__form button[type="submit"]').click();
    await page.getByRole('button', { name: 'Подтвердить' }).click();
    await page.waitForFunction(() => window.__workspaceCalls.some((x) => x.path === '/sections/devices/operations' && x.method === 'POST'));
    const ops = await page.evaluate(() => window.__workspaceCalls.filter((x) => x.path === '/sections/devices/operations' && x.method === 'POST'));
    assert.equal(ops.length, 1); assert.equal(ops[0].body.input.name, 'Test device');
  });
  await check('Settings voice bridge and motion toggle', async () => {
    await page.click('[data-desktop-page="settings"]'); await page.getByRole('button', { name: 'Настроить голос' }).click();
    assert(await page.evaluate(() => window.__workspaceCalls.some((x) => x.path === 'openVoiceSettings')));
    await page.getByLabel('Подавление шума', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__workspaceCalls.find((x) => x.path === 'saveVoiceSettings').body.noiseSuppression), false);
    await page.getByRole('button', { name: 'Продолжить анимацию' }).click();
    assert.equal(await page.locator('body').getAttribute('data-scene-paused'), 'false');
    await page.getByRole('button', { name: 'VPN' }).click();
  });
  await check('Life OS dialog open and Escape close', async () => {
    await page.click('[data-desktop-page="life"]'); await page.waitForTimeout(250);
    assert.equal(await page.locator('#life-os').evaluate((el) => el.classList.contains('is-open')), true);
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    assert.equal(await page.locator('#life-os').evaluate((el) => el.classList.contains('is-open')), false);
  });
  await check('Keyboard focus and compact viewport no overflow', async () => {
    await page.setViewportSize({ width: 760, height: 560 });
    for (const section of ['assistant', 'memory', 'documents', 'jobs', 'devices', 'operations', 'settings']) {
      await page.click(`[data-desktop-page="${section}"]`); await page.waitForTimeout(80);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${section} horizontal overflow at 760`);
    }
    await page.keyboard.press('Tab'); assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), 'BODY');
  });
  await check('HH resume changes require preview; automation and refresh keep revisions and IDs', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('[data-desktop-page="jobs"]');
    await page.getByRole('checkbox', { name: 'Автоподнятие выбранного резюме', exact: true }).check();
    await page.getByRole('button', { name: 'Проверить изменения', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__workspaceCalls.filter((c) => c.path === '/jobs/resumes/settings' && c.method === 'POST').length), 0);
    await page.locator('.job-resume-confirm').getByRole('button', { name: 'Подтвердить', exact: true }).click();
    await page.waitForFunction(() => window.__workspaceCalls.some((c) => c.path === '/jobs/resumes/settings' && c.method === 'POST'));
    const mutation = await page.evaluate(() => window.__workspaceCalls.find((c) => c.path === '/jobs/resumes/settings' && c.method === 'POST'));
    assert.equal(mutation.body.autoRaiseEnabled, true); assert.equal(mutation.body.expectedRevision, 1);
    assert.match(mutation.body.requestId, /^[a-f0-9-]{36}$/);
    await page.getByRole('button', { name: 'Обновить из HH', exact: true }).click();
    await page.waitForFunction(() => window.__workspaceCalls.some((c) => c.path === '/jobs/resumes/refresh' && c.method === 'POST'));
    await page.getByRole('button', { name: 'Включить автопоиск и автоотклики', exact: true }).click();
    await page.waitForFunction(() => window.__workspaceCalls.some((c) => c.path === '/jobs/automation' && c.method === 'POST'));
    const automation = await page.evaluate(() => window.__workspaceCalls.find((c) => c.path === '/jobs/automation' && c.method === 'POST'));
    assert.deepEqual(automation.body, { enabled: true, expectedRevision: 1 });
  });
  await check('Cancel, delete and revoke preserve reviewed target and revision', async () => {
    for (const section of ['documents', 'devices']) {
      await page.click(`[data-desktop-page="${section}"]`);
      await page.locator('.section-card__summary').first().click();
      const label = section === 'documents' ? 'Удалить документ' : 'Отключить устройство';
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.getByRole('button', { name: 'Отмена', exact: true }).click();
      assert.equal(await page.locator('.personal-actions__form').isVisible(), false);
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.locator('.personal-actions__form button[type="submit"]').click();
      await page.getByRole('button', { name: section === 'documents' ? 'Подтвердить удаление' : 'Подтвердить отключение', exact: true }).click();
      const mutation = await page.evaluate((key) => window.__workspaceCalls.filter((c) => c.path === `/sections/${key}/operations` && c.method === 'POST').at(-1), section);
      assert.equal(mutation.body.kind, section === 'documents' ? 'delete' : 'revoke');
      assert.equal(mutation.body.revision, 1); assert.match(mutation.body.targetId, /^[a-f0-9-]{36}$/);
    }
  });
  await check('Unknown memory response reconciles the original ID and never repeats POST', async () => {
    await page.evaluate(() => { window.__workspaceOverrides['POST /memory/operations'] = { ok: false, code: 'unknown', uncertain: true }; });
    await page.click('[data-desktop-page="memory"]');
    await page.getByRole('button', { name: 'Добавить запись', exact: true }).click();
    await page.locator('#memory-content').fill('Unknown test');
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await page.getByRole('button', { name: 'Подтвердить сохранение', exact: true }).click();
    await page.getByRole('button', { name: 'Проверить исходную операцию', exact: true }).waitFor();
    const operations = await page.evaluate(() => window.__workspaceCalls.filter((c) => c.path === '/memory/operations' && c.method === 'POST'));
    await page.getByRole('button', { name: 'Проверить исходную операцию', exact: true }).click();
    await page.waitForFunction(() => window.__workspaceCalls.some((c) => /\/memory\/operations\//.test(c.path) && c.method === 'GET'));
    const reads = await page.evaluate(() => window.__workspaceCalls.filter((c) => /\/memory\/operations\//.test(c.path) && c.method === 'GET'));
    assert.equal(reads.at(-1).path, `/memory/operations/${operations.at(-1).body.operationId}`);
    assert.equal(await page.evaluate(() => window.__workspaceCalls.filter((c) => c.path === '/memory/operations' && c.method === 'POST').length), operations.length);
    await page.evaluate(() => { delete window.__workspaceOverrides['POST /memory/operations']; });
  });
  await check('Forbidden and delayed section results cannot expose a stale section', async () => {
    await page.evaluate(() => { window.__workspaceOverrides['GET /sections/memory'] = { ok: false, code: 'forbidden' }; });
    await page.click('[data-desktop-page="memory"]');
    await page.getByText('Доступ к разделу закрыт.', { exact: true }).waitFor();
    assert.equal(await page.locator('.section-card').count(), 0);
    await page.evaluate(() => {
      window.__workspaceOverrides['GET /sections/memory'] = () => new Promise((resolve) => { window.__releaseWorkspace = () => resolve({ ok: true, items: [{ id: 'stale', title: 'Stale private row' }] }); });
    });
    await page.click('[data-desktop-page="memory"]');
    await page.waitForFunction(() => typeof window.__releaseWorkspace === 'function');
    await page.click('[data-desktop-page="documents"]');
    await page.getByRole('button', { name: 'Добавить документ', exact: true }).waitFor();
    await page.evaluate(() => window.__releaseWorkspace());
    await page.waitForTimeout(50);
    assert.equal(await page.getByText('Stale private row', { exact: true }).count(), 0);
    await page.evaluate(() => { delete window.__workspaceOverrides['GET /sections/memory']; });
  });
  await check('Operations and VPN open explicit handoffs; changing device scope clears private UI', async () => {
    await page.click('[data-desktop-page="operations"]');
    await page.getByRole('link', { name: 'Открыть Operations', exact: true }).click();
    await page.waitForFunction(() => window.__openedLinks.includes('https://jarvis.fixture.invalid/ops/'));
    await page.click('[data-desktop-page="settings"]');
    await page.getByRole('button', { name: 'VPN', exact: true }).click();
    await page.getByRole('link', { name: 'Открыть «VPN» в боте', exact: true }).click();
    await page.waitForFunction(() => window.__openedLinks.includes('https://t.me/jarvis_fixture_bot?start=mini_vpn'));
    await page.click('[data-desktop-page="assistant"]');
    await page.locator('#message-input').fill('Private scope test'); await page.locator('#send-button').click();
    await page.getByText('Ответ: Private scope test', { exact: true }).waitFor();
    await page.click('[data-desktop-page="memory"]');
    await page.locator('.section-card').first().waitFor();
    await page.evaluate(() => window.__emitState({ paired: false, deviceId: '' }));
    await page.getByText('Подключите Desktop, чтобы открыть раздел.', { exact: true }).waitFor();
    assert.equal(await page.locator('.section-card').count(), 0);
    assert.equal(await page.getByText('Ответ: Private scope test', { exact: true }).count(), 0);
  });
  await check('No browser runtime errors (404 list included on failure)', async () => { assert.deepEqual(notFound, [], JSON.stringify(notFound)); assert.deepEqual(errors, []); });
  await browser.close(); server.close();
  if (failures.length) { console.error(`\n${failures.length} scenario(s) failed.`); process.exitCode = 1; }
  else console.log(`\nAll browser scenarios passed. Screenshots: ${path.relative(root, screenshots)}`);
}
main().catch((error) => { console.error(error); server.close(); process.exitCode = 1; });
