const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { configuredOwnerJobAccess } = require('../src/jobs/configuredOwnerJobAccess');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobDeliveryRepository } = require('../src/jobs/jobDeliveryRepository');
const { JobDeliveryWorker } = require('../src/jobs/jobDeliveryWorker');
const runUntil = '2026-10-23T19:00:00.000Z';

async function setup() {
  const f = await createJobPostgresFixture();
  const access = configuredOwnerJobAccess(f.pool, '101');
  const search = new JobSearchRepository(f.pool, { accessService: access });
  const delivery = new JobDeliveryRepository(f.pool, { accessService: access });
  await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
  let settings = await search.ensure({ scope: f.scope });
  await search.saveSettings({ scope: f.scope, expectedRevision: settings.revision,
    settings: { ...settings.settings, queries: ['Fixture'], activated: true, paused: false } });
  await f.pool.query('UPDATE job_searches SET progress=$1 WHERE user_id=$2', [JSON.stringify({ until: runUntil, windows: [] }), f.owner]);
  return { f, access, search, delivery };
}

test('PostgreSQL collection notice is owner/admin/member scoped and deduplicated across lost acknowledgements', async () => {
  const { f, access, search, delivery } = await setup();
  const scopes = [f.scope];
  const calls = [];
  const role = (await f.pool.query("INSERT INTO access_roles(name) VALUES('Fixture jobs') RETURNING id")).rows[0].id;
  await f.pool.query("INSERT INTO access_role_permissions(role_id,permission) VALUES($1,'jobs')", [role]);
  try {
    for (const [level, chat] of [['admin', '202'], ['member', '303']]) {
      const userId = (await f.pool.query("INSERT INTO users(display_name,role) VALUES('Fixture','member') RETURNING id")).rows[0].id;
      await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram',$2)", [userId, chat]);
      await f.pool.query('INSERT INTO access_memberships(user_id,telegram_id,level,role_id) VALUES($1,$2,$3,$4)', [userId, chat, level, role]);
      const conversationId = (await f.pool.query("INSERT INTO conversations(user_id,channel,external_chat_id) VALUES($1,'telegram',$2) RETURNING id", [userId, chat])).rows[0].id;
      const scope = { userId, conversationId, chatId: chat, channel: 'telegram' }; scopes.push(scope);
      const row = await search.ensure({ scope });
      await search.saveSettings({ scope, expectedRevision: row.revision, settings: { ...row.settings, queries: ['Fixture'], activated: true } });
      await f.pool.query('UPDATE job_searches SET progress=$1 WHERE user_id=$2', [JSON.stringify({ until: runUntil, windows: [] }), userId]);
    }
    const worker = new JobDeliveryWorker({ pool: f.pool, searchRepository: search, deliveryRepository: delivery, accessService: access,
      send: async message => { calls.push(message); if (message.chatId === '303') throw Error('lost ACK'); return { message_id: calls.length }; } });
    for (const scope of scopes) {
      await delivery.enqueueCollectionAttention({ userId: scope.userId, runUntil, code: 'JOB_COLLECTION_WINDOW_SATURATED' });
      await delivery.enqueueCollectionAttention({ userId: scope.userId, runUntil, code: 'JOB_HH_DOM_CHANGED' });
    }
    for (let i = 0; i < 6; i++) await worker.tick();
    assert.deepEqual(calls.map(c => c.chatId).sort(), ['101', '202', '303']);
    assert.ok(calls.every(c => c.answer.includes('Прогресс сохранён')));
    const rows = (await f.pool.query("SELECT status,count(*)::int AS n FROM job_deliveries WHERE payload->>'reason'='HH_COLLECTION_STATUS' GROUP BY status")).rows;
    assert.equal(rows.find(r => r.status === 'sent').n, 2);
    assert.equal(rows.find(r => r.status === 'unknown').n, 1);
    await worker.close();
  } finally { await f.close(); }
});

test('collection notices reject revoked access, foreign chat and obsolete completed runs before Telegram', async () => {
  const { f, access, search, delivery } = await setup(); let sends = 0;
  const worker = new JobDeliveryWorker({ pool: f.pool, searchRepository: search, deliveryRepository: delivery, accessService: access,
    send: async () => { sends++; return { message_id: sends }; } });
  try {
    await delivery.enqueueCollectionAttention({ userId: f.owner, runUntil, code: 'JOB_HH_DOM_CHANGED' });
    await f.pool.query("UPDATE job_deliveries SET payload=jsonb_set(payload,'{chatId}','\"999\"')");
    await worker.tick(); assert.equal(sends, 0);
    await delivery.enqueueCollectionAttention({ userId: f.owner, runUntil: '2026-10-23T20:00:00.000Z', code: 'JOB_HH_DOM_CHANGED' });
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_deliveries')).rows[0].n, 1, 'foreign run cannot enqueue');
    const later = '2026-10-23T20:00:00.000Z';
    await f.pool.query('UPDATE job_searches SET progress=$1 WHERE user_id=$2', [JSON.stringify({ until: later, windows: [] }), f.owner]);
    await delivery.enqueueCollectionAttention({ userId: f.owner, runUntil: later, code: 'JOB_HH_DOM_CHANGED' });
    await f.pool.query('UPDATE job_searches SET progress=NULL WHERE user_id=$1', [f.owner]);
    await worker.tick(); assert.equal(sends, 0, 'completed collection does not emit an obsolete failure');
    await assert.rejects(delivery.enqueueCollectionAttention({ userId: f.stranger, runUntil, code: 'JOB_HH_DOM_CHANGED' }), { code: 'JOB_SCOPE_DENIED' });
    await assert.rejects(delivery.enqueueCollectionAttention({ userId: f.owner, runUntil: 'invalid', code: 'SECRET' }));
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM job_deliveries')).rows[0].n, 2);
    await worker.close();
  } finally { await f.close(); }
});
