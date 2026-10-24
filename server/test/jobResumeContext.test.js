const test = require('node:test');
const assert = require('node:assert/strict');
const { JobResumeContextService, resumeSnapshotSchema } = require('../src/jobs/jobResumeContextService');
const { createJobPostgresFixture } = require('./helpers/jobPostgresFixture');
const { configuredOwnerJobAccess } = require('../src/jobs/configuredOwnerJobAccess');

const scope = { userId: '11111111-1111-4111-8111-111111111111', conversationId: '22222222-2222-4222-8222-222222222222', chatId: '101', channel: 'telegram' };
const snapshot = { resumeId: 'mine', title: 'Аналитик', experience: 'Автоматизация отчётности', skills: 'Excel', education: '', summary: '', grammaticalGender: 'unknown' };
test('selected resume context rechecks connection after read and never substitutes another ID', async () => {
  let revision = 1, id = 'mine', reads = 0;
  const pool = { async query(sql) {
    if (sql.includes('job_connections')) return { rows: [{ status: 'connected', resume_id: id, revision }] };
    return { rows: [{ id: scope.userId }], rowCount: 1 };
  } };
  const browserClient = { forUser(userId) { assert.equal(userId, scope.userId); return { async readResume({ resumeId }) {
    reads++; assert.equal(resumeId, 'mine'); return snapshot;
  } }; } };
  const accessService = { repository: { async get() { return { permissions: ['jobs'], blocked: false }; } } };
  const service = new JobResumeContextService({ pool, browserClient, accessService });
  // Scope checking is exercised by the real DB acceptance; this unit verifies the snapshot and two reads.
  const result = await service.getSelected({ scope });
  assert.equal(result.snapshot, snapshot); assert.equal(reads, 1);
  id = 'other';
  await assert.rejects(service.assertCurrent({ scope, resumeId: result.resumeId, connectionRevision: result.connectionRevision }), { code: 'JOB_REVISION_CONFLICT' });
  id = 'mine'; revision++;
  await assert.rejects(service.assertCurrent({ scope, resumeId: result.resumeId, connectionRevision: result.connectionRevision }), { code: 'JOB_REVISION_CONFLICT' });
});
test('resume snapshot schema refuses contact data and guessed gender', () => {
  assert.equal(resumeSnapshotSchema(snapshot, 'mine'), snapshot);
  assert.throws(() => resumeSnapshotSchema({ ...snapshot, summary: 'Email: person@example.com' }, 'mine'), { code: 'JOB_HH_RESUME_UNAVAILABLE' });
  assert.throws(() => resumeSnapshotSchema({ ...snapshot, grammaticalGender: 'female', phone: 'private' }, 'mine'), { code: 'JOB_HH_RESUME_UNAVAILABLE' });
});

test('real PostgreSQL: only personal selected resume is read and changed selection fails closed',
  { skip: !process.env.JARVIS_JOB_TEST_DATABASE_URL }, async () => {
  const f = await createJobPostgresFixture();
  try {
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
    await f.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,'mine','connected')", [f.owner]);
    let reads = 0, swap = false;
    const service = new JobResumeContextService({ pool: f.pool,
      accessService: configuredOwnerJobAccess(f.pool, '101'), browserClient: { forUser(userId) {
        assert.equal(userId, f.owner); return { async readResume({ resumeId }) {
          reads++; assert.equal(resumeId, 'mine');
          if (swap) await f.pool.query("UPDATE job_connections SET resume_id='other',revision=revision+1 WHERE user_id=$1", [f.owner]);
          return snapshot;
        } };
      } } });
    assert.equal((await service.getSelected({ scope: f.scope })).snapshot.title, 'Аналитик');
    swap = true;
    await assert.rejects(service.getSelected({ scope: f.scope }), { code: 'JOB_REVISION_CONFLICT' });
    assert.equal(reads, 2);
    await assert.rejects(service.getSelected({ scope: { ...f.scope, userId: f.stranger } }), { code: 'JOB_SCOPE_DENIED' });
    assert.equal(reads, 2);
  } finally { await f.close(); }
});

test('disconnected resume is optional, connected read failures and disabled access fail closed',
  { skip: !process.env.JARVIS_JOB_TEST_DATABASE_URL }, async () => {
  const f = await createJobPostgresFixture();
  try {
    await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101')", [f.owner]);
    await f.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,NULL,'disconnected')", [f.owner]);
    let reads = 0;
    const accessService = configuredOwnerJobAccess(f.pool, '101');
    const service = new JobResumeContextService({ pool: f.pool, accessService,
      browserClient: { forUser() { return { async readResume() { reads++; throw new Error('fixture browser read failed'); } }; } } });
    assert.equal(await service.getSelected({ scope: f.scope }), null,
      'a missing/disconnected connection means there is no resume context');
    assert.equal(reads, 0, 'disconnected state does not call the browser');

    await f.pool.query("UPDATE job_connections SET status='connected',resume_id='fixtureResume' WHERE user_id=$1", [f.owner]);
    await assert.rejects(service.getSelected({ scope: f.scope }), /fixture browser read failed/,
      'a connected resume read failure is visible instead of being treated as no resume');
    assert.equal(reads, 1);

    const disabled = new JobResumeContextService({ pool: f.pool,
      accessService: { repository: { async get() { return { blocked: false, permissions: [] }; } } },
      browserClient: { forUser() { return { async readResume() { reads++; return snapshot; } }; } } });
    await assert.rejects(disabled.getSelected({ scope: f.scope }), { code: 'JOB_SCOPE_DENIED' });
    assert.equal(reads, 1, 'disabled job access is rejected before any browser read');
  } finally { await f.close(); }
});
