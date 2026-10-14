const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { JobSearchRepository } = require('../src/jobs/jobSearchRepository');
const { JobDeliveryRepository } = require('../src/jobs/jobDeliveryRepository');
const { JobDeliveryWorker } = require('../src/jobs/jobDeliveryWorker');

test('real PG delivery: rate limits, lost acknowledgements, pause, hidden and revoked owner', async () => {
  const f = await createJobPostgresFixture(); let calls = 0, mode = 'rate';
  const search = new JobSearchRepository(f.pool), deliveries = new JobDeliveryRepository(f.pool);
  const worker = new JobDeliveryWorker({ pool: f.pool, searchRepository: search, deliveryRepository: deliveries,
    send: async () => { calls++;
      if (mode === 'rate') throw { error_code: 429, parameters: { retry_after: 2 } };
      if (mode === 'lost') throw new Error('Synthetic dropped acknowledgement');
      return { message_id: calls };
    } });
  const state = async (id) => (await f.pool.query('SELECT * FROM job_deliveries WHERE id=$1', [id])).rows[0];
  const queue = async (id) => {
    const vacancy = await search.upsertVacancy({ externalId: id, snapshot: { title: 'AI Engineer',
      publishedAt: '2026-10-15', url: `https://hh.ru/vacancy/${id}` } });
    await search.recordMatch({ userId: f.owner, vacancyId: vacancy.id, filterRevision: 1 });
    return { vacancy, delivery: await deliveries.enqueue({ userId: f.owner, vacancyId: vacancy.id }) };
  };
  try {
    await search.ensure({ scope: f.scope });
    const limited = await queue('101');
    for (let attempt = 1; attempt <= 4; attempt++) {
      await worker.tick();
      const row = await state(limited.delivery.id);
      assert.equal(row.status, attempt < 4 ? 'queued' : 'failed');
      assert.equal(row.attempts, attempt);
      if (attempt < 4) {
        assert.ok(new Date(row.available_at) > new Date());
        await f.pool.query('UPDATE job_deliveries SET available_at=now() WHERE id=$1', [row.id]);
      }
    }
    mode = 'lost'; const lost = await queue('102');
    await worker.tick(); assert.equal((await state(lost.delivery.id)).status, 'unknown');
    await worker.tick(); assert.equal(calls, 5, 'unknown delivery is never resent');
    mode = 'ok'; const paused = await queue('103');
    await f.pool.query(`UPDATE job_searches SET settings=jsonb_set(settings,'{paused}','true')`);
    await f.pool.query(`INSERT INTO job_deliveries(user_id,kind,dedup_key,payload)
      VALUES($1,'budget','fixture-budget','{"month":"2026-10","thresholdUsd":3}')`, [f.owner]);
    await worker.tick(); assert.equal(calls, 6, 'budget notice is delivered while cards are paused');
    assert.equal((await state(paused.delivery.id)).status, 'queued');
    await f.pool.query(`UPDATE job_searches SET settings=jsonb_set(settings,'{paused}','false')`);
    await search.mark({ scope: f.scope, vacancyId: paused.vacancy.id, action: 'hide' });
    await worker.tick(); assert.equal(calls, 6, 'hidden card is not sent');
    const revoked = await queue('104');
    await f.pool.query("UPDATE users SET role='member' WHERE id=$1", [f.owner]);
    await worker.tick(); assert.equal(calls, 6, 'revoked owner receives no private job data');
    assert.equal((await state(revoked.delivery.id)).status, 'queued');
    await f.pool.query("UPDATE users SET role='owner' WHERE id=$1", [f.owner]);
    await worker.tick(); assert.equal((await state(revoked.delivery.id)).status, 'sent');
    const orphan = await queue('105'); await deliveries.claim();
    await f.pool.query("UPDATE job_deliveries SET lease_until=now()-interval '1 second' WHERE id=$1", [orphan.delivery.id]);
    await worker.tick(); assert.equal((await state(orphan.delivery.id)).status, 'unknown');
    assert.equal(calls, 7);
  } finally { await worker.close(); await f.close(); }
});
