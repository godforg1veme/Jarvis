// Browser acceptance checks for the authenticated orbital Mini App.
// All API traffic is served by the existing synthetic fixture in testMiniAppClient.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('../job-browser/node_modules/playwright');
const { fixture, server } = require('./testMiniAppClient.cjs');

const artifacts = path.resolve(__dirname, '../.superpowers/mini-app-orbital');
const planetKeys = ['assistant', 'memory', 'documents', 'devices', 'life', 'jobs'];
const findings = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function record(condition, message) { if (!condition) findings.push(message); }

async function waitForMotion(page, previous, timeout = 5000) {
  await page.waitForFunction((time) => {
    const stage = document.querySelector('#core-stage');
    return stage?.dataset.orbitTime && stage.dataset.orbitTime !== time;
  }, previous, { timeout });
}

async function snapshotMotion(page) {
  return page.locator('#core-stage').evaluate((stage) => ({
    time: stage.dataset.orbitTime,
    frames: stage.dataset.frames,
    positions: stage.dataset.orbitPositions,
  }));
}

async function assertFrozen(page, reason, { rendererStops = true } = {}) {
  await wait(180);
  const before = await snapshotMotion(page);
  await wait(260);
  const after = await snapshotMotion(page);
  assert.equal(after.time, before.time, `${reason}: orbit time stays fixed`);
  assert.equal(after.positions, before.positions, `${reason}: planet positions stay fixed`);
  if (rendererStops) assert.equal(after.frames, before.frames, `${reason}: renderer stops drawing`);
}

async function waitForStableFrames(page, timeout = 2500) {
  const started = Date.now();
  let previous = (await snapshotMotion(page)).frames;
  let stableSince = Date.now();
  while (Date.now() - started < timeout) {
    await wait(100);
    const current = (await snapshotMotion(page)).frames;
    if (current !== previous) { previous = current; stableSince = Date.now(); }
    else if (Date.now() - stableSince >= 350) return;
  }
  assert.fail(`renderer frame count did not settle within ${timeout}ms`);
}

async function assertResponsive(page, width) {
  await page.setViewportSize({ width, height: 844 });
  await page.waitForTimeout(100);
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    stage: document.querySelector('#core-stage').getBoundingClientRect().toJSON(),
    labels: [...document.querySelectorAll('.planet-target:not([hidden])')].map((element) => ({
      label: element.textContent.trim(),
      rect: element.getBoundingClientRect().toJSON(),
    })),
    controls: [...document.querySelectorAll('.motion-controls button, .motion-settings summary, #all-sections, .bottom-nav a, .module, .workspace-tools button, .workspace-tools a')]
      .filter((element) => !element.hidden && element.getClientRects().length)
      .map((element) => ({ name: element.getAttribute('aria-label') || element.textContent.trim(), rect: element.getBoundingClientRect().toJSON() })),
    search: document.querySelector('#section-search').getBoundingClientRect().toJSON(),
  }));
  record(layout.scroll <= layout.viewport, `${width}px: no horizontal page overflow (${layout.scroll}px > ${layout.viewport}px)`);
  for (const label of layout.labels) {
    record(label.rect.left >= layout.stage.left - 1 && label.rect.right <= layout.stage.right + 1,
      `${width}px: visible planet label "${label.label}" horizontal bounds ${Math.round(label.rect.left)}..${Math.round(label.rect.right)} stay within stage ${Math.round(layout.stage.left)}..${Math.round(layout.stage.right)}`);
    record(label.rect.top >= layout.stage.top - 1 && label.rect.bottom <= layout.stage.bottom + 1,
      `${width}px: visible planet label "${label.label}" vertical bounds ${Math.round(label.rect.top)}..${Math.round(label.rect.bottom)} stay within stage ${Math.round(layout.stage.top)}..${Math.round(layout.stage.bottom)}`);
  }
  for (const control of layout.controls) {
    record(control.rect.width >= 44 && control.rect.height >= 44,
      `${width}px: touch target "${control.name}" is at least 44×44 (${Math.round(control.rect.width)}×${Math.round(control.rect.height)})`);
  }
  record(layout.search.height >= 44, `${width}px: section search touch target is at least 44px high (${Math.round(layout.search.height)}px)`);
}

async function openFixture(browser, origin, options = {}, contextOptions = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...contextOptions });
  const fixtureState = await fixture(context, options);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security policy|refused to load|violates the following/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  await page.goto(`${origin}/mini/#home`, { waitUntil: 'networkidle' });
  await page.locator('#application:not([hidden])').waitFor();
  return { context, page, ...fixtureState, consoleErrors };
}

async function verifyOrbitalExperience(browser, origin) {
  const run = await openFixture(browser, origin);
  const { context, page, errors, external, consoleErrors } = run;
  try {
    const stage = page.locator('#core-stage');
    await page.waitForFunction(() => document.querySelector('#core-stage')?.dataset.render === 'webgl');
    await page.waitForFunction(() => Number(document.querySelector('#core-stage')?.dataset.frames) > 1);
    assert.equal(await stage.locator('.planet-target').count(), 6, 'owner receives six orbital destinations');
    const actualKeys = await stage.locator('.planet-target').evaluateAll((buttons) => buttons.map((button) => button.dataset.planet).sort());
    assert.deepEqual(actualKeys, [...planetKeys].sort(), 'planet destinations match the owner allowlist');
    await page.waitForFunction(() => {
      const image = document.querySelector('.mini-sky img');
      return image?.complete && image.naturalWidth > 0;
    }, null, { timeout: 5000 });

    await page.screenshot({ path: path.join(artifacts, 'home-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(artifacts, 'home-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });

    const moving = await snapshotMotion(page);
    assert.ok(moving.time && moving.positions && moving.frames, 'WebGL scene exposes orbit time, positions, and draw count');
    const positions = JSON.parse(moving.positions);
    assert.deepEqual(Object.keys(positions).sort(), [...planetKeys].sort(), 'position telemetry covers all authorized planets');
    await page.mouse.move(1, 1);
    await waitForMotion(page, moving.time);
    const advanced = await snapshotMotion(page);
    assert.notEqual(advanced.positions, moving.positions, 'planet positions change as they orbit');
    assert.ok(Number(advanced.frames) > Number(moving.frames), 'normal motion continues drawing frames');

    const hoveredPlanet = page.locator('#core-stage .planet-target:not([hidden])').first();
    await hoveredPlanet.waitFor({ state: 'visible', timeout: 10000 });
    const hoverBounds = await hoveredPlanet.boundingBox();
    assert.ok(hoverBounds, 'visible planet label has a hit target');
    await page.mouse.move(hoverBounds.x + hoverBounds.width / 2, hoverBounds.y + hoverBounds.height / 2);
    await page.waitForFunction(() => document.body.dataset.motion === 'paused');
    await assertFrozen(page, 'pointer over a planet pauses orbital motion', { rendererStops: false });
    await page.mouse.move(1, 1);
    await page.waitForFunction(() => document.body.dataset.motion === 'running');
    const target = page.getByRole('button', { name: 'Открыть раздел: Документы', exact: true });
    await page.waitForFunction(() => {
      const element = document.querySelector('#core-stage .planet-target[data-planet="documents"]');
      if (!element || element.hidden) return false;
      element.focus();
      return document.activeElement === element;
    }, null, { timeout: 10000 });
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-planet')), 'documents', 'keyboard focus reaches the Documents planet');
    await page.waitForFunction(() => document.body.dataset.motion === 'paused');
    await assertFrozen(page, 'keyboard focus on a planet pauses orbital motion', { rendererStops: false });
    await page.keyboard.press('Enter');
    await page.waitForURL('**/#section/documents');
    await page.locator('#workspace:not([hidden])').waitFor();
    assert.equal(await stage.getAttribute('data-render'), 'webgl', 'section keeps the WebGL scene in the document');
    await page.screenshot({ path: path.join(artifacts, 'section-mobile.png'), fullPage: true });
    await waitForStableFrames(page);
    await assertFrozen(page, 'opening a workspace pauses orbital rendering');
    await page.locator('#workspace-expand').click();
    assert.equal(await page.locator('#application').getAttribute('data-expanded'), 'true', 'expand opens the workspace');
    assert.equal(await page.locator('#workspace-expand').getAttribute('aria-pressed'), 'true', 'expand state is announced');
    await page.locator('#workspace-expand').click();
    assert.equal(await page.locator('#application').getAttribute('data-expanded'), 'false', 'second activation shrinks the workspace');
    await page.locator('#workspace-close').click();
    await page.waitForURL('**/#home');
    await page.locator('#workspace').waitFor({ state: 'hidden' });

    await page.waitForFunction(() => document.body.dataset.motion === 'running');
    await waitForMotion(page, (await snapshotMotion(page)).time);

    assert.equal(await page.locator('#pause, .motion-controls, .motion-settings').count(), 0, 'animation controls are absent');

    await assertResponsive(page, 320);
    await assertResponsive(page, 390);
    await assertResponsive(page, 844);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.mouse.move(1, 1);
    await assertResponsive(page, 1280);

    await page.locator('#section-search').fill('док');
    await page.locator('#modules:not([hidden])').waitFor();
    assert.deepEqual(await page.locator('#modules .module:not([hidden])').evaluateAll((items) => items.map((item) => item.dataset.module)), ['documents'], 'search reveals and filters the fallback section list');
    await page.locator('#section-search').fill('нет такого раздела');
    await page.getByText('Ничего не найдено. Попробуй другое название.', { exact: true }).waitFor();
    await page.locator('#section-search').fill('');
    await page.locator('#all-sections').click();
    await page.locator('#modules').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#all-sections').getAttribute('aria-expanded'), 'false', 'all-sections closes an open list');
    await page.locator('#all-sections').click();
    await page.locator('#modules:not([hidden])').waitFor();
    assert.equal(await page.locator('#all-sections').getAttribute('aria-expanded'), 'true', 'all-sections reopens the list');
    assert.equal(await page.locator('#modules .module:not([hidden])').count(), 8, 'all-sections lists every owner-permitted section');

    assert.deepEqual(errors, [], 'no uncaught browser exceptions');
    assert.deepEqual(consoleErrors, [], 'no Content Security Policy errors');
    assert.deepEqual(external, [], 'fixture run makes no real external API requests');
  } finally {
    await context.close();
  }
}

async function verifyMemberScope(browser, origin) {
  const run = await openFixture(browser, origin, { level: 'member' });
  const { context, page, errors, external, consoleErrors } = run;
  try {
    await page.waitForFunction(() => document.querySelector('#core-stage')?.dataset.render === 'webgl');
    const buttons = page.locator('#core-stage .planet-target');
    assert.equal(await buttons.count(), 1, 'member fixture creates exactly one permitted planet');
    assert.equal(await buttons.first().getAttribute('data-planet'), 'jobs', 'member fixture only exposes jobs');
    const modules = await page.locator('#modules .module').evaluateAll((items) => items.map((item) => item.dataset.module));
    assert.deepEqual(modules, ['jobs'], 'fallback list does not contain forbidden sections');
    await page.getByRole('button', { name: 'Открыть раздел: Поиск работы', exact: true }).click();
    await page.waitForURL('**/#section/jobs');
    await page.locator('#workspace:not([hidden])').waitFor();
    assert.deepEqual(errors, [], 'member flow has no uncaught browser exceptions');
    assert.deepEqual(consoleErrors, [], 'member flow has no Content Security Policy errors');
    assert.deepEqual(external, [], 'member fixture makes no real external API requests');
  } finally {
    await context.close();
  }
}

async function verifyReducedMotion(browser, origin) {
  const run = await openFixture(browser, origin, {}, { reducedMotion: 'reduce' });
  const { context, page, errors, external, consoleErrors } = run;
  try {
    await page.waitForFunction(() => document.querySelector('#core-stage')?.dataset.render === 'webgl');
    await page.waitForFunction(() => Number(document.querySelector('#core-stage')?.dataset.frames) > 0);
    await page.mouse.move(1, 1);
    await waitForMotion(page, (await snapshotMotion(page)).time);
    assert.equal(await page.locator('body').getAttribute('data-motion'), 'running');
    const skyAnimation = await page.locator('#sky-image').evaluate(el => getComputedStyle(el).animationName);
    assert.notEqual(skyAnimation, 'none', 'sky stays animated under system reduced motion as requested');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await waitForMotion(page, (await snapshotMotion(page)).time);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#core-stage')?.dataset.render === 'webgl');
    await waitForMotion(page, (await snapshotMotion(page)).time);
    assert.equal(await page.locator('#pause, .motion-controls').count(), 0);
    assert.deepEqual(errors, [], 'reduced-motion flow has no uncaught browser exceptions');
    assert.deepEqual(consoleErrors, [], 'reduced-motion flow has no Content Security Policy errors');
    assert.deepEqual(external, [], 'reduced-motion fixture makes no real external API requests');
  } finally {
    await context.close();
  }
}

async function verifyWebglFallback(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (['webgl', 'webgl2', 'experimental-webgl'].includes(String(type).toLowerCase())) return null;
      return getContext.call(this, type, ...args);
    };
  });
  const { errors, external } = await fixture(context);
  const consoleErrors = [];
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security policy|refused to load|violates the following/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  try {
    await page.goto(`${origin}/mini/#home`, { waitUntil: 'networkidle' });
    await page.locator('#application:not([hidden])').waitFor();
    await page.waitForFunction(() => document.querySelector('#core-stage')?.dataset.render === 'fallback');
    await page.locator('#modules:not([hidden])').waitFor();
    await page.locator('.core-fallback').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Документы', exact: false }).filter({ has: page.locator('strong', { hasText: 'Документы' }) }).click();
    await page.waitForURL('**/#section/documents');
    await page.locator('#workspace:not([hidden])').waitFor();
    assert.equal(await page.locator('#core-status').innerText(), 'СТАТИЧНЫЙ ВИД · 3D НЕДОСТУПНО', 'fallback explains the unavailable 3D scene');
    assert.deepEqual(errors, [], 'fallback has no uncaught browser exceptions');
    assert.deepEqual(consoleErrors, [], 'fallback has no Content Security Policy errors');
    assert.deepEqual(external, [], 'fallback fixture makes no real external API requests');
  } finally {
    await context.close();
  }
}

async function verifyTouchPanel(browser, origin) {
  const { context, page, errors } = await openFixture(browser, origin, {}, { hasTouch: true, isMobile: true, deviceScaleFactor: 2, reducedMotion: 'no-preference' });
  try {
    await page.goto(`${origin}/mini/#section/documents`);
    await page.locator('#workspace:not([hidden])').waitFor();
    const client = await context.newCDPSession(page);
    const swipe = async (distance) => {
      const rect = await page.locator('.workspace-toolbar').boundingBox();
      const x = rect.x + 65, y = rect.y + rect.height / 2;
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + distance / 2 }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + distance }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await swipe(-90);
    await page.waitForFunction(() => document.querySelector('#application').dataset.expanded === 'true');
    await swipe(90);
    await page.waitForURL('**/#home');
    await page.locator('#home').waitFor({ state: 'visible' });
    await waitForMotion(page, (await snapshotMotion(page)).time);
    assert.equal(await page.locator('.motion-settings, #speed, #reset-core').count(), 0, 'animation settings are removed');
    const planet = page.locator('.planet-target:not([hidden])').first();
    await planet.dispatchEvent('pointerenter', { pointerType: 'touch' });
    await waitForMotion(page, (await snapshotMotion(page)).time);
    await page.locator('#all-sections').tap();
    await page.locator('[data-module="documents"]').tap();
    await page.locator('#workspace:not([hidden])').waitFor();
    await page.locator('#workspace-close').tap();
    await page.waitForURL('**/#home');
    await waitForMotion(page, (await snapshotMotion(page)).time);
    const canvasFits = await page.locator('#core-stage').evaluate(stage => {
      const canvas = stage.querySelector('canvas'), a = stage.getBoundingClientRect(), b = canvas.getBoundingClientRect();
      return Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
    });
    assert.equal(canvasFits, true, 'high-DPI canvas matches the scene CSS dimensions');
    assert.deepEqual(errors, [], 'touch panel flow has no browser errors');
  } finally { await context.close(); }
}

async function verifyContextRecovery(browser, origin) {
  const { context, page, errors } = await openFixture(browser, origin);
  try {
    await page.waitForFunction(() => document.querySelector('#core-stage')?.dataset.render === 'webgl');
    await page.evaluate(() => {
      const canvas = document.querySelector('#core-stage canvas');
      window.orbitalTestContext = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
      if (!window.orbitalTestContext) throw new Error('WebGL context loss test extension unavailable');
      window.orbitalTestContext.loseContext();
    });
    await page.waitForFunction(() => document.querySelector('#core-stage').dataset.render === 'fallback');
    await page.locator('#modules').waitFor({ state: 'visible' });
    assert.equal(await page.locator('body').getAttribute('data-motion'), 'paused', 'context loss also stops the sky');
    assert.equal(await page.locator('.planet-target:visible').count(), 0, 'lost context has no invisible planet hit targets');
    await page.evaluate(() => window.orbitalTestContext.restoreContext());
    await page.waitForFunction(() => document.querySelector('#core-stage').dataset.render === 'webgl');
    assert.equal(await page.locator('.planet-target').count(), 6, 'restored scene retains authorized planets');
    assert.deepEqual(errors, [], 'context recovery has no browser errors');
  } finally { await context.close(); }
}

async function main() {
  await fs.mkdir(artifacts, { recursive: true });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    for (const verify of [verifyOrbitalExperience, verifyMemberScope, verifyReducedMotion, verifyWebglFallback, verifyTouchPanel, verifyContextRecovery]) {
      try { await verify(browser, origin); } catch (error) { findings.push(error.stack || error.message || String(error)); }
    }
    if (findings.length) throw new Error(`Orbital browser findings:\n${findings.map((finding, index) => `${index + 1}. ${finding}`).join('\n')}`);
    console.log('Mini App orbital browser checks passed: WebGL/orbits, automatic motion, focus, workspace navigation, search/list fallback, permissions, reduced motion, WebGL fallback, mobile/desktop layout, touch targets, local sky asset, CSP, and fixture-only requests.');
    console.log(`Screenshots: ${artifacts}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});

