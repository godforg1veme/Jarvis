const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      let granted = false;
      window.__temporaryTrackStopped = false;
      window.__visionResults = [];
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
        async enumerateDevices() {
          return granted
            ? [{ kind: 'videoinput', deviceId: 'camo-device', label: 'Camo Camera' }]
            : [{ kind: 'videoinput', deviceId: '', label: '' }];
        },
        async getUserMedia() {
          granted = true;
          return { getTracks: () => [{ stop() { window.__temporaryTrackStopped = true; } }] };
        },
      } });
      window.jarvisVisionCapture = {
        onCommand(callback) { window.__visionHandler = callback; },
        sendResult(payload) { window.__visionResults.push(payload); },
      };
    });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'renderer', 'vision-capture.html')).href);
    await page.waitForFunction(() => typeof window.__visionHandler === 'function');
    await page.evaluate(() => window.__visionHandler({ requestId: 'list-1', command: 'list', args: { requestPermission: true } }));
    await page.waitForFunction(() => window.__visionResults.length === 1);
    const result = await page.evaluate(() => ({ result: window.__visionResults[0], stopped: window.__temporaryTrackStopped }));
    assert.equal(result.result.ok, true);
    assert.deepEqual(result.result.result.cameras, [{ deviceId: 'camo-device', label: 'Camo Camera' }]);
    assert.equal(result.stopped, true, 'temporary permission stream must close immediately');
  } finally {
    await browser.close();
  }
  console.log('Vision capture renderer browser tests passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
