// Read-only synthetic Operations data, actual Canvas/WebGL and browser animation.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require('../job-browser/node_modules/playwright');
const { responseFor } = require('./fixtures/operationsPreview.cjs');
const base = 'http://127.0.0.1:5194/ops/';
const output = path.resolve(__dirname, '../.superpowers/orbital-operations/living-sky');
const server = spawn(process.execPath, [path.resolve(__dirname, '../ops-ui/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5194', '--strictPort'], { cwd: path.resolve(__dirname, '../ops-ui'), windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
const errors = [];
async function fixture(page) {
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { window.EventSource = class extends EventTarget { close() {} }; });
  await page.route('**/ops/api/**', route => {
    assert.equal(route.request().method(), 'GET');
    const body = responseFor(new URL(route.request().url()).pathname.replace('/ops/api', ''));
    return route.fulfill({ status: body ? 200 : 404, json: body ? { ok: true, ...body } : {} });
  });
}
async function state(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.shared-space__stars');
    const image = document.querySelector('.shared-space__milky-way');
    return { pixels: canvas.toDataURL(), transform: image ? getComputedStyle(image).transform : null, motion: canvas.parentElement.dataset.motion };
  });
}
async function frozen(page) {
  await page.waitForTimeout(150);
  const first = await state(page);
  await page.waitForTimeout(250);
  const second = await state(page);
  assert.equal(first.motion, 'paused');
  assert.equal(first.pixels, second.pixels, 'particle pixels must stay frozen');
  assert.equal(first.transform, second.transform, 'Milky Way must stay frozen');
}
async function particleAcceptance(page, width = 1440, height = 960) {
  return page.evaluate(async ({ width, height }) => {
    const { createSkyPainter } = await import('/ops/src/components/orbital/skyParticlePainter.ts');
    const canvas = document.createElement('canvas');
    canvas.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px`;
    document.body.append(canvas);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create particle acceptance canvas');
    const points = [];
    const rectangles = [];
    const originalArc = context.arc.bind(context);
    const originalFillRect = context.fillRect.bind(context);
    context.arc = (x, y, radius, ...rest) => { points.push([x, y]); return originalArc(x, y, radius, ...rest); };
    let recordRays = false;
    context.fillRect = (x, y, width, height) => { if (recordRays) rectangles.push([x, y, width, height]); return originalFillRect(x, y, width, height); };
    const painter = createSkyPainter(canvas);
    if (!painter) throw new Error('Particle painter unavailable');
    painter.resize();
    painter.paint(0);
    const starCount = points.length;
    const quadrants = [0, 0, 0, 0];
    const bins = new Array(60).fill(0);
    for (const [x, y] of points) {
      const quadrant = (x < 720 ? 0 : 1) + (y < 480 ? 0 : 2);
      quadrants[quadrant]++;
      bins[Math.min(5, Math.floor(y / 160)) * 10 + Math.min(9, Math.floor(x / 144))]++;
    }
    const positions = new Set(points.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`));
    const glintFrames = [];
    // Fixed painter times expose independent short sparkle windows without waiting for wall-clock animation.
    points.length = 0;
    for (let seconds = 0; seconds <= 100; seconds += .5) {
      rectangles.length = 0;
      recordRays = true;
      painter.paint(seconds);
      recordRays = false;
      glintFrames.push(rectangles.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('|'));
    }
    canvas.remove();
    return {
      stars: starCount,
      quadrants,
      minBin: Math.min(...bins),
      maxBin: Math.max(...bins),
      uniquePositions: positions.size,
      sparkleFrames: glintFrames.filter(Boolean).length,
      distinctSparkleFrames: new Set(glintFrames.filter(Boolean)).size,
      maxSparkleRayCalls: Math.max(...glintFrames.map(value => value ? value.split('|').length : 0)),
      meanSparkleRayCalls: glintFrames.reduce((sum, value) => sum + (value ? value.split('|').length : 0), 0) / glintFrames.length,
      sparkleTimeline: glintFrames,
    };
  }, { width, height });
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Fixture Vite exited');
    try { ready = (await fetch(base)).ok; } catch {}
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready);
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference', recordVideo: { dir: output, size: { width: 1440, height: 960 } } });
  const page = await context.newPage();
  await fixture(page);
  await page.goto(base + '#/services');
  await page.locator('[data-scene-state="ready"]').waitFor();
  await page.getByRole('heading', { name: 'Сервисы', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(async () => {
    const sky = document.querySelector('.shared-space__milky-way'); await sky.decode();
    const source = new Image(); source.src = sky.currentSrc; await source.decode();
    return source.naturalWidth >= 4096;
  }), true, 'actual source has at least 4K detail');
  const start = await state(page);
  await page.screenshot({ path: path.join(output, 'desktop-start.png') });
  await page.waitForTimeout(6000);
  const moved = await state(page);
  assert.notEqual(start.pixels, moved.pixels, 'global star layers move');
  assert.notEqual(start.transform, moved.transform, 'Milky Way moves');
  assert.equal(await page.locator('.shared-space').count(), 1, 'one shared sky below scene and sidebar');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const desktopParticles = await particleAcceptance(page);
  assert.equal(desktopParticles.stars, 1800, 'desktop draws all 1800 stars');
  assert.ok(desktopParticles.quadrants.every(count => count >= 350 && count <= 550), `stars must be irregularly spread across the sky: ${desktopParticles.quadrants}`);
  assert.ok(desktopParticles.minBin >= 12 && desktopParticles.maxBin <= 50, 'stars should fill the sky rather than form a few clumps');
  assert.ok(desktopParticles.uniquePositions > 1750, 'star positions are independently seeded, not repeated');
  assert.ok(desktopParticles.sparkleFrames >= 10, 'intermittent sparkles appear at fixed animation times');
  assert.ok(desktopParticles.distinctSparkleFrames >= 8, 'sparkles occur at independent positions and times');
  assert.ok(desktopParticles.maxSparkleRayCalls <= 90 && desktopParticles.meanSparkleRayCalls < 12, `sparkles remain sparse among 1800 stars: max ${desktopParticles.maxSparkleRayCalls}, mean ${desktopParticles.meanSparkleRayCalls.toFixed(1)} ray calls`);
  const mobileParticles = await particleAcceptance(page, 390, 844);
  assert.equal(mobileParticles.stars, 900, 'phone draws half the stars while retaining all depth layers');

  const canvas = page.locator('.shared-space__stars');
  await canvas.evaluate(node => { (node).dataset.stableSky = 'same-instance'; });
  const workspace = page.locator('.orbital-workspace');
  const surface = await workspace.evaluate(node => ({
    background: getComputedStyle(node).backgroundImage,
    filter: getComputedStyle(node).backdropFilter,
    titleSize: getComputedStyle(node.querySelector('h1')).fontSize,
  }));
  assert.match(surface.background, /rgba\([^)]*,\s*0\.[0-9]+\)/, 'inspector lets the animated sky show through');
  assert.ok(parseFloat(surface.titleSize) >= 28, 'inspector heading remains readable over the translucent surface');
  await page.getByRole('button', { name: 'Закрыть рабочую область' }).click();
  await page.waitForTimeout(650);
  assert.equal(await page.locator('.orbital-workspace').count(), 0, 'workspace can close back to the system scene');
  assert.equal(await canvas.getAttribute('data-stable-sky'), 'same-instance', 'shared canvas survives workspace close');
  const closedFrame = await state(page);
  await page.waitForTimeout(350);
  assert.notEqual(closedFrame.pixels, (await state(page)).pixels, 'stars keep moving while the workspace is closed');
  await page.getByRole('button', { name: 'Инфраструктура', exact: true }).click();
  await page.getByRole('heading', { name: 'Инфраструктура', exact: true }).waitFor();
  assert.equal(await canvas.getAttribute('data-stable-sky'), 'same-instance', 'shared canvas survives scene/sidebar selection');
  const selectedScene = await state(page);
  assert.equal(selectedScene.motion, 'running', 'sky remains active after selecting another planet and workspace');
  await page.waitForTimeout(350);
  assert.notEqual(selectedScene.pixels, (await state(page)).pixels, 'star motion continues in the newly selected workspace');
  await page.screenshot({ path: path.join(output, 'desktop.png') });
  await page.waitForTimeout(5000);
  const video = page.video();
  await context.close();
  await video.saveAs(path.join(output, 'living-sky.webm'));

  const uhd = await browser.newPage({ viewport: { width: 3840, height: 2160 }, reducedMotion: 'reduce' });
  await fixture(uhd);
  await uhd.goto(base + '#/services');
  await uhd.locator('[data-scene-state="ready"]').waitFor();
  await uhd.evaluate(async () => { await document.fonts.ready; await document.querySelector('.shared-space__milky-way').decode(); });
  assert.match(await uhd.locator('.shared-space__milky-way').evaluate(image => image.currentSrc), /milky-way-gaia-8k\.webp$/, 'UHD chooses native 8K source');
  await uhd.screenshot({ path: path.join(output, 'desktop-4k.png') });
  await uhd.close();

  const checks = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const mobile = await checks.newPage();
  await fixture(mobile);
  await mobile.goto(base + '#/services');
  await mobile.locator('[data-scene-state="ready"]').waitFor();
  await mobile.evaluate(() => document.fonts.ready);
  await mobile.locator('.shared-space__milky-way').evaluate(image => image.decode());
  assert.match(await mobile.locator('.shared-space__milky-way').evaluate(image => image.currentSrc), /milky-way-gaia-8k\.webp$/, 'dense phone screen accounts for cover crop and zoom');
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await mobile.evaluate(() => { const c = document.querySelector('.shared-space__stars'); return c.width <= Math.ceil(c.getBoundingClientRect().width * 1.5); }), true, 'DPR capped on phones');
  await mobile.screenshot({ path: path.join(output, 'mobile.png') });
  await mobile.getByRole('button', { name: 'Приостановить анимацию' }).click();
  await frozen(mobile);
  await mobile.getByRole('button', { name: 'Продолжить анимацию' }).click();
  const resumed = await state(mobile);
  await mobile.waitForTimeout(350);
  assert.notEqual(resumed.pixels, (await state(mobile)).pixels);
  await mobile.emulateMedia({ reducedMotion: 'reduce' });
  await frozen(mobile);
  await mobile.emulateMedia({ reducedMotion: 'no-preference' });
  await mobile.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await frozen(mobile);
  await mobile.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await mobile.setViewportSize({ width: 320, height: 740 });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.setViewportSize({ width: 1440, height: 960 });
  assert.equal(await mobile.locator('.shared-space__stars').count(), 1, 'resize keeps one canvas');

  const partial = await checks.newPage();
  await fixture(partial);
  await partial.route('**/milky-way-gaia-8k.webp', route => route.abort());
  await partial.goto(base);
  await partial.locator('[data-scene-state="ready"]').waitFor();
  await partial.waitForFunction(() => { const image = document.querySelector('.shared-space__milky-way'); return image?.complete && image.naturalWidth >= 4096 && image.currentSrc.endsWith('milky-way-gaia-4k.webp'); });
  await partial.close();

  const fallback = await checks.newPage();
  await fixture(fallback);
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return kind === '2d' ? null : original.call(this, kind, ...args); };
  });
  await fallback.route('**/milky-way-gaia-*.webp', route => route.abort());
  await fallback.goto(base);
  await fallback.locator('[data-scene-state="ready"]').waitFor();
  await fallback.waitForFunction(() => !document.querySelector('.shared-space img'));
  assert.equal(await fallback.getByRole('navigation', { name: 'Основная навигация' }).count(), 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['native 4K/8K sources', '3840x2160 screenshot', 'moving stars and Milky Way', '1800 desktop/900 phone stars', 'randomized star spread and sparse independent glints', 'translucent readable sidebar and continuous scene switching', 'pause/resume pixels', 'reduced motion', 'hidden/resume', 'DPR cap', '1440/390/320 overflow', 'resize', 'missing image and 2D context', 'no page errors'], output }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); server.kill(); });
