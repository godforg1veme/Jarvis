const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build', 'life-os-screenshots');
fs.mkdirSync(output, { recursive: true });
const ids = {
  project: '11111111-1111-4111-8111-111111111111', area: '22222222-2222-4222-8222-222222222222',
  event: '33333333-3333-4333-8333-333333333333', device: '44444444-4444-4444-8444-444444444444',
  proposal: '55555555-5555-4555-8555-555555555555', commitment: '66666666-6666-4666-8666-666666666666',
};

function fixture(mode = 'populated') {
  if (mode === 'error') return { error: true };
  const empty = mode === 'empty';
  const project = { id: ids.project, areaId: ids.area, name: 'Jarvis Life OS', summary: 'Собрать разговоры, события и действия в продолжимый рабочий контекст.', status: 'active', revision: 1, updatedAt: new Date().toISOString() };
  const event = { id: ids.event, type: 'voice.transcribed', occurredAt: new Date().toISOString(), source: 'desktop', summary: 'Завтра вечером я продолжу проект Life OS', confidence: .9, privacy: 'personal', trust: 'user', links: [{ id: ids.area, targetType: 'project', targetId: ids.project, relation: 'project.context', origin: 'trusted', confidence: 1 }] };
  const proposal = { id: ids.proposal, projectId: ids.project, projectName: project.name, commitmentId: ids.commitment, title: 'Вернуться к архитектуре Life OS', explanation: 'Срок договорённости наступает сегодня вечером. Предложение основано на вашей голосовой фразе.', status: 'open', risk: 'safe', action: null, origin: 'desktop', expiresAt: new Date(Date.now() + 86400000).toISOString(), revision: 1, evidence: [{ ...event, eventType: event.type, sourceChannel: event.source }] };
  const commitment = { id: ids.commitment, sourceEventId: ids.event, projectId: ids.project, projectName: project.name, title: 'Продолжить проект Life OS', status: 'open', dueAt: new Date(Date.now() + 3600000).toISOString(), confidence: .9, revision: 1 };
  return {
    missionControl: { generatedAt: new Date().toISOString(), currentMission: empty ? null : project,
      areas: empty ? [] : [{ id: ids.area, key: 'development', name: 'Развитие', status: 'active', sortOrder: 10, revision: 1 }],
      projects: empty ? [] : [project, { ...project, id: '77777777-7777-4777-8777-777777777777', name: 'Домашняя лаборатория', summary: 'Надёжная инфраструктура и приватные сервисы.' }],
      commitments: empty ? [] : [commitment], proposals: empty ? [] : [proposal], recentEvents: empty ? [] : [event, { ...event, id: '88888888-8888-4888-8888-888888888888', type: 'document.ingested', source: 'knowledge', trust: 'trusted', summary: 'Проиндексирован документ «Life OS architecture.md»' }],
      devices: empty ? [] : [{ id: ids.device, name: 'Jarvis Desktop', status: 'online', lastSeenAt: new Date().toISOString() }] },
    bootstrap: { areas: empty ? [] : [{ id: ids.area, key: 'development', name: 'Развитие', status: 'active', sortOrder: 10, revision: 1 }], projects: empty ? [] : [project] },
    timeline: empty ? [] : [event], project,
    context: { project, verifiedFacts: [{ ...event, trust: 'trusted', summary: 'Сценарий успешно завершён' }], userContext: [event], inferredLinks: [], commitments: [commitment], proposals: [proposal], devices: [], continuation: { eventId: ids.event, summary: event.summary, occurredAt: event.occurredAt }, suggestedNextSteps: [{ proposalId: ids.proposal, title: proposal.title, explanation: proposal.explanation }] },
  };
}

function cloudMock(data, loading = false) {
  const wait = () => new Promise(() => {});
  const response = (value) => loading ? wait() : Promise.resolve(data.error ? { ok: false, error: 'Сервер недоступен' } : value);
  return {
    getState: () => Promise.resolve({ ok: true, paired: true, connection: 'online', deviceName: 'Jarvis Desktop', serverUrl: 'https://jarvis.example' }),
    getVoiceState: () => Promise.resolve({ ok: true, enabled: false, phase: 'off' }), getVisionState: () => Promise.resolve({ ok: true, state: { state: 'off' } }),
    getMissionControl: () => response({ ok: true, missionControl: data.missionControl }), getLifeBootstrap: () => response({ ok: true, ...data.bootstrap }),
    getLifeTimeline: () => response({ ok: true, items: data.timeline || [], nextCursor: null }), getLifeProjectContext: () => response({ ok: true, context: data.context }),
    createLifeProject: () => Promise.resolve({ ok: true, project: data.project }), recordLifeFeedback: () => Promise.resolve({ ok: true }),
    confirmLifeProposal: () => Promise.resolve({ ok: true }), dismissLifeProposal: () => Promise.resolve({ ok: true }), updateLifeCommitment: () => Promise.resolve({ ok: true }),
    onState() {}, onVoiceStatus() {}, onMessage() {}, onCoreMode() {}, onVisionState() {}, onVisionSensitiveConsentRequired() {}, onOpenLifeOs() {},
    listVisionSources: () => Promise.resolve({ ok: true, cameras: [] }), listVisionMemories: () => Promise.resolve({ ok: true, memories: [] }),
  };
}

async function capture(browser, name, width, mode, action = null) {
  const page = await browser.newPage({ viewport: { width, height: width <= 520 ? 844 : 900 }, deviceScaleFactor: 1 });
  const messages = []; page.on('console', (message) => { if (message.type() === 'error') messages.push(message.text()); }); page.on('pageerror', (error) => messages.push(error.message));
  // Functions cannot cross addInitScript serialization; install the mock as source.
  await page.addInitScript(`window.cloudMockSource = ${cloudMock.toString()}; window.jarvisCloud = window.cloudMockSource(${JSON.stringify(fixture(mode))}, ${mode === 'loading'});`);
  await page.goto(pathToFileURL(path.join(root, 'renderer', 'cloud-chat', 'index.html')).href);
  await page.waitForLoadState('load');
  await page.click('#life-os-open');
  if (mode !== 'loading') await page.waitForTimeout(300);
  if (action === 'timeline') { await page.click('[data-life-view="timeline"]'); await page.waitForTimeout(80); }
  if (action === 'context') { await page.click('.life-project-card'); await page.waitForTimeout(80); }
  const box = await page.locator('#life-os').boundingBox();
  assert.ok(box && box.width <= width + 1, `${name} overflows viewport`);
  assert.equal(await page.locator('#life-os').getAttribute('aria-hidden'), 'false');
  assert.ok((await page.locator('button:visible').count()) > 3);
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
  assert.deepEqual(messages, [], `${name} browser errors: ${messages.join('; ')}`);
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  try {
    await capture(browser, 'mission-control-1440', 1440, 'populated');
    await capture(browser, 'mission-control-390', 390, 'populated');
    await capture(browser, 'mission-control-320', 320, 'populated');
    await capture(browser, 'timeline-1440', 1440, 'populated', 'timeline');
    await capture(browser, 'project-context-1440', 1440, 'populated', 'context');
    await capture(browser, 'empty-390', 390, 'empty');
    await capture(browser, 'loading-390', 390, 'loading');
    await capture(browser, 'error-390', 390, 'error');
    console.log(`[test] Life OS browser OK · screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
