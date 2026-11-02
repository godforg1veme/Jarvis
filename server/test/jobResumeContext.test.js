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
  // Scope checking is exercised by the real DB acceptance.
  const result = await service.getSelected({ scope });
  assert.deepEqual(result.snapshot, snapshot); assert.notEqual(result.snapshot, snapshot); assert.equal(reads, 1);
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
    await f.pool.query("UPDATE job_connections SET revision=revision+1 WHERE user_id=$1", [f.owner]);
    swap = true;
    await assert.rejects(service.getSelected({ scope: f.scope }), { code: 'JOB_REVISION_CONFLICT' });
    assert.equal(reads, 2);
    await assert.rejects(service.getSelected({ scope: { ...f.scope, userId: f.stranger } }), { code: 'JOB_SCOPE_DENIED' });
    assert.equal(reads, 2);
  } finally { await f.close(); }
});

test('short resume reuse still checks scope and connection; complete reads can serve later partial requests', async () => {
  let time = 0, revision = 1, id = 'mine', allowed = true, reads = 0;
  const pool = { async query(sql) {
    if (sql.includes('job_connections')) return { rows: [{ status: 'connected', resume_id: id, revision }] };
    return { rows: [{ id: scope.userId }], rowCount: 1 };
  } };
  const accessService = { repository: { async get() {
    return { permissions: allowed ? ['jobs'] : [], blocked: false };
  } } };
  const browserClient = { forUser() { return { async readResume({ resumeId, requireComplete }) {
    reads++;
    assert.equal(resumeId, id);
    return { ...snapshot, resumeId, title: requireComplete ? 'Полное резюме' : 'Краткое резюме' };
  } }; } };
  const service = new JobResumeContextService({ pool, browserClient, accessService, now: () => time });
  const first = await service.getSelected({ scope, requireComplete: true });
  first.snapshot.title = 'изменено вызывающим кодом';
  assert.equal((await service.getSelected({ scope })).snapshot.title, 'Полное резюме');
  assert.equal(reads, 1);
  allowed = false;
  await assert.rejects(service.getSelected({ scope }), { code: 'JOB_SCOPE_DENIED' });
  assert.equal(reads, 1);
  allowed = true;
  revision++;
  assert.equal((await service.getSelected({ scope })).snapshot.title, 'Краткое резюме');
  assert.equal(reads, 2);
  id = 'other';
  assert.equal((await service.getSelected({ scope })).resumeId, 'other');
  assert.equal(reads, 3);
  time += 60_001;
  await service.getSelected({ scope });
  assert.equal(reads, 4);
});

test('partial snapshot cannot satisfy complete requirement; failed and parallel reads are handled safely', async () => {
  let reads = 0, fail = false, resolveRead;
  const pool = { async query(sql) {
    if (sql.includes('job_connections')) return { rows: [{ status: 'connected', resume_id: 'mine', revision: 1 }] };
    return { rows: [{ id: scope.userId }], rowCount: 1 };
  } };
  const accessService = { repository: { async get() { return { permissions: ['jobs'], blocked: false }; } } };
  const browserClient = { forUser() { return { async readResume({ requireComplete }) {
    reads++;
    if (fail) throw Error('read failed');
    if (requireComplete) return new Promise(resolve => { resolveRead = resolve; });
    return snapshot;
  } }; } };
  const service = new JobResumeContextService({ pool, browserClient, accessService });
  await service.getSelected({ scope });
  const a = service.getSelected({ scope, requireComplete: true });
  const b = service.getSelected({ scope, requireComplete: true });
  while (!resolveRead) await new Promise(resolve => setImmediate(resolve));
  resolveRead(snapshot);
  assert.deepEqual((await a).snapshot, snapshot);
  assert.deepEqual((await b).snapshot, snapshot);
  assert.equal(reads, 2, 'two simultaneous complete requests share one browser read');
  service.cache.clear();
  fail = true;
  await assert.rejects(service.getSelected({ scope }), /read failed/);
  await assert.rejects(service.getSelected({ scope }), /read failed/);
  assert.equal(reads, 4, 'failed browser reads are never reused');
});

test('identical resume IDs and revisions never share a cached snapshot between users', async () => {
  const other = { ...scope, userId: '33333333-3333-4333-8333-333333333333',
    conversationId: '44444444-4444-4444-8444-444444444444', chatId: '202' };
  let reads = 0;
  const pool = { async query(sql, args) {
    if (sql.includes('job_connections')) return { rows: [{ status: 'connected', resume_id: 'mine', revision: 1 }] };
    assert.ok([scope.userId, other.userId].includes(args[1]));
    assert.equal(args[2], args[1] === scope.userId ? '101' : '202');
    return { rows: [{ id: args[1] }], rowCount: 1 };
  } };
  const accessService = { repository: { async get() { return { permissions: ['jobs'], blocked: false }; } } };
  const browserClient = { forUser(userId) { return { async readResume() {
    reads++;
    return { ...snapshot, title: userId === scope.userId ? 'Первый' : 'Второй' };
  } }; } };
  const service = new JobResumeContextService({ pool, browserClient, accessService });
  assert.equal((await service.getSelected({ scope })).snapshot.title, 'Первый');
  assert.equal((await service.getSelected({ scope: other })).snapshot.title, 'Второй');
  assert.equal((await service.getSelected({ scope })).snapshot.title, 'Первый');
  assert.equal(reads, 2);
});

test('revoked access or changed connection during shared browser read rejects every waiter', async () => {
  for (const changed of ['access', 'connection']) {
    let allowed = true, revision = 1, reads = 0, resolveRead;
    const pool = { async query(sql) {
      if (sql.includes('job_connections')) return { rows: [{ status: 'connected', resume_id: 'mine', revision }] };
      return { rows: [{ id: scope.userId }], rowCount: 1 };
    } };
    const accessService = { repository: { async get() {
      return { permissions: allowed ? ['jobs'] : [], blocked: false };
    } } };
    const browserClient = { forUser() { return { readResume() {
      reads++;
      return new Promise(resolve => { resolveRead = resolve; });
    } }; } };
    const service = new JobResumeContextService({ pool, browserClient, accessService });
    const a = service.getSelected({ scope });
    const b = service.getSelected({ scope });
    while (!resolveRead) await new Promise(resolve => setImmediate(resolve));
    if (changed === 'access') allowed = false;
    else revision++;
    resolveRead(snapshot);
    const code = changed === 'access' ? 'JOB_SCOPE_DENIED' : 'JOB_REVISION_CONFLICT';
    await assert.rejects(a, { code });
    await assert.rejects(b, { code });
    assert.equal(reads, 1);
  }
});

test('resume cache is bounded and evicts old entries', async () => {
  let revision = 1, reads = 0;
  const pool = { async query(sql) {
    if (sql.includes('job_connections')) return { rows: [{ status: 'connected', resume_id: 'mine', revision }] };
    return { rows: [{ id: scope.userId }], rowCount: 1 };
  } };
  const accessService = { repository: { async get() { return { permissions: ['jobs'], blocked: false }; } } };
  const browserClient = { forUser() { return { async readResume() { reads++; return snapshot; } }; } };
  const service = new JobResumeContextService({ pool, browserClient, accessService });
  for (revision = 1; revision <= 33; revision++) await service.getSelected({ scope });
  assert.equal(service.cache.size, 32);
  revision = 1;
  await service.getSelected({ scope });
  assert.equal(reads, 34, 'oldest entry is read again after eviction');
  assert.equal(service.cache.size, 32);
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
