const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    let vision = { state: 'off', startedAt: null, preview: null };
    const noop = () => {};
    window.jarvisCloud = {
      onState: noop, onVoiceStatus: noop, onMessage: noop, onCoreMode: noop,
      onVisionState(callback) { this.visionCallback = callback; },
      onVisionSensitiveConsentRequired: noop,
      async getState() { return { ok: true, paired: true, connection: 'online', deviceName: 'Test PC', serverUrl: 'https://example.test' }; },
      async getVoiceState() { return { ok: true, enabled: false, phase: 'off' }; },
      async getVisionState() { return { ok: true, state: vision }; },
      async listVisionSources() { return { ok: true, cameras: [{ sourceId: 'camera-camo', label: 'Camo Camera' }], displays: [{ sourceId: 'display-1', label: 'Display 1' }, { sourceId: 'display-2', label: 'Display 2' }], workspace: { sourceId: 'workspace', label: 'Оба монитора' } }; },
      async startVision() { const now = Date.now(); vision = { state: 'active', startedAt: new Date(now).toISOString(), idleExpiresAt: new Date(now + 300000).toISOString(), hardExpiresAt: new Date(now + 3600000).toISOString(), sources: [{ sourceId: 'camera-camo', type: 'camera', active: true }, { sourceId: 'workspace', type: 'screen_workspace', active: true }], preview: null }; this.visionCallback?.(vision); return { ok: true, state: vision }; },
      async analyzeVision() { vision = { ...vision, preview: { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', capturedAt: new Date().toISOString() } }; this.visionCallback?.(vision); return { ok: true, answer: 'Вижу тестовую сцену.', retentionConsentSources: [] }; },
      async stopVision() { vision = { state: 'off', startedAt: null, preview: null }; this.visionCallback?.(vision); return { ok: true, state: vision }; },
      async setVisionSensitiveConsent() { return { ok: true }; },
      async classifyVisualIntent() { return { visual: false }; },
      async listVisionMemories() { return { ok: true, memories: [{ id: 'memory-a', source_id: 'camera-camo', state: 'stored', sensitivity: 'none', captured_at: new Date().toISOString(), pinned: false }] }; },
      async getVisionMemory() { return { ok: true, memory: { id: 'memory-a', source_id: 'camera-camo', captured_at: new Date().toISOString(), pinned: false }, observation: { sceneSummary: 'Тестовая сцена', confidence: .9 }, image: { contentType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' } }; },
      async updateVisionMemory() { return { ok: true }; }, async deleteVisionMemory() { return { ok: true }; },
      async sendMessage() { return { ok: true, answer: 'ok' }; }, async pair() { return { ok: true }; },
      async startVoice() { return { ok: true }; }, async stopVoice() { return { ok: true }; },
    };
  });
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'renderer', 'cloud-chat', 'index.html')).href);
  await page.waitForLoadState('networkidle');
  await page.locator('#vision-camera').selectOption('auto');
  await page.locator('#vision-toggle').click();
  await page.locator('#vision-toggle').click();
  await page.getByText('Вижу тестовую сцену.').waitFor();
  assert.equal(await page.locator('#vision-stop').isEnabled(), true);
  assert.equal(await page.locator('#vision-preview img').count(), 1);
  await page.getByText(/Активно: камера \+ оба монитора/u).waitFor();
  assert.match(await page.locator('#vision-timer').textContent(), /ОСТАЛОСЬ/u);
  if (process.env.JARVIS_VISION_DOCK_SCREENSHOT) {
    await page.screenshot({ path: process.env.JARVIS_VISION_DOCK_SCREENSHOT, fullPage: true });
  }
  await page.locator('#vision-timeline-open').click();
  await page.locator('.memory-row').click();
  await page.getByRole('heading', { name: 'Тестовая сцена' }).waitFor();
  await page.screenshot({ path: process.env.JARVIS_VISION_SCREENSHOT || path.join(process.cwd(), 'vision-ui-test.png'), fullPage: true });
  await page.locator('#vision-timeline-close').click();
  await page.locator('#vision-stop').focus();
  await page.keyboard.press('Enter');
  await page.getByText('Зрение выключено').waitFor();
  assert.equal(await page.locator('#vision-stop').isEnabled(), false);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('Vision renderer browser tests passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
