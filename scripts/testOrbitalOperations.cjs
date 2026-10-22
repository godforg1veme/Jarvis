// Real WebGL and the real Operations pages; all API traffic is synthetic.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require('../job-browser/node_modules/playwright');
const { responseFor, overview } = require('./fixtures/operationsPreview.cjs');
const base = 'http://127.0.0.1:5191/ops/';
const output = path.resolve(__dirname, '../.superpowers/orbital-operations');
const server = spawn(process.execPath, [path.resolve(__dirname, '../ops-ui/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5191', '--strictPort'], { cwd: path.resolve(__dirname, '../ops-ui'), windowsHide: true, stdio: 'ignore' });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser;
const scenario = { overview, overviewStatus: 200, profiles: null };

async function fixture(page) {
  await page.addInitScript(() => {
    class LocalStream extends EventTarget { constructor() { super(); window.fixtureStream = this; } close() {} }
    window.EventSource = LocalStream;
    const original = HTMLCanvasElement.prototype.getContext;
    window.sceneDraws = 0;
    HTMLCanvasElement.prototype.getContext = function (...args) {
      const context = original.apply(this, args);
      if (context && args[0] === 'webgl2' && !context.fixtureCounted) {
        context.fixtureCounted = true;
        for (const method of ['drawElements', 'drawArrays']) {
          const draw = context[method].bind(context);
          context[method] = (...values) => { window.sceneDraws++; return draw(...values); };
        }
      }
      return context;
    };
  });
  await page.route('**/ops/api/**', async (route) => {
    assert.equal(route.request().method(), 'GET', 'visual navigation must not mutate data');
    const api = new URL(route.request().url()).pathname.replace('/ops/api', '');
    if (api === '/overview') return route.fulfill({ status: scenario.overviewStatus, json: { ok: true, overview: scenario.overview } });
    if (api === '/connections' && scenario.profiles) return route.fulfill({ json: { ok: true, profiles: scenario.profiles } });
    const body = responseFor(api);
    return route.fulfill({ status: body ? 200 : 404, json: body ? { ok: true, ...body } : {} });
  });
}
async function noOverflow(page, label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `viewport overflow: ${label}`);
  assert.equal(await page.evaluate(() => { const main = document.querySelector('#workspace-content'); return !main || main.scrollWidth <= main.clientWidth + 1; }), true, `workspace overflow: ${label}`);
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Fixture Vite exited');
    try { ready = (await fetch(base)).ok; } catch {}
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready);
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await fixture(page);
  await page.goto(base);
  await page.locator('[data-scene-state="ready"]').waitFor();
  assert.equal(await page.locator('.orbital-header button').count(), 0, 'header contains search only');
  assert.equal(await page.locator('#orbital-navigation button').count(), 5, 'five compact navigation icons');
  assert.equal((await page.locator('#orbital-navigation').innerText()).trim(), '', 'dock has no text or decorative numbers');
  assert.ok(await page.evaluate(() => window.sceneDraws > 0), 'actual WebGL draw calls');
  assert.equal(await page.getByRole('main').count(), 0, 'overview starts with the system');
  await page.screenshot({ path: path.join(output, 'overview-desktop.png'), fullPage: true });
  const serviceLabel = await page.locator('.orbital-canvas [aria-hidden="true"] > div').filter({ hasText: /^Сервисы$/ }).boundingBox();
  const initialStage = await page.locator('.orbital-canvas').boundingBox();
  // At the initial reduced-motion composition the foreground service sphere is
  // below/left of the core. Its projected label is below the outer ring.
  const serviceDepth = Math.sin(3.89) * .56;
  const labelOffset = .66 * 2.15 * initialStage.height / (2 * Math.tan(23 * Math.PI / 180) * (10.4 - serviceDepth));
  await page.mouse.move(serviceLabel.x + serviceLabel.width / 2, serviceLabel.y - labelOffset);
  await page.getByRole('status').filter({ hasText: /^Сервисы$/ }).waitFor();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('status').filter({ hasText: /^Сервисы$/ }).waitFor({ state: 'detached', timeout: 12000 });
  await page.mouse.move(2, 2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  scenario.overview = { ...overview, status: 'degraded', services: overview.services.map((service, index) => index ? service : { ...service, state: 'unavailable' }) };
  await page.evaluate(() => window.fixtureStream.dispatchEvent(new Event('refresh')));
  await page.waitForFunction(() => document.querySelector('.orbital-footer').textContent.includes('3 из 4') && document.querySelector('.orbital-footer').textContent.includes('Требует внимания'));
  scenario.overviewStatus = 503;
  await page.evaluate(() => window.fixtureStream.dispatchEvent(new Event('refresh')));
  await page.waitForFunction(() => document.querySelector('.orbital-footer').textContent.includes('Нет связи'));
  scenario.overview = overview; scenario.overviewStatus = 200;
  await page.evaluate(() => window.fixtureStream.dispatchEvent(new Event('refresh')));
  await page.waitForFunction(() => document.querySelector('.orbital-footer').textContent.includes('4 из 4') && !document.querySelector('.orbital-footer').textContent.includes('Нет связи'));
  const stage = await page.locator('.orbital-canvas').boundingBox();
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.getByRole('status').filter({ hasText: 'Ядро' }).waitFor();
  await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.getByRole('heading', { name: 'Обзор', level: 1 }).waitFor();
  assert.match(page.url(), /#\/overview$/);
  await page.getByRole('button', { name: 'Закрыть рабочую область' }).click();
  await page.locator('[data-nav="services"]').click();
  await page.getByRole('heading', { name: 'Сервисы', level: 1 }).waitFor();
  const inspector = await page.locator('.orbital-workspace').boundingBox();
  assert.ok(inspector.width >= 380 && inspector.width <= 441, 'compact inspector width');
  assert.ok(inspector.height <= 781, 'inspector does not fill the whole screen');
  const main = page.locator('#workspace-content');
  await page.getByRole('button', { name: /Jarvis Server/ }).waitFor();
  await main.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForFunction(() => document.querySelector('#workspace-content').scrollTop > 0);
  const stickyTitle = await page.getByRole('heading', { name: 'Сервисы', level: 1 }).boundingBox();
  const mainBounds = await main.boundingBox();
  assert.ok(stickyTitle.y >= mainBounds.y && stickyTitle.y < mainBounds.y + 50, 'title remains visible while cards scroll');
  await main.evaluate((el) => { el.scrollTop = 0; });
  await page.mouse.move(2, 2);
  await page.screenshot({ path: path.join(output, 'services-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Расширить рабочую область' }).click();
  assert.equal(await page.locator('.orbital-app').evaluate((el) => el.classList.contains('is-expanded')), true);
  await page.getByRole('button', { name: 'Свернуть рабочую область' }).click();
  await page.getByRole('button', { name: 'Закрыть рабочую область' }).click();
  await page.locator('.orbital-workspace').waitFor({ state: 'detached' });
  await page.waitForFunction((width) => Math.abs(document.querySelector('.orbital-canvas').getBoundingClientRect().width - width) < 1, initialStage.width);
  await page.waitForFunction(() => Math.abs(document.querySelector('.orbital-canvas canvas').getBoundingClientRect().width - document.querySelector('.orbital-canvas').getBoundingClientRect().width) < 1);
  assert.ok(Math.abs((await page.locator('.orbital-canvas').boundingBox()).width - initialStage.width) < 1, 'closing inspector restores full scene width');
  await page.locator('[data-nav="activity"]').click();
  await page.getByRole('navigation', { name: 'Подразделы' }).getByRole('button', { name: 'События', exact: true }).click();
  await page.getByRole('heading', { name: 'События', level: 1 }).waitFor();
  await page.goBack();
  await page.getByRole('heading', { name: 'Инциденты', level: 1 }).waitFor();
  await page.getByRole('link', { name: 'Перейти к разделам' }).focus();
  await page.keyboard.press('Enter');
  assert.match(page.url(), /#\/incidents$/, 'skip link does not modify route');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'workspace-content');

  const search = page.getByRole('combobox', { name: 'Поиск по разделам' });
  await search.fill('резерв');
  await page.getByRole('option', { name: /Резервные копии/ }).waitFor();
  await search.press('Enter');
  await page.getByRole('heading', { name: 'Резервные копии', level: 1 }).waitFor();
  await search.fill('несуществующий раздел');
  await page.getByRole('status', { name: '' }).filter({ hasText: 'Раздел не найден' }).waitFor();
  await search.press('Escape');
  await search.fill('');
  await page.getByRole('heading', { name: 'Резервные копии', level: 1 }).waitFor();
  const owner = responseFor('/connections').profiles[0];
  scenario.profiles = [owner, { ...owner, id: 'demo-member', displayName: 'Участник', role: 'member', devices: [], telegram: [] }];
  await page.locator('[data-nav="connections"]').click();
  await page.locator('.row-action').last().click();
  await page.locator('.modal-backdrop').waitFor();
  await page.keyboard.press('Control+k');
  assert.equal(await search.evaluate((el) => el === document.activeElement), false, 'search shortcut does not escape reassignment');
  await page.locator('[data-nav="services"]').evaluate((el) => el.click());
  assert.match(page.url(), /#\/connections$/, 'modal protects pending reassignment against navigation');
  await page.locator('.modal-backdrop').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#root').inert && document.activeElement?.classList.contains('row-action'));
  let moves = 0;
  const deviceMoveUrl = '**/ops/api/connections/devices/demo-pc/reassign';
  await page.route(deviceMoveUrl, async (route) => {
    assert.equal(route.request().method(), 'POST');
    moves += 1;
    scenario.profiles = [{ ...owner, devices: [{ ...owner.devices[0], status: 'revoked' }] }, scenario.profiles[1]];
    return route.fulfill({ json: { reassignment: { code: 'SYNTHETIC-PAIR', expiresAt: '2026-10-21T20:00:00Z' } } });
  });
  await page.locator('.row-action').last().click();
  await page.getByLabel('Целевой профиль').selectOption('demo-member');
  await page.locator('.modal-backdrop').getByRole('button', { name: 'Переназначить', exact: true }).click();
  await page.getByText('SYNTHETIC-PAIR', { exact: true }).waitFor();
  await page.getByText('Отключено', { exact: true }).waitFor();
  assert.equal(moves, 1);
  await page.locator('.modal-backdrop').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#root').inert && document.activeElement?.id === 'workspace-content');
  await page.unroute(deviceMoveUrl);
  scenario.profiles = null;

  await page.evaluate(() => { location.hash = '/infrastructure'; });
  await page.locator('.metric-grid').first().waitFor();
  assert.equal(await page.locator('.metric-card:visible').count(), 4, 'four primary metrics are shown by default');
  const extraMetrics = page.locator('.additional-metrics');
  await extraMetrics.locator('summary').focus();
  await page.keyboard.press('Enter');
  assert.equal(await extraMetrics.evaluate((element) => element.open), true, 'extra metrics open from keyboard');
  assert.equal(await page.locator('.metric-card:visible').count(), 11);
  await extraMetrics.locator('summary').click();
  assert.equal(await page.locator('.metric-card:visible').count(), 4);

  const pages = ['overview', 'infrastructure', 'services', 'connections', 'parser', 'incidents', 'events', 'backups', 'sessions'];
  const headings = ['Обзор', 'Инфраструктура', 'Сервисы', 'Устройства', 'Telegram Parser', 'Инциденты', 'События', 'Резервные копии', 'Сессии'];
  for (const width of [1440, 662, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 960 : 844 });
    for (const key of pages) {
      await page.evaluate((key) => { location.hash = `/${key}`; }, key);
      await page.locator('#workspace-content').getByRole('heading', { name: headings[pages.indexOf(key)], exact: true, level: 1 }).waitFor();
      await noOverflow(page, `${width}/${key}`);
      if (width <= 900) {
        const bounds = await page.evaluate(() => {
          const workspace = document.querySelector('.orbital-workspace').getBoundingClientRect();
          const dock = document.querySelector('.orbital-navigation').getBoundingClientRect();
          return { panelBottom: workspace.bottom, dockTop: dock.top, dockBottom: dock.bottom, viewport: innerHeight, pageHeight: document.documentElement.scrollHeight };
        });
        assert.ok(bounds.panelBottom <= bounds.dockTop, `dock does not cover reading area: ${width}/${key}`);
        assert.ok(bounds.dockBottom <= bounds.viewport, `dock stays within viewport: ${width}/${key}`);
        assert.ok(bounds.pageHeight <= bounds.viewport + 1, `one internal mobile scroller: ${width}/${key}`);
      }
      if (key === 'overview' || key === 'infrastructure') await page.screenshot({ path: path.join(output, `${key}-${width}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: 'Закрыть рабочую область' }).click();
    await page.locator('.orbital-workspace').waitFor({ state: 'detached' });
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.orbital-canvas canvas'), stage = document.querySelector('.orbital-canvas');
      return canvas && stage && Math.abs(canvas.getBoundingClientRect().height - stage.getBoundingClientRect().height) < 1;
    });
    await noOverflow(page, `${width}/system`);
    if (width === 390) await page.screenshot({ path: path.join(output, 'overview-mobile.png'), fullPage: true });
    if (width < 900) {
      await page.locator('[data-nav="services"]').click();
      await page.waitForFunction(() => {
        const top = document.querySelector('.orbital-workspace')?.getBoundingClientRect().top;
        return top >= -1 && top < innerHeight / 3;
      }, undefined, { timeout: 3000 });
      await page.getByRole('button', { name: 'Закрыть рабочую область' }).click();
    }
    console.log(`PASS orbital workspace: nine sections and system at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const movingLabel = page.locator('.orbital-canvas [aria-hidden="true"] > div').filter({ hasText: /^Инфраструктура$/ });
  const beforeMotion = await movingLabel.getAttribute('style');
  await delay(400);
  assert.notEqual(await movingLabel.getAttribute('style'), beforeMotion, 'planet and its projected label really move along the orbit');
  await page.getByRole('button', { name: 'Приостановить анимацию' }).click();
  // Let the preceding resize/camera transition settle; pause stops idle motion.
  let pausedDraws = await page.evaluate(() => window.sceneDraws);
  let settled = false;
  for (let attempt = 0; attempt < 25; attempt++) {
    await delay(200);
    const current = await page.evaluate(() => window.sceneDraws);
    if (current === pausedDraws) { settled = true; break; }
    pausedDraws = current;
  }
  assert.ok(settled, 'pause stops drawing after the camera transition');
  await page.getByRole('button', { name: 'Продолжить анимацию' }).click();
  await page.waitForFunction((previous) => window.sceneDraws > previous, pausedDraws);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await delay(200);
  const hiddenDraws = await page.evaluate(() => window.sceneDraws);
  await delay(200);
  assert.equal(await page.evaluate(() => window.sceneDraws), hiddenDraws, 'hidden tab stops idle rendering');
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  // Hide while a navigation camera transition is still in progress. Previously
  // its convergence kept the demand loop alive even though orbital motion froze.
  await page.locator('[data-nav="services"]').click();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await delay(200);
  const transitionHiddenDraws = await page.evaluate(() => window.sceneDraws);
  await delay(250);
  assert.equal(await page.evaluate(() => window.sceneDraws), transitionHiddenDraws, 'hidden tab stops an unfinished camera transition');
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction((previous) => window.sceneDraws > previous, transitionHiddenDraws);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await delay(200);
  const reducedDraws = await page.evaluate(() => window.sceneDraws);
  await delay(250);
  assert.equal(await page.evaluate(() => window.sceneDraws), reducedDraws, 'reduced motion stops idle drawing');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('[data-nav="services"]').click();
  await page.getByRole('heading', { name: 'Сервисы', level: 1 }).waitFor();
  await page.getByRole('button', { name: 'Закрыть рабочую область' }).click();
  await page.locator('.orbital-workspace.is-closing').waitFor();
  assert.equal(await page.locator('.orbital-workspace').getAttribute('inert'), '', 'closing workspace is inert during exit');
  await page.locator('.orbital-workspace').waitFor({ state: 'detached' });
  await page.evaluate(() => document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await page.locator('[data-scene-state="fallback"]').waitFor();
  await page.locator('[data-nav="connections"]').click();
  await page.getByRole('heading', { name: 'Устройства', level: 1 }).waitFor();
  await noOverflow(page, 'fallback');
  assert.deepEqual(errors, []);
  console.log('PASS real WebGL, orbital movement, stationary hover, search, five-icon dock, sliding workspace, modal guard, history, summary, mobile focus, pause, hidden tab, reduced motion and fallback');
  await page.close();
  const fallback = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const fallbackErrors = [];
  fallback.on('pageerror', (error) => fallbackErrors.push(error.message));
  await fixture(fallback);
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
      return kind.startsWith('webgl') ? null : original.call(this, kind, ...rest);
    };
  });
  await fallback.goto(base);
  await fallback.locator('[data-scene-state="fallback"]').waitFor();
  await fallback.locator('[data-nav="services"]').click();
  await fallback.getByRole('heading', { name: 'Сервисы', level: 1 }).waitFor();
  await noOverflow(fallback, 'startup WebGL fallback');
  assert.deepEqual(fallbackErrors, []);
  await fallback.close();
  console.log('PASS navigation with WebGL unavailable at startup');
  const noSky = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const noSkyErrors = []; let skyRequested = false;
  noSky.on('pageerror', (error) => noSkyErrors.push(error.message));
  await fixture(noSky);
  await noSky.route('**/assets/milky-way-reference-narrow.webp', async (route) => { skyRequested = true; await route.fulfill({ status: 404, body: '' }); });
  await noSky.goto(base);
  await noSky.locator('[data-scene-state="ready"]').waitFor();
  await noSky.waitForFunction(() => window.sceneDraws > 0);
  assert.ok(skyRequested, 'approved texture was requested');
  await noSky.locator('[data-nav="services"]').click();
  await noSky.getByRole('heading', { name: 'Сервисы', level: 1 }).waitFor();
  await noOverflow(noSky, 'missing sky texture');
  assert.deepEqual(noSkyErrors, [], 'missing texture preserves scene and navigation');
  await noSky.close();
  console.log('PASS missing sky texture uses star fallback without breaking navigation');
  // A plain white texture makes coverage observable without relying on the
  // particular starfield pixels. A reduced-motion resize must not strand the
  // background at the previous camera zoom with no further frame scheduled.
  const coverPage = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  await fixture(coverPage);
  await coverPage.route('**/assets/milky-way-reference-narrow.webp', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect width="1536" height="1024" fill="white"/></svg>' }));
  await coverPage.goto(base);
  await coverPage.locator('[data-scene-state="ready"]').waitFor();
  await delay(300);
  for (const width of [320, 1440]) {
    await coverPage.setViewportSize({ width, height: width === 320 ? 844 : 960 });
    await delay(300);
    const png = (await coverPage.locator('canvas').screenshot()).toString('base64');
    const corners = await coverPage.evaluate(async (encoded) => {
      const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return [[5, 5], [image.width - 6, 5], [5, image.height - 6], [image.width - 6, image.height - 6]].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3));
    }, png);
    assert.ok(corners.every((pixel) => pixel.every((channel) => channel > 160)), `sky covers all canvas corners after reduced-motion resize to ${width}px: ${JSON.stringify(corners)}`);
  }
  await coverPage.close();
  console.log('PASS sky coverage after reduced-motion desktop/mobile resize');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  server.kill();
});

