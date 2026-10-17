const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { chromium } = require('../job-browser/node_modules/playwright');

// Real document, Life OS handlers and native <dialog> validation; synthetic IPC only.
function installCloudFixture() {
  window.__lifeCreates = [];
  window.jarvisCloud = {
    getState: async () => ({ ok: true, paired: true, connection: 'online' }),
    getVoiceState: async () => ({ ok: true, enabled: false }),
    getVisionState: async () => ({ ok: true, state: { state: 'off' } }),
    listVisionSources: async () => ({ ok: true, cameras: [] }),
    getMissionControl: async () => ({ ok: true, missionControl: {
      asOf: new Date().toISOString(), status: 'fresh', rankedProjects: [], projects: [],
      proposals: [], commitments: [], areas: [], recentEvents: [], devices: [], reminders: [],
    } }),
    getLifeBootstrap: async () => ({ ok: true, areas: [], projects: [] }),
    createLifeProject: async (input) => { window.__lifeCreates.push(input); return { ok: true }; },
    createLifePerson: async (input) => { window.__lifeCreates.push(input); return { ok: true }; },
    onState() {}, onVoiceStatus() {}, onMessage() {}, onCoreMode() {}, onVisionState() {},
    onVisionSensitiveConsentRequired() {}, onOpenLifeOs() {}, onLifeProposal() {},
  };
}

test('Life OS dialogs cancel invalid forms without creating records', async (t) => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  try {
    for (const kind of ['project', 'person']) {
      for (const filled of [false, true]) {
        for (const action of ['cancel', 'cross', 'Escape']) {
          await t.test(`${kind}: ${filled ? 'filled' : 'empty'}, ${action}`, async () => {
            const page = await browser.newPage();
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            try {
              await page.addInitScript(installCloudFixture);
              await page.goto(pathToFileURL(path.resolve(__dirname, '../renderer/cloud-chat/index.html')).href);
              await page.locator('#life-os-open').click();
              await page.waitForFunction(() => document.activeElement?.id === 'life-os-content');
              let opener = page.locator('#life-project-new');
              if (kind === 'person') {
                await page.locator('[data-life-view="people"]').click();
                await page.waitForFunction(() => document.activeElement?.id === 'life-os-content');
                opener = page.locator('#life-os-content').getByRole('button', { name: 'Добавить человека', exact: true });
              }
              await opener.focus();
              await page.keyboard.press('Enter');
              const dialog = page.locator(`#life-${kind}-dialog`);
              await dialog.waitFor({ state: 'visible' });
              const input = page.locator(`#life-${kind}-name`);
              await input.fill(filled ? 'Synthetic draft' : '');
              // The create action must still enforce required-field validation.
              if (!filled) {
                await dialog.locator('button[value="default"]').click();
                assert.equal(await dialog.evaluate((node) => node.open), true);
                assert.equal(await input.evaluate((node) => node.validity.valueMissing), true);
              }
              if (action === 'Escape') await page.keyboard.press('Escape');
              else await dialog.locator(action === 'cancel' ? 'footer button[value="cancel"]' : 'header button[value="cancel"]').click();
              assert.equal(await dialog.evaluate((node) => node.open), false, 'cancel must close even when required name is empty');
              assert.equal(await opener.evaluate((node) => document.activeElement === node), true, 'focus returns to the opener');
              assert.deepEqual(await page.evaluate(() => window.__lifeCreates), [], 'cancellation must not create a record');
              assert.equal(await page.locator('#life-os').getAttribute('aria-hidden'), 'false', 'Escape closes this dialog only');
              // Closing and reopening retains the existing local draft, without saving it.
              await opener.click();
              assert.equal(await input.inputValue(), filled ? 'Synthetic draft' : '');
              await page.keyboard.press('Escape');
              assert.deepEqual(errors, []);
            } finally { await page.close(); }
          });
        }
      }
    }
  } finally { await browser.close(); }
});
