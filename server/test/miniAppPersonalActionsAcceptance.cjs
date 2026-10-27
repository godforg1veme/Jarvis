// Real Fastify + PostgreSQL acceptance for Mini App personal actions.
// Uses an isolated schema and temporary document storage only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID, createHmac } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const Fastify = require('fastify');
const { runMigrations } = require('../src/db/migrate');
const { AccessService } = require('../src/access/accessService');
const { registerMiniAppRoutes } = require('../src/miniApp/routes');
const { registerMiniAppSelfRoutes } = require('../src/miniAppSelfRoutes');
const { DocumentStorage } = require('../src/knowledge/documentStorage');
const { DocumentRepository } = require('../src/knowledge/documentRepository');
const { KnowledgeService } = require('../src/knowledge/knowledgeService');
const { DeviceRepository } = require('../src/devices/deviceRepository');
const { DeviceService } = require('../src/devices/deviceService');
const { createPairingCode } = require('../src/devices/deviceCredentials');
const { ReminderRepository } = require('../src/life/reminders/reminderRepository');
const { ReminderService } = require('../src/life/reminders/reminderService');
const { LifeEventRepository } = require('../src/life/lifeEventRepository');
const { LifeEventGateway } = require('../src/life/lifeEventGateway');
const { CommitmentRepository } = require('../src/life/commitments/commitmentRepository');
const { CommitmentLifecycleService } = require('../src/life/commitments/commitmentLifecycleService');
const { MissionControlService } = require('../src/life/missionControlService');
const { PriorityRepository } = require('../src/life/priority/priorityRepository');
const { createDocumentActions } = require('../src/miniApp/documentActions');
const { createLifeDeviceActions } = require('../src/miniApp/lifeDeviceActions');

const url = process.env.JARVIS_MINI_TEST_DATABASE_URL;
const origin = 'http://localhost:43127';
const botToken = 'acceptance-only-fake-telegram-bot-token';
function signed(id) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: Number(id), first_name: 'Fixture' }) });
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const data = [...params].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, value]) => `${key}=${value}`).join('\n');
  params.set('hash', createHmac('sha256', secret).update(data).digest('hex'));
  return params.toString();
}

async function fixture() {
  if (!url) throw new Error('JARVIS_MINI_TEST_DATABASE_URL is required; production databases are not allowed');
  const target = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['localhost','127.0.0.1','[::1]'].includes(target.hostname) || target.search)
    throw new Error('Acceptance requires a loopback-only PostgreSQL URL without connection overrides.');
  const database = `mini_personal_${randomBytes(8).toString('hex')}`;
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE DATABASE "${database}"`);
  const isolatedUrl = new URL(url); isolatedUrl.pathname = `/${database}`;
  const pool = new Pool({ connectionString: isolatedUrl.toString(), max: 8 });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-mini-actions-'));
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  try {
    await runMigrations(pool);
    const accessService = new AccessService({ pool, ownerTelegramId: '101', legacyAllowedIds: ['202'] });
    await accessService.initialize();
    const owner = await accessService.getAccessForTelegram('101');
    const conversations = await pool.query(`INSERT INTO conversations(user_id,channel,external_chat_id) VALUES($1,'telegram','101') RETURNING id`, [owner.userId]);
    const documentRepository = new DocumentRepository(pool);
    const storage = new DocumentStorage({ root });
    const knowledgeService = new KnowledgeService({ repository: documentRepository, storage, maxBytes: 1024 * 1024, extract: async () => '' });
    const deviceRepository = new DeviceRepository(pool);
    const deviceService = new DeviceService({ repository: deviceRepository, accessService });
    const reminderRepository = new ReminderRepository(pool);
    const events = new LifeEventGateway({ repository: new LifeEventRepository(pool) });
    const reminderService = new ReminderService({ repository: reminderRepository, gateway: events });
    const commitmentRepository = new CommitmentRepository(pool);
    const commitmentLifecycleService = new CommitmentLifecycleService({ repository: commitmentRepository, gateway: events });
    const missionControlService = new MissionControlService({ priorityRepository: new PriorityRepository(pool), gateway: events });
    const personalActionSections = {
      documents: createDocumentActions({ knowledgeService }),
      ...createLifeDeviceActions({ deviceService, reminderService, reminderRepository, commitmentRepository, commitmentLifecycleService, missionControlService }),
    };
    registerMiniAppRoutes(app, { pool, accessService, config: { miniAppPublicOrigin: origin, telegramBotToken: botToken },
      registerUserRoutes: (routes) => registerMiniAppSelfRoutes(routes, {
        pool, accessService, knowledgeService, deviceService, personalActionSections, documentUploadMaxBytes: knowledgeService.maxBytes,
      }) });
    await app.ready();
    async function login(id) {
      const result = await app.inject({ method: 'POST', url: '/mini/api/session', headers: { origin }, payload: { initData: signed(id) } });
      assert.equal(result.statusCode, 200, `signed fixture login ${id}`);
      return { cookie: result.headers['set-cookie'].split(';')[0], csrf: result.json().csrfToken };
    }
    function request(session, method, endpoint, payload, headers = {}) {
      return app.inject({ method, url: `/mini/api${endpoint}`, headers: { cookie: session.cookie,
        ...(method === 'POST' ? { origin, 'x-jarvis-csrf': session.csrf } : {}), ...headers }, ...(payload !== undefined ? { payload } : {}) });
    }
    return { app, pool, root, accessService, owner, knowledgeService, deviceService, request, login, conversationId: conversations.rows[0].id,
      async close() { await app.close(); await pool.end(); await fs.rm(root, { recursive: true, force: true }); await admin.query(`DROP DATABASE "${database}"`); await admin.end(); } };
  } catch (error) {
    await app.close().catch(() => {}); await pool.end().catch(() => {}); await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`).catch(() => {}); await admin.end().catch(() => {}); throw error;
  }
}

test('real personal action routes enforce scope, revisions, rollback, receipts, and life/device/document mutations', { skip: !url, timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    const owner = await f.login('101'); const member = await f.login('202');
    const actor = f.owner; const tableCount = async (table, where, params) => Number((await f.pool.query(`SELECT count(*) FROM ${table} WHERE ${where}`, params)).rows[0].count);
    const uploadId = randomUUID(); const payload = Buffer.from('fixture private document'); let result;
    const headers = { 'content-type': 'application/octet-stream', 'x-jarvis-file-name': encodeURIComponent('acceptance.txt'), 'x-jarvis-file-type': 'text/plain' };
    assert.equal((await f.app.inject({ method: 'POST', url: `/mini/api/sections/documents/uploads/${randomUUID()}`, headers: { origin, ...headers }, payload })).statusCode, 401, 'upload requires an authenticated Mini App session');
    result = await f.request(owner, 'POST', `/sections/documents/uploads/${randomUUID()}`, payload, { ...headers, 'x-jarvis-file-type': 'application/x-msdownload' });
    assert.equal(result.statusCode, 400, 'unsupported media type is rejected');
    result = await f.request(owner, 'POST', `/sections/documents/uploads/${randomUUID()}`, Buffer.alloc(1024 * 1024 + 1, 1), headers);
    assert.ok([400, 413].includes(result.statusCode), 'oversized upload is rejected before storage');
    assert.equal(await tableCount('documents', 'user_id=$1', [actor.userId]), 0);
    const enqueue = f.knowledgeService.repository.enqueueIngest;
    f.knowledgeService.repository.enqueueIngest = async () => { throw new Error('isolated test enqueue failure'); };
    const rollbackId = randomUUID();
    result = await f.request(owner, 'POST', `/sections/documents/uploads/${rollbackId}`, payload, headers);
    assert.notEqual(result.statusCode, 200, 'ingest queue failure is surfaced');
    assert.equal(await tableCount('documents', 'user_id=$1', [actor.userId]), 0, 'document row rolled back');
    assert.equal(await tableCount('mini_app_personal_operations', 'user_id=$1 AND operation_id=$2', [actor.userId, rollbackId]), 0, 'receipt rolled back with document');
    f.knowledgeService.repository.enqueueIngest = enqueue;
    result = await f.request(owner, 'POST', `/sections/documents/uploads/${uploadId}`, payload, headers);
    assert.equal(result.statusCode, 200); const documentId = result.json().result.id;
    assert.equal(await tableCount('documents', 'user_id=$1 AND id=$2 AND status<>\'deleted\'', [actor.userId, documentId]), 1);
    assert.equal(await tableCount('jobs', 'user_id=$1 AND kind=\'document_ingest\' AND payload->>\'documentId\'=$2', [actor.userId, documentId]), 1);
    assert.deepEqual(await fs.readFile(path.join(f.root, documentId.slice(0,2), documentId)), payload);
    assert.equal((await f.request(owner, 'GET', `/sections/documents/operations/${uploadId}`)).json().result.id, documentId);
    assert.equal((await f.request(owner, 'POST', `/sections/documents/uploads/${uploadId}`, payload, headers)).json().result.id, documentId);
    assert.ok([403, 404].includes((await f.request(member, 'GET', `/sections/documents/operations/${uploadId}`)).statusCode), 'other actor cannot read receipt');

    // File preparation must not hold the access transaction lock. Revoke a second
    // actor while its storage write is gated, then require final authorization to fail.
    const memberActor = await f.accessService.getAccessForTelegram('202');
    const storage = f.knowledgeService.storage; const originalWrite = storage.write.bind(storage);
    let signalWrite, releaseWrite; const writeEntered = new Promise(resolve => { signalWrite = resolve; });
    const writeRelease = new Promise(resolve => { releaseWrite = resolve; }); let preparedKey;
    storage.write = async (key, bytes) => { await originalWrite(key, bytes); preparedKey = key; signalWrite(); await writeRelease; };
    const revokedUploadId = randomUUID(); const revokedWrite = f.request(member, 'POST', `/sections/documents/uploads/${revokedUploadId}`, payload, headers);
    try { await Promise.race([writeEntered, new Promise((_, reject) => setTimeout(() => reject(new Error('document write did not enter preparation gate')), 5000))]); }
    catch (error) { releaseWrite(); storage.write = originalWrite; await revokedWrite.catch(() => {}); throw error; }
    try {
      await Promise.race([f.accessService.transaction(async db => db.query(`INSERT INTO access_user_overrides(user_id,permission,effect)
        VALUES($1,'documents','deny') ON CONFLICT(user_id,permission) DO UPDATE SET effect='deny'`, [memberActor.userId])),
        new Promise((_, reject) => setTimeout(() => reject(new Error('access revocation blocked behind document preparation')), 2000))]);
    } catch (error) { releaseWrite(); storage.write = originalWrite; await revokedWrite.catch(() => {}); throw error; }
    releaseWrite(); const revokedResult = await revokedWrite; storage.write = originalWrite;
    assert.equal(revokedResult.statusCode, 403, 'permission is rechecked after preparation');
    assert.equal(await tableCount('documents', 'user_id=$1', [memberActor.userId]), 0, 'revoked upload made no document row');
    assert.equal(await tableCount('mini_app_personal_operations', 'user_id=$1 AND operation_id=$2', [memberActor.userId, revokedUploadId]), 0, 'revoked upload made no receipt');
    await assert.rejects(fs.access(path.join(f.root, preparedKey)), { code: 'ENOENT' }, 'prepared file removed after rights revocation');
    const doc = (await f.request(owner, 'GET', `/sections/documents/actions/delete/${documentId}`)).json().target;
    result = await f.request(owner, 'POST', '/sections/documents/operations', { operationId: randomUUID(), kind: 'delete', targetId: documentId, revision: 'a'.repeat(64), input: {} });
    assert.equal(result.statusCode, 409, 'stale document revision denied');
    const deleteId = randomUUID(); result = await f.request(owner, 'POST', '/sections/documents/operations', { operationId: deleteId, kind: 'delete', targetId: documentId, revision: doc.revision, input: {} });
    assert.equal(result.statusCode, 200); assert.equal(result.json().result.deleted, true);
    assert.equal(await tableCount('documents', 'id=$1', [documentId]), 0);
    await assert.rejects(fs.access(path.join(f.root, documentId.slice(0,2), documentId)));

    const device = await f.pool.query(`INSERT INTO devices(user_id,name,token_hash,status) VALUES($1,'Fixture desktop',decode($2,'hex'),'offline') RETURNING id`, [actor.userId, 'a'.repeat(64)]);
    const deviceId = device.rows[0].id; const deviceTarget = (await f.request(owner, 'GET', `/sections/devices/actions/revoke/${deviceId}`)).json().target;
    result = await f.request(owner, 'POST', '/sections/devices/operations', { operationId: randomUUID(), kind: 'revoke', targetId: deviceId, revision: deviceTarget.revision, input: {} });
    assert.equal(result.statusCode, 200); assert.equal((await f.pool.query('SELECT status FROM devices WHERE id=$1', [deviceId])).rows[0].status, 'revoked');
    const pairingIds = [];
    for (let index = 0; index < 10; index += 1) {
      const created = await f.deviceService.repository.createPairingCode({ userId: actor.userId, code: createPairingCode(),
        deviceName: `Active fixture ${index}`, expiresAt: new Date(Date.now() + 5 * 60_000) }); pairingIds.push(created.id);
    }
    await f.deviceService.repository.createPairingCode({ userId: actor.userId, code: createPairingCode(), deviceName: 'Expired fixture', expiresAt: new Date(Date.now() - 1000) });
    const limitedPairId = randomUUID(); result = await f.request(owner, 'POST', '/sections/devices/operations', { operationId: limitedPairId, kind: 'pair', targetId: null, revision: null, input: { name: 'Eleventh fixture' } });
    assert.equal(result.json().code, 'limit_reached', 'more than ten live pairing codes are denied');
    await f.deviceService.cancelPairing({ userId: actor.userId, pairingId: pairingIds[0] });
    const pairId = randomUUID(); result = await f.request(owner, 'POST', '/sections/devices/operations', { operationId: pairId, kind: 'pair', targetId: null, revision: null, input: { name: 'Fixture laptop' } });
    assert.equal(result.statusCode, 200); const pairResult = result.json().result;
    assert.equal(await tableCount('device_pairing_codes', 'user_id=$1 AND device_name=\'Expired fixture\'', [actor.userId]), 0, 'expired unreferenced pairing code is cleaned on a permitted creation');
    assert.match(pairResult.code, /^[A-Z0-9-]+$/); assert.equal(pairResult.codeAvailable, true);
    const receipt = await f.request(owner, 'GET', `/sections/devices/operations/${pairId}`); assert.equal(receipt.json().result.code, pairResult.code);
    const nextSession = await f.login('101'); assert.equal((await f.request(nextSession, 'GET', `/sections/devices/operations/${pairId}`)).json().result.code, null);
    const cancelPairId = randomUUID(); result = await f.request(owner, 'POST', '/sections/devices/operations', { operationId: cancelPairId, kind: 'pair.cancel', targetId: pairResult.pairingId, revision: null, input: {} });
    assert.equal(result.statusCode, 200); assert.equal((await f.pool.query('SELECT consumed_at FROM device_pairing_codes WHERE id=$1', [pairResult.pairingId])).rows[0].consumed_at !== null, true);

    const event = await f.pool.query(`INSERT INTO life_events(user_id,event_type,occurred_at,source_channel,source_ref,deduplication_key,summary,trust_level)
      VALUES($1,'message.received',now(),'telegram','fixture:event','fixture:event','Fixture source','user') RETURNING id`, [actor.userId]);
    const commitment = await f.pool.query(`INSERT INTO life_commitments(user_id,source_event_id,title,confidence) VALUES($1,$2,'Fixture commitment',1) RETURNING id,revision`, [actor.userId,event.rows[0].id]);
    const project = await f.pool.query(`INSERT INTO life_projects(user_id,name) VALUES($1,'Fixture project') RETURNING id`, [actor.userId]);
    const createReminderId = randomUUID(); result = await f.request(owner, 'POST', '/sections/life/operations', { operationId: createReminderId, kind: 'reminder.create', targetId: null, revision: null, input: { title: 'Fixture reminder', triggerAt: '2026-12-01T10:30' } });
    assert.equal(result.statusCode, 200); const reminderId = result.json().result.id;
    let target = (await f.request(owner, 'GET', `/sections/life/actions/reminder.reschedule/${reminderId}`)).json().target;
    result = await f.request(owner, 'POST', '/sections/life/operations', { operationId: randomUUID(), kind: 'reminder.reschedule', targetId: reminderId, revision: target.revision, input: { triggerAt: '2026-12-02T11:00' } });
    assert.equal(result.statusCode, 200); target = (await f.request(owner, 'GET', `/sections/life/actions/reminder.cancel/${reminderId}`)).json().target;
    result = await f.request(owner, 'POST', '/sections/life/operations', { operationId: randomUUID(), kind: 'reminder.cancel', targetId: reminderId, revision: target.revision, input: {} });
    assert.equal(result.statusCode, 200); assert.equal((await f.pool.query('SELECT state FROM life_reminders WHERE id=$1', [reminderId])).rows[0].state, 'cancelled');
    target = (await f.request(owner, 'GET', `/sections/life/actions/commitment.complete/${commitment.rows[0].id}`)).json().target;
    result = await f.request(owner, 'POST', '/sections/life/operations', { operationId: randomUUID(), kind: 'commitment.complete', targetId: commitment.rows[0].id, revision: target.revision, input: {} });
    assert.equal(result.statusCode, 200); assert.equal((await f.pool.query('SELECT status FROM life_commitments WHERE id=$1', [commitment.rows[0].id])).rows[0].status, 'completed');
    const event2 = await f.pool.query(`INSERT INTO life_events(user_id,event_type,occurred_at,source_channel,source_ref,deduplication_key,summary,trust_level)
      VALUES($1,'message.received',now(),'telegram','fixture:event:2','fixture:event:2','Fixture source 2','user') RETURNING id`, [actor.userId]);
    const commitment2 = await f.pool.query(`INSERT INTO life_commitments(user_id,source_event_id,title,confidence) VALUES($1,$2,'Fixture commitment to dismiss',1) RETURNING id,revision`, [actor.userId,event2.rows[0].id]);
    target = (await f.request(owner, 'GET', `/sections/life/actions/commitment.dismiss/${commitment2.rows[0].id}`)).json().target;
    result = await f.request(owner, 'POST', '/sections/life/operations', { operationId: randomUUID(), kind: 'commitment.dismiss', targetId: commitment2.rows[0].id, revision: target.revision, input: {} });
    assert.equal(result.statusCode, 200); assert.equal((await f.pool.query('SELECT status FROM life_commitments WHERE id=$1', [commitment2.rows[0].id])).rows[0].status, 'dismissed');
    const projectId = project.rows[0].id;
    for (const [kind, pinned, hidden] of [['project.pin', true, false], ['project.hide', false, true], ['project.restore', false, false]]) {
      const current = await f.pool.query('SELECT revision FROM life_project_priority_state WHERE project_id=$1 AND user_id=$2', [projectId, actor.userId]);
      const revision = current.rows[0]?.revision ?? null;
      result = await f.request(owner, 'POST', '/sections/life/operations', { operationId: randomUUID(), kind, targetId: projectId, revision, input: kind === 'project.hide' ? { hiddenUntil: '2026-12-03T12:00' } : {} });
      assert.equal(result.statusCode, 200, kind); const state = (await f.pool.query('SELECT pinned,hidden_until FROM life_project_priority_state WHERE project_id=$1 AND user_id=$2', [projectId, actor.userId])).rows[0];
      assert.equal(state.pinned, pinned); assert.equal(Boolean(state.hidden_until), hidden);
    }
    assert.equal((await f.request(member, 'GET', `/sections/life/actions/project.pin/${projectId}`)).statusCode, 404, 'other actor cannot resolve the owner project');
    assert.equal((await f.request(owner, 'POST', '/sections/life/operations', { operationId: randomUUID(), kind: 'project.pin', targetId: projectId, revision: 999, input: {} })).statusCode, 409);
    const canceledId = randomUUID(); assert.equal((await f.request(owner, 'POST', `/sections/life/operations/${canceledId}/cancel`, {})).statusCode, 200);
    result = await f.request(owner, 'POST', '/sections/life/operations', { operationId: canceledId, kind: 'reminder.create', targetId: null, revision: null, input: { title: 'Late fixture', triggerAt: '2026-12-05T10:00' } });
    assert.equal(result.json().status, 'cancelled');
    assert.equal(await tableCount('life_reminders', 'user_id=$1 AND title=\'Late fixture\'', [actor.userId]), 0);
    assert.equal((await f.request(owner, 'POST', `/sections/life/operations/${randomUUID()}/cancel`, {}, { 'x-jarvis-csrf': 'wrong' })).statusCode, 403);

    // Simulate an acknowledgement lost after PostgreSQL committed the final
    // transaction. The prepared file and single row/receipt must remain resolvable.
    const connect = f.pool.connect.bind(f.pool);
    let commits = 0;
    f.pool.connect = (callback) => {
      // Pool.query uses callback-style connect; fault injection must preserve it.
      if (typeof callback === 'function') return connect(callback);
      return connect().then((client) => {
        const query = client.query, release = client.release;
        client.query = async (sql, ...args) => {
          const isCommit = typeof sql === 'string' && sql.trim().toUpperCase() === 'COMMIT';
          const value = await query.call(client, sql, ...args);
          if (isCommit && ++commits === 2) throw new Error('test-only lost COMMIT acknowledgement');
          return value;
        };
        client.release = (...args) => { client.query = query; client.release = release; return release(...args); };
        return client;
      });
    };
    const ambiguousId = randomUUID();
    result = await f.request(owner, 'POST', `/sections/documents/uploads/${ambiguousId}`, payload, headers);
    f.pool.connect = connect;
    assert.notEqual(result.statusCode, 200, 'lost commit acknowledgement is not reported as success');
    const recovered = await f.request(owner, 'GET', `/sections/documents/operations/${ambiguousId}`);
    assert.equal(recovered.statusCode, 200); assert.equal(recovered.json().status, 'completed');
    const recoveredDoc = await f.pool.query('SELECT id,storage_key FROM documents WHERE user_id=$1 AND id=$2', [actor.userId, recovered.json().result.id]);
    assert.equal(recoveredDoc.rowCount, 1); assert.deepEqual(await fs.readFile(path.join(f.root, recoveredDoc.rows[0].storage_key)), payload);
    assert.equal(await tableCount('mini_app_personal_operations', 'user_id=$1 AND operation_id=$2', [actor.userId, ambiguousId]), 1);

    // Existing receipts stay readable after the per-day cap; new operations stop.
    await f.pool.query(`INSERT INTO mini_app_personal_operations(user_id,operation_id,section,status)
      SELECT $1,gen_random_uuid(),'life','cancelled' FROM generate_series(1,1000)`, [actor.userId]);
    assert.equal((await f.request(owner, 'GET', `/sections/documents/operations/${uploadId}`)).statusCode, 200);
    const overLimit = await f.request(owner, 'POST', `/sections/life/operations/${randomUUID()}/cancel`, {});
    assert.equal(overLimit.json().code, 'limit_reached', 'new operation IDs are rate capped');
  } finally { await f.close(); }
});
