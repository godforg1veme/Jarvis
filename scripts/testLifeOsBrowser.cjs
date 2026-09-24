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
  person: '99999999-9999-4999-8999-999999999999', source: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  recovery: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};

function fixture(mode = 'populated') {
  if (mode === 'error') return { error: true };
  const empty = mode === 'empty';
  const stale = mode === 'stale';
  const partial = mode === 'partial';
  const offline = mode === 'offline';
  const project = { id: ids.project, areaId: ids.area, name: 'Jarvis Life OS', summary: 'Собрать разговоры, события и действия в продолжимый рабочий контекст.', status: 'active', revision: 1, updatedAt: new Date().toISOString() };
  const event = { id: ids.event, type: 'voice.transcribed', occurredAt: new Date().toISOString(), source: 'desktop', summary: 'Завтра вечером я продолжу проект Life OS', confidence: .9, privacy: 'personal', trust: 'user', links: [{ id: ids.area, targetType: 'project', targetId: ids.project, relation: 'project.context', origin: 'trusted', confidence: 1 }] };
  const proposal = { id: ids.proposal, projectId: ids.project, projectName: project.name, commitmentId: ids.commitment, title: 'Вернуться к архитектуре Life OS', explanation: 'Срок договорённости наступает сегодня вечером. Предложение основано на вашей голосовой фразе.', status: 'open', risk: offline ? 'changing' : 'safe', action: offline ? 'workspace.prepare' : null, origin: 'desktop', confidence: .9, expiresAt: new Date(Date.now() + 86400000).toISOString(), revision: 1, evidence: [{ ...event, eventType: event.type, sourceChannel: event.source }] };
  const commitment = { id: ids.commitment, sourceEventId: ids.event, projectId: ids.project, projectName: project.name, title: 'Продолжить проект Life OS', status: 'open', dueAt: new Date(Date.now() + 3600000).toISOString(), confidence: .9, revision: 1 };
  return {
    connection: offline ? 'offline' : 'online', conflict: mode === 'conflict',
    missionControl: { asOf: stale ? new Date(Date.now() - 3600000).toISOString() : new Date().toISOString(), generatedAt: new Date().toISOString(), status: partial ? 'partial' : 'fresh', currentMission: empty ? null : { ...project, score: 82, confidence: .91, pinned: false, priorityRevision: 1, reasons: [{ code: 'commitments.open', contribution: 8 }] },
      rankedProjects: empty ? [] : [{ ...project, id: '77777777-7777-4777-8777-777777777777', name: 'Домашняя лаборатория', summary: 'Надёжная инфраструктура и приватные сервисы.', score: 61, confidence: .8, reasons: [{ code: 'activity.today', contribution: 5 }] }],
      areas: empty ? [] : [{ id: ids.area, key: 'development', name: 'Развитие', status: 'active', sortOrder: 10, revision: 1 }],
      projects: empty ? [] : [project, { ...project, id: '77777777-7777-4777-8777-777777777777', name: 'Домашняя лаборатория', summary: 'Надёжная инфраструктура и приватные сервисы.' }],
      commitments: empty ? [] : [commitment], proposals: empty ? [] : [proposal], recentEvents: empty ? [] : [event, { ...event, id: '88888888-8888-4888-8888-888888888888', type: 'document.ingested', source: 'knowledge', trust: 'trusted', summary: 'Проиндексирован документ «Life OS architecture.md»' }],
      reminders: empty ? [] : [{ id: ids.event, title: 'Проверить план вечером', state: 'scheduled', triggerAt: new Date(Date.now() + 7200000).toISOString(), revision: 1 }], failures: [],
      devices: empty ? [] : [{ id: ids.device, name: 'Jarvis Desktop', status: 'online', lastSeenAt: new Date().toISOString() }],
      mode: { mode: 'work', source: 'manual', revision: 1, policy: { initiative: 'normal', responseLength: 'balanced', notificationPolicy: 'normal' } }, sources: empty ? [] : [{ id: ids.source, type: 'calendar', name: 'Календарь', enabled: true, health: 'healthy', lastSyncAt: new Date().toISOString() }] },
    bootstrap: { areas: empty ? [] : [{ id: ids.area, key: 'development', name: 'Развитие', status: 'active', sortOrder: 10, revision: 1 }], projects: empty ? [] : [project] },
    timeline: empty ? [] : [event], project,
    context: { project, verifiedFacts: [{ ...event, trust: 'trusted', summary: 'Сценарий успешно завершён' }], userContext: [event], inferredLinks: [], commitments: [commitment], proposals: [proposal], documents: [], devices: [], continuation: { eventId: ids.event, summary: event.summary, occurredAt: event.occurredAt }, suggestedNextSteps: [{ proposalId: ids.proposal, title: proposal.title, explanation: proposal.explanation }] },
    people: empty ? [] : [{ id: ids.person, displayName: 'Анна Петрова', relationshipType: 'family', status: 'active', revision: 1 }],
    relationships: empty ? [] : [{ id: ids.event, personId: ids.person, direction: 'mutual', relationType: 'family', origin: 'user', confidence: 1, revision: 1 }],
    links: empty ? [] : [{ id: ids.event, personId: ids.person, projectId: ids.project, role: 'participant', displayName: 'Анна Петрова', projectName: project.name, origin: 'user', confidence: 1 }],
    preferences: empty ? [] : [{ key: 'response.style', value: 'balanced', source: 'explicit', confidence: 1, revision: 1 }],
    sources: empty ? [] : [{ id: ids.source, type: 'calendar', displayName: 'Календарь', enabled: true, health: 'healthy', transport: 'fixture_only', revision: 1 }],
    recovery: { id: ids.recovery, projectId: ids.project, summary: 'Вернуться к Jarvis Life OS', status: 'ready', revision: 1, steps: [{ id: ids.event, position: 0, type: 'show_fact', label: 'Показать последнюю подтверждённую точку', risk: 'safe', status: 'pending' }, { id: ids.device, position: 1, type: 'prepare_workspace', label: 'Подготовить рабочее пространство', risk: 'changing', status: 'pending' }] },
  };
}

function cloudMock(data, loading = false) {
  const wait = () => new Promise(() => {});
  const response = (value) => loading ? wait() : Promise.resolve(data.error ? { ok: false, error: 'Сервер недоступен' } : value);
  return {
    getState: () => Promise.resolve({ ok: true, paired: true, connection: data.connection || 'online', deviceName: 'Jarvis Desktop', serverUrl: 'https://jarvis.example' }),
    getVoiceState: () => Promise.resolve({ ok: true, enabled: false, phase: 'off' }), getVisionState: () => Promise.resolve({ ok: true, state: { state: 'off' } }),
    getMissionControl: () => response({ ok: true, missionControl: data.missionControl }), getLifeBootstrap: () => response({ ok: true, ...data.bootstrap }),
    getLifeTimeline: () => response({ ok: true, items: data.timeline || [], nextCursor: null }), getLifeProjectContext: () => response({ ok: true, context: data.context }),
    createLifeProject: () => Promise.resolve({ ok: true, project: data.project }), recordLifeFeedback: () => Promise.resolve({ ok: true }),
    confirmLifeProposal: () => Promise.resolve({ ok: true }), dismissLifeProposal: () => Promise.resolve({ ok: true }), updateLifeCommitment: () => Promise.resolve({ ok: true }),
    setLifeMissionIntent: () => Promise.resolve({ ok: true }), getLifePeople: () => Promise.resolve({ ok: true, people: data.people }),
    getLifeRelationships: () => Promise.resolve({ ok: true, relationships: data.relationships }), getLifePersonProjectLinks: () => Promise.resolve({ ok: true, links: data.links }),
    getLifeFamilyGrants: () => Promise.resolve({ ok: true, grants: [] }), getLifeFamilyShared: () => Promise.resolve({ ok: true, shared: [] }), createLifePerson: () => Promise.resolve({ ok: true }),
    getLifePreferences: () => Promise.resolve({ ok: true, preferences: data.preferences }), setLifePreference: () => Promise.resolve(data.conflict ? { ok: false, code: 'LIFE_REVISION_CONFLICT', error: 'Данные изменились' } : { ok: true }), resetLifePreference: () => Promise.resolve({ ok: true }), deleteLifePreference: () => Promise.resolve({ ok: true }),
    getLifeSources: () => Promise.resolve({ ok: true, sources: data.sources }), createLifeSource: () => Promise.resolve({ ok: true }), updateLifeSource: () => Promise.resolve({ ok: true }), syncLifeSource: () => Promise.resolve({ ok: true }),
    setLifeMode: (input) => Promise.resolve({ ok: true, mode: { mode: input.mode, source: 'manual', revision: 2 } }), mutateLifeReminder: () => Promise.resolve({ ok: true }),
    createLifeRecoveryPlan: () => Promise.resolve({ ok: true, plan: data.recovery }), proposeLifeRecoveryPlan: () => Promise.resolve({ ok: true }),
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
  if (action === 'people') { await page.click('[data-life-view="people"]'); await page.waitForTimeout(80); }
  if (action === 'system') { await page.click('[data-life-view="system"]'); await page.waitForTimeout(80); }
  if (action === 'proposal') { await page.getByRole('button', { name: 'Показать основания' }).first().click(); await page.waitForTimeout(80); }
  if (action === 'recovery') { await page.click('.life-project-card'); await page.waitForTimeout(80); await page.getByRole('button', { name: 'Подготовить план восстановления' }).click(); await page.waitForTimeout(80); }
  if (action === 'conflict') { await page.click('[data-life-view="system"]'); await page.waitForTimeout(80); await page.getByRole('button', { name: 'Сохранить' }).first().click(); await page.waitForTimeout(80); }
  const box = await page.locator('#life-os').boundingBox();
  assert.ok(box && box.width <= width + 1, `${name} overflows viewport`);
  assert.ok(await page.evaluate((viewportWidth) => document.documentElement.scrollWidth <= viewportWidth, width), `${name} causes horizontal document scroll`);
  assert.equal(await page.locator('#life-os').getAttribute('aria-hidden'), 'false');
  assert.ok((await page.locator('button:visible').count()) > 3);
  if (action === 'proposal') assert.equal(await page.evaluate(() => document.activeElement?.id), 'life-detail-dialog-close');
  if (mode === 'offline') assert.equal(await page.getByRole('button', { name: 'Подтвердить' }).isDisabled(), true);
  if (action === 'conflict') assert.equal(await page.getByRole('alert').getByText('Версия изменилась').isVisible(), true);
  if (width <= 520) {
    const undersized = await page.locator('#life-os button:visible').evaluateAll((nodes) => nodes.filter((node) => { const box = node.getBoundingClientRect(); return box.width < 44 || box.height < 44; }).map((node) => node.textContent.trim() || node.getAttribute('aria-label')));
    assert.deepEqual(undersized, [], `${name} has undersized touch controls: ${undersized.join(', ')}`);
  }
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
  assert.deepEqual(messages, [], `${name} browser errors: ${messages.join('; ')}`);
  await page.close();
}

async function keyboardAcceptance(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(`window.cloudMockSource = ${cloudMock.toString()}; window.jarvisCloud = window.cloudMockSource(${JSON.stringify(fixture('populated'))}, false);`);
  await page.goto(pathToFileURL(path.join(root, 'renderer', 'cloud-chat', 'index.html')).href);
  await page.focus('#life-os-open'); await page.keyboard.press('Enter'); await page.waitForSelector('#life-os.is-open');
  await page.waitForFunction(() => document.activeElement?.id === 'life-os-content');
  await page.focus('[data-life-view="people"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(80);
  assert.match(await page.locator('#life-os-content h3').textContent(), /Люди/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#life-os').getAttribute('aria-hidden'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'life-os-open');
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
    await capture(browser, 'people-1440', 1440, 'populated', 'people');
    await capture(browser, 'system-1440', 1440, 'populated', 'system');
    await capture(browser, 'system-320', 320, 'populated', 'system');
    await capture(browser, 'proposal-detail-390', 390, 'populated', 'proposal');
    await capture(browser, 'recovery-plan-390', 390, 'populated', 'recovery');
    await capture(browser, 'empty-390', 390, 'empty');
    await capture(browser, 'loading-390', 390, 'loading');
    await capture(browser, 'error-390', 390, 'error');
    await capture(browser, 'stale-390', 390, 'stale');
    await capture(browser, 'partial-390', 390, 'partial');
    await capture(browser, 'offline-390', 390, 'offline');
    await capture(browser, 'conflict-390', 390, 'conflict', 'conflict');
    await keyboardAcceptance(browser);
    const reduced = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await reduced.addInitScript(`window.cloudMockSource = ${cloudMock.toString()}; window.jarvisCloud = window.cloudMockSource(${JSON.stringify(fixture('populated'))}, false);`);
    await reduced.goto(pathToFileURL(path.join(root, 'renderer', 'cloud-chat', 'index.html')).href);
    await reduced.click('#life-os-open'); await reduced.waitForTimeout(50);
    assert.equal(await reduced.locator('#life-os').evaluate((node) => getComputedStyle(node).transitionDuration), '0s');
    assert.equal(await reduced.locator('.life-project-card').first().evaluate((node) => getComputedStyle(node).transitionDuration), '0s');
    await reduced.close();
    console.log(`[test] Life OS browser OK · screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
