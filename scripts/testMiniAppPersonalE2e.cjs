// Browser acceptance against real Mini App routes and an isolated PostgreSQL database.
// The only intercepted request is the official Telegram SDK script, initialized
// with a locally signed synthetic user payload; API traffic is never mocked.
const assert = require('node:assert/strict');
const { randomBytes, randomUUID, createHmac } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { createRequire } = require('node:module');
const serverRequire = createRequire(path.join(__dirname, '../server/package.json'));
const { Pool } = serverRequire('pg');
const Fastify = serverRequire('fastify');
const { chromium } = require('../job-browser/node_modules/playwright');
const { runMigrations } = require('../server/src/db/migrate');
const { AccessService } = require('../server/src/access/accessService');
const { registerMiniAppRoutes } = require('../server/src/miniApp/routes');
const { registerMiniAppSelfRoutes } = require('../server/src/miniAppSelfRoutes');
const { registerMiniAppAssets } = require('../server/src/miniAppAssets');
const { SectionReader } = require('../server/src/miniApp/sectionReader');
const { DocumentStorage } = require('../server/src/knowledge/documentStorage');
const { DocumentRepository } = require('../server/src/knowledge/documentRepository');
const { KnowledgeService } = require('../server/src/knowledge/knowledgeService');
const { DeviceRepository } = require('../server/src/devices/deviceRepository');
const { DeviceService } = require('../server/src/devices/deviceService');
const { ReminderRepository } = require('../server/src/life/reminders/reminderRepository');
const { ReminderService } = require('../server/src/life/reminders/reminderService');
const { LifeEventRepository } = require('../server/src/life/lifeEventRepository');
const { LifeProjectionRepository } = require('../server/src/life/lifeProjectionRepository');
const { LifeEventGateway } = require('../server/src/life/lifeEventGateway');
const { CommitmentRepository } = require('../server/src/life/commitments/commitmentRepository');
const { CommitmentLifecycleService } = require('../server/src/life/commitments/commitmentLifecycleService');
const { MissionControlService } = require('../server/src/life/missionControlService');
const { PriorityRepository } = require('../server/src/life/priority/priorityRepository');
const { createDocumentActions } = require('../server/src/miniApp/documentActions');
const { createLifeDeviceActions } = require('../server/src/miniApp/lifeDeviceActions');
const { JobResumeRepository } = require('../server/src/jobs/jobResumeRepository');
const { JobResumeService } = require('../server/src/jobs/jobResumeService');

const databaseUrl = process.env.JARVIS_MINI_TEST_DATABASE_URL;
const botToken = 'acceptance-only-fake-telegram-bot-token';
function signed(id) {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: Number(id), first_name: 'Browser Fixture' }) });
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const data = [...fields].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, value]) => `${key}=${value}`).join('\n');
  fields.set('hash', createHmac('sha256', secret).update(data).digest('hex'));
  return fields.toString();
}
async function freePort() {
  const server = net.createServer(); await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port;
}
async function fixture() {
  if (!databaseUrl) throw new Error('Set JARVIS_MINI_TEST_DATABASE_URL to the isolated PostgreSQL test cluster.');
  const target = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['localhost','127.0.0.1','[::1]'].includes(target.hostname) || target.search)
    throw new Error('E2E requires a loopback-only PostgreSQL URL without connection overrides.');
  const database = `mini_browser_${randomBytes(8).toString('hex')}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 }); await admin.query(`CREATE DATABASE "${database}"`);
  const isolatedUrl = new URL(databaseUrl); isolatedUrl.pathname = `/${database}`;
  const pool = new Pool({ connectionString: isolatedUrl.toString(), max: 8 });
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-mini-browser-'));
  const port = await freePort(); const origin = `http://localhost:${port}`;
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  try {
    await runMigrations(pool);
    const accessService = new AccessService({ pool, ownerTelegramId: '101', legacyAllowedIds: [] }); await accessService.initialize();
    const actor = await accessService.getAccessForTelegram('101');
    const role = await accessService.mutate(actor.userId, 'role.create', { operationId: randomUUID(), name: 'E2E jobs', permissions: ['jobs'] });
    await accessService.mutate(actor.userId, 'user.create', { operationId: randomUUID(), telegramId: '202', displayName: 'E2E member', level: 'member', roleId: role.id });
    const member = await accessService.getAccessForTelegram('202');
    await pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,'memberA','connected')", [member.userId]);
    const hh = { selected: 'memberA', selects: 0, loseReply: true };
    const browserClient = { resumeToken: 'test-only-capability', forUser(userId) {
      assert.equal(userId, member.userId, 'HH read/write stays in the member profile');
      return {
        async listResumes() { return [{ id: 'memberA', title: 'E2E resume A', canRaise: true }, { id: 'memberB', title: 'E2E resume B', canRaise: true }]; },
        async selectResume({ resumeId }) { hh.selects++; hh.selected = resumeId; if (hh.loseReply) { hh.loseReply = false; throw Error('test-only lost HH response'); } return { ok: true }; },
        async connection() { return { resumeId: hh.selected }; },
      };
    } };
    const jobResumeService = new JobResumeService({ repository: new JobResumeRepository(pool, accessService), browserClient });
    await jobResumeService.refresh(member.userId, randomUUID());
    const conversation = await pool.query(`INSERT INTO conversations(user_id,channel,external_chat_id) VALUES($1,'telegram','101') RETURNING id`, [actor.userId]);
    const knowledgeService = new KnowledgeService({ repository: new DocumentRepository(pool), storage: new DocumentStorage({ root: storageRoot }), maxBytes: 1024 * 1024, extract: async () => '' });
    const deviceRepository = new DeviceRepository(pool); const deviceService = new DeviceService({ repository: deviceRepository, accessService });
    const reminderRepository = new ReminderRepository(pool); const gateway = new LifeEventGateway({ repository: new LifeEventRepository(pool) });
    const commitmentRepository = new CommitmentRepository(pool);
    const device = await pool.query(`INSERT INTO devices(user_id,name,token_hash,status) VALUES($1,'E2E device',decode($2,'hex'),'offline') RETURNING id`, [actor.userId, 'b'.repeat(64)]);
    const lifeEvent = await pool.query(`INSERT INTO life_events(user_id,event_type,occurred_at,source_channel,source_ref,deduplication_key,summary,trust_level)
      VALUES($1,'message.received',now(),'telegram','e2e:source','e2e:source','Browser fixture source','user') RETURNING id`, [actor.userId]);
    const commitment = await pool.query(`INSERT INTO life_commitments(user_id,source_event_id,title,confidence) VALUES($1,$2,'E2E commitment',1) RETURNING id`, [actor.userId, lifeEvent.rows[0].id]);
    const project = await pool.query(`INSERT INTO life_projects(user_id,name) VALUES($1,'E2E project') RETURNING id`, [actor.userId]);
    const missionControlService = new MissionControlService({ repository: new LifeProjectionRepository(pool), deviceRepository,
      priorityRepository: new PriorityRepository(pool), reminderRepository, gateway });
    const personalActionSections = { documents: createDocumentActions({ knowledgeService }),
      ...createLifeDeviceActions({ deviceService, reminderRepository, reminderService: new ReminderService({ repository: reminderRepository, gateway }),
        commitmentRepository, commitmentLifecycleService: new CommitmentLifecycleService({ repository: commitmentRepository, gateway }),
        missionControlService }) };
    registerMiniAppAssets(app, { root: path.resolve(__dirname, '../mini-app/dist') });
    registerMiniAppRoutes(app, { pool, accessService, config: { miniAppPublicOrigin: origin, telegramBotToken: botToken },
      registerUserRoutes: (routes) => registerMiniAppSelfRoutes(routes, { pool, accessService, knowledgeService, deviceService,
        missionControlService, sectionReader: new SectionReader({ pool }), personalActionSections, documentUploadMaxBytes: knowledgeService.maxBytes,
        getJobResumeService: () => jobResumeService, getJobConnectionSessionService: () => ({}) }) });
    await app.listen({ host: '127.0.0.1', port });
    return { app, pool, admin, database, origin, actor, accessService, role, member, hh, conversationId: conversation.rows[0].id,
      deviceId: device.rows[0].id, commitmentId: commitment.rows[0].id, projectId: project.rows[0].id, storageRoot };
  } catch (error) {
    await app.close().catch(() => {}); await pool.end().catch(() => {}); await fs.rm(storageRoot, { recursive: true, force: true }).catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`).catch(() => {}); await admin.end().catch(() => {}); throw error;
  }
}

async function run() {
  const f = await fixture(); let browser;
  const screenshots = path.resolve(__dirname, '../.superpowers/mini-app-personal-e2e'); await fs.mkdir(screenshots, { recursive: true });
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const telegramInitData = signed('101'); const pageErrors = []; const outside = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    context.on('page', (page) => page.on('pageerror', (error) => pageErrors.push(error.message)));
    await context.route('https://telegram.org/**', route => route.fulfill({ contentType: 'text/javascript', body: `window.Telegram={WebApp:{initData:${JSON.stringify(telegramInitData)},ready(){},expand(){}}};` }));
    context.on('request', request => { if (!request.url().startsWith(f.origin) && !request.url().startsWith('https://telegram.org/')) outside.push(request.url()); });
    let loseDeleteReply = false; const apiPosts = [];
    await context.route('**/mini/api/sections/documents/operations', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      apiPosts.push(route.request().postDataJSON());
      const response = await route.fetch();
      if (loseDeleteReply) { loseDeleteReply = false; return route.abort(); }
      return route.fulfill({ response });
    });
    await page.goto(`${f.origin}/mini/#section/documents`);
    await page.locator('#application').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Добавить документ' }).waitFor();
    const bytes = Buffer.from('E2E private document fixture');
    await page.getByRole('button', { name: 'Добавить документ' }).click();
    await page.locator('#personal-file').setInputFiles({ name: 'e2e-note.txt', mimeType: 'text/plain', buffer: bytes });
    await page.getByRole('button', { name: 'Показать изменение' }).click();
    await page.getByRole('button', { name: 'Подтвердить действие' }).click();
    try { await page.getByText('Действие выполнено.').waitFor({ timeout: 5000 }); }
    catch (error) { throw new Error(`upload did not complete: ${(await page.locator('body').innerText()).slice(-1200)}; ${error.message}`); }
    const doc = (await f.pool.query('SELECT id FROM documents WHERE user_id=$1 AND status<>\'deleted\'', [f.actor.userId])).rows[0];
    assert.ok(doc, 'real upload created an owner document');
    assert.equal(Number((await f.pool.query('SELECT count(*) FROM documents WHERE user_id=$1 AND status<>\'deleted\'', [f.actor.userId])).rows[0].count), 1);
    assert.equal(Number((await f.pool.query('SELECT count(*) FROM jobs WHERE user_id=$1 AND kind=\'document_ingest\'', [f.actor.userId])).rows[0].count), 1);
    await page.screenshot({ path: path.join(screenshots, 'documents-390.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'document UI fits 1280px viewport');
    await page.screenshot({ path: path.join(screenshots, 'documents-1280.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    const details = page.locator('.section-card__summary').first(); if (await details.count()) await details.click();
    const deleteButton = page.getByRole('button', { name: 'Удалить документ' }).first();
    try { await deleteButton.waitFor({ timeout: 5000 }); }
    catch (error) { throw new Error(`document delete control missing; buttons=${JSON.stringify(await page.locator('button').allTextContents())}; body=${(await page.locator('body').innerText()).slice(-1200)}; ${error.message}`); }
    await deleteButton.click();
    await page.getByRole('button', { name: 'Показать изменение' }).click();
    assert.match(await page.locator('.personal-actions__preview:visible').last().textContent(), /необратимо/);
    loseDeleteReply = true;
    await page.getByRole('button', { name: 'Подтвердить удаление' }).click();
    await page.getByText(/Результат пока неизвестен/).waitFor();
    const originalOperationId = apiPosts[0].operationId;
    assert.ok(originalOperationId, 'stable original operation ID captured');
    await page.reload(); await page.getByRole('button', { name: 'Проверить исходную операцию' }).waitFor();
    await page.getByRole('button', { name: 'Проверить исходную операцию' }).click();
    await page.getByText('Действие выполнено.').waitFor();
    assert.equal(apiPosts.length, 1, 'reconciliation did not submit a second write');
    const receipt = await page.request.get(`${f.origin}/mini/api/sections/documents/operations/${originalOperationId}`);
    assert.equal(receipt.status(), 200);
    assert.equal((await f.pool.query('SELECT id FROM documents WHERE id=$1', [doc.id])).rowCount, 0);
    await page.goto(`${f.origin}/mini/#section/devices`);
    await page.getByRole('button', { name: 'Подключить устройство' }).waitFor();
    await page.getByRole('button', { name: 'Подключить устройство' }).click();
    await page.locator('#personal-name').fill('E2E laptop');
    await page.getByRole('button', { name: 'Показать изменение' }).click();
    await page.getByRole('button', { name: 'Подтвердить действие' }).click();
    const codeText = page.getByText(/Одноразовый код подключения:/); await codeText.waitFor();
    const codeShown = await codeText.innerText(); assert.match(codeShown, /Одноразовый код подключения: [A-Z0-9-]+/);
    assert.equal((await page.evaluate(() => JSON.stringify(sessionStorage))).includes(codeShown.match(/[A-Z0-9-]{6,}/)?.[0] || '__absent__'), false, 'pairing code is not persisted by the browser');
    await page.getByRole('button', { name: 'Отменить это подключение' }).click();
    await page.getByRole('button', { name: 'Показать изменение' }).click();
    await page.getByRole('button', { name: 'Подтвердить действие' }).click();
    await page.getByText('Действие выполнено.').waitFor();
    assert.equal(Number((await f.pool.query(`SELECT count(*) FROM device_pairing_codes WHERE user_id=$1 AND device_name='E2E laptop' AND consumed_at IS NOT NULL`, [f.actor.userId])).rows[0].count), 1, 'pair cancellation consumes the pending code');
    const deviceDetails = page.locator('.section-card__summary').first(); if (await deviceDetails.count()) await deviceDetails.click();
    await page.getByRole('button', { name: 'Отключить устройство' }).click();
    await page.getByRole('button', { name: 'Показать изменение' }).click();
    await page.getByRole('button', { name: 'Подтвердить отключение' }).click();
    await page.getByText('Действие выполнено.').waitFor();
    assert.equal((await f.pool.query('SELECT status FROM devices WHERE id=$1', [f.deviceId])).rows[0].status, 'revoked');

    await page.goto(`${f.origin}/mini/#section/life`);
    await page.getByRole('button', { name: 'Создать напоминание' }).waitFor();
    await page.getByRole('button', { name: 'Создать напоминание' }).click();
    await page.locator('#personal-title').fill('E2E reminder'); await page.locator('#personal-time').fill('2026-12-01T10:30');
    await page.getByRole('button', { name: 'Показать изменение' }).click();
    assert.match(await page.locator('.personal-actions__preview:visible').last().textContent(), /МСК/);
    await page.getByRole('button', { name: 'Подтвердить действие' }).click(); await page.getByText('Действие выполнено.').waitFor();
    const reminder = (await f.pool.query(`SELECT id FROM life_reminders WHERE user_id=$1 AND title='E2E reminder'`, [f.actor.userId])).rows[0]; assert.ok(reminder);
    await page.getByRole('button', { name: 'Перенести напоминание' }).click();
    await page.locator('#personal-time').fill('2026-12-02T11:00');
    await page.getByRole('button', { name: 'Показать изменение' }).click(); await page.getByRole('button', { name: 'Подтвердить действие' }).click();
    await page.getByText('Действие выполнено.').waitFor();
    assert.equal((await f.pool.query('SELECT trigger_at::date::text AS day FROM life_reminders WHERE id=$1', [reminder.id])).rows[0].day, '2026-12-02');
    await page.getByRole('button', { name: 'Отменить напоминание' }).click();
    await page.getByRole('button', { name: 'Показать изменение' }).click(); await page.getByRole('button', { name: 'Подтвердить действие' }).click();
    await page.getByText('Действие выполнено.').waitFor();
    assert.equal((await f.pool.query('SELECT state FROM life_reminders WHERE id=$1', [reminder.id])).rows[0].state, 'cancelled');
    const commitmentDetails = page.locator('.section-card__summary').filter({ hasText: 'E2E commitment' }); if (await commitmentDetails.count()) await commitmentDetails.click();
    try { await page.getByRole('button', { name: 'Выполнить договорённость' }).waitFor({ timeout: 5000 }); }
    catch (error) { throw new Error(`commitment control missing; body=${(await page.locator('body').innerText()).slice(-1800)}; ${error.message}`); }
    await page.getByRole('button', { name: 'Выполнить договорённость' }).click();
    await page.getByRole('button', { name: 'Показать изменение' }).click(); await page.getByRole('button', { name: 'Подтвердить действие' }).click();
    await page.getByText('Действие выполнено.').waitFor();
    assert.equal((await f.pool.query('SELECT status FROM life_commitments WHERE id=$1', [f.commitmentId])).rows[0].status, 'completed');
    await page.getByRole('button', { name: 'Закрепить проект' }).click();
    await page.getByRole('button', { name: 'Показать изменение' }).click(); await page.getByRole('button', { name: 'Подтвердить действие' }).click();
    await page.getByText('Действие выполнено.').waitFor();
    let priority = (await f.pool.query('SELECT pinned FROM life_project_priority_state WHERE project_id=$1', [f.projectId])).rows[0]; assert.equal(priority.pinned, true);
    await page.getByRole('button', { name: 'Скрыть проект' }).click();
    await page.getByRole('button', { name: 'Показать изменение' }).click(); await page.getByRole('button', { name: 'Подтвердить действие' }).click();
    await page.getByText('Действие выполнено.').waitFor();
    priority = (await f.pool.query('SELECT pinned,hidden_until FROM life_project_priority_state WHERE project_id=$1', [f.projectId])).rows[0]; assert.equal(priority.pinned, false); assert.ok(priority.hidden_until);
    await page.getByRole('button', { name: 'Вернуть проект' }).click();
    await page.getByRole('button', { name: 'Показать изменение' }).click(); await page.getByRole('button', { name: 'Подтвердить действие' }).click();
    await page.getByText('Действие выполнено.').waitFor();
    priority = (await f.pool.query('SELECT pinned,hidden_until FROM life_project_priority_state WHERE project_id=$1', [f.projectId])).rows[0]; assert.equal(priority.pinned, false); assert.equal(priority.hidden_until, null);
    await page.screenshot({ path: path.join(screenshots, 'life-390.png'), fullPage: true });
    await context.close();
    assert.deepEqual(pageErrors, [], 'no browser errors'); assert.deepEqual(outside, [], 'no nonfixture network requests');
    assert.equal(apiPosts.length, 1, 'delete action reached real Fastify once');

    // A real member session starts a real settings operation; only the private HH
    // transport is synthetic. The write applies but loses its acknowledgement.
    const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await memberContext.route('https://telegram.org/**', route => route.fulfill({ contentType: 'text/javascript',
      body: `window.Telegram={WebApp:{initData:${JSON.stringify(signed('202'))},ready(){},expand(){}}};` }));
    const hhErrors = []; memberContext.on('page', p => p.on('pageerror', e => hhErrors.push(e.message)));
    const memberPage = await memberContext.newPage();
    await memberPage.goto(`${f.origin}/mini/#section/jobs`);
    await memberPage.getByLabel('Резюме для откликов', { exact: true }).selectOption('memberB');
    await memberPage.getByLabel('Автоподнятие выбранного резюме', { exact: true }).uncheck();
    await memberPage.getByRole('button', { name: 'Проверить изменения', exact: true }).click();
    await memberPage.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    await memberPage.getByText(/Результат ещё не подтверждён/).waitFor();
    assert.equal(f.hh.selects, 1);
    const original = (await f.pool.query("SELECT request_id FROM job_resume_operations WHERE user_id=$1 AND kind='settings'", [f.member.userId])).rows[0].request_id;
    await f.accessService.mutate(f.actor.userId, 'role.update', { operationId: randomUUID(), revision: f.role.revision,
      name: 'E2E jobs revised', permissions: ['jobs'] }, f.role.id);
    await memberPage.getByText('Как сверить неизвестный результат HH', { exact: true }).click();
    await memberPage.getByRole('button', { name: 'Сверить исходную операцию с HH', exact: true }).click();
    await memberPage.getByRole('button', { name: 'Подтвердить сверку', exact: true }).waitFor();
    assert.equal((await f.pool.query('SELECT status FROM job_resume_operations WHERE user_id=$1 AND request_id=$2', [f.member.userId, original])).rows[0].status, 'unknown');
    await memberPage.screenshot({ path: path.join(screenshots, 'hh-inspection-390.png'), fullPage: true });
    await memberPage.getByRole('button', { name: 'Подтвердить сверку', exact: true }).click();
    await memberPage.waitForFunction(() => !sessionStorage.getItem('jarvis-pending:job-resumes:202'));
    assert.equal((await f.pool.query('SELECT status FROM job_resume_operations WHERE user_id=$1 AND request_id=$2', [f.member.userId, original])).rows[0].status, 'complete');
    assert.equal((await f.pool.query('SELECT resume_id FROM job_connections WHERE user_id=$1', [f.member.userId])).rows[0].resume_id, 'memberB');
    assert.equal(f.hh.selects, 1, 'manual inspection and confirmation never replay the HH selection');
    assert.deepEqual(hhErrors, []); await memberContext.close();
    console.log('PASS Mini App browser E2E: signed owner/member login, production assets, real Fastify/PG document/device/Life/HH actions, lost-reply reconciliation, explicit HH verification without replay, 390/1280 screenshots.');
  } finally {
    await browser?.close().catch(() => {}); await f.app.close(); await f.pool.end();
    await fs.rm(f.storageRoot, { recursive: true, force: true }); await f.admin.query(`DROP DATABASE "${f.database}"`); await f.admin.end();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
