const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { LifeEventRepository } = require('../src/life/lifeEventRepository');
const { LifeProjectionRepository } = require('../src/life/lifeProjectionRepository');
const { LifeEventGateway } = require('../src/life/lifeEventGateway');
const { LifeProjectionWorker } = require('../src/life/lifeProjectionWorker');
const { LifeLinker } = require('../src/life/lifeLinker');
const { CommitmentDetector } = require('../src/life/commitmentDetector');
const { LifeEnrichmentService } = require('../src/life/lifeEnrichmentService');
const { TimelineService } = require('../src/life/timelineService');
const { ContextRecoveryService } = require('../src/life/contextRecoveryService');
const { ProposalService } = require('../src/life/proposalService');
const { PeopleRepository } = require('../src/life/people/peopleRepository');
const { LifeModeRepository } = require('../src/life/modes/lifeModeRepository');
const { LifePreferenceRepository } = require('../src/life/preferences/lifePreferenceRepository');
const { ReminderRepository } = require('../src/life/reminders/reminderRepository');
const { RecoveryPlanRepository } = require('../src/life/recovery/recoveryPlanRepository');
const { SourceConnectionRepository } = require('../src/life/sources/sourceConnectionRepository');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Life OS PostgreSQL acceptance');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  const schema = `life_accept_${process.pid}_${Date.now()}`.toLowerCase();
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '99999999-9999-4999-8999-999999999999';
  const deviceId = '22222222-2222-4222-8222-222222222222';
  const conversationId = '33333333-3333-4333-8333-333333333333';
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}, public`);
    await client.query(`
      CREATE TABLE users (id uuid PRIMARY KEY, role text NOT NULL CHECK (role IN ('owner', 'member')));
      CREATE TABLE devices (id uuid PRIMARY KEY, user_id uuid NOT NULL, name text, status text, last_seen_at timestamptz, capabilities jsonb DEFAULT '{}', UNIQUE(id, user_id));
      CREATE TABLE conversations (id uuid PRIMARY KEY, user_id uuid NOT NULL, UNIQUE(id, user_id));
      CREATE TABLE documents (id uuid PRIMARY KEY, user_id uuid NOT NULL, original_name text, media_type text, category text, status text, updated_at timestamptz DEFAULT now());
      CREATE TABLE memories (id uuid PRIMARY KEY, user_id uuid NOT NULL);
      CREATE TABLE action_workflows (id uuid PRIMARY KEY, user_id uuid NOT NULL, UNIQUE(id, user_id));
    `);
    for (const name of ['013_life_os_core.sql', '016_life_os_v2.sql', '017_life_os_reminders.sql']) {
      const migration = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', name), 'utf8');
      await client.query(migration);
    }
    await client.query("INSERT INTO users(id,role) VALUES ($1,'owner'), ($2,'member')", [userId, otherUserId]);
    await client.query("INSERT INTO devices(id,user_id,name,status) VALUES ($1,$2,'Jarvis Desktop','online')", [deviceId, userId]);
    await client.query('INSERT INTO conversations(id,user_id) VALUES ($1,$2)', [conversationId, userId]);

    const scopedQuery = (...args) => client.query(...args);
    const transactionQuery = (...args) => {
      const sql = String(args[0] || '').trim().toUpperCase();
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve({ rows: [], rowCount: 0 });
      return client.query(...args);
    };
    const scopedPool = { query: scopedQuery, connect: async () => ({ query: transactionQuery, release() {} }) };
    const eventRepository = new LifeEventRepository(scopedPool);
    const projectionRepository = new LifeProjectionRepository(scopedPool);
    const gateway = new LifeEventGateway({ repository: eventRepository });
    await projectionRepository.ensureDefaultAreas({ userId });
    const project = await projectionRepository.createProject({ userId, name: 'Life OS', summary: 'Integrated acceptance' });
    const event = await gateway.record({
      userId, eventType: 'voice.transcribed', occurredAt: new Date(), sourceChannel: 'desktop',
      sourceRef: 'desktop:acceptance:voice', sourceDeviceId: deviceId,
      deduplicationKey: 'acceptance:voice:1', summary: 'Завтра вечером я продолжу проект Life OS',
      structuredData: { conversationId, messageKind: 'voice' }, trustLevel: 'user', privacyClass: 'personal',
    });
    const enrichment = new LifeEnrichmentService({
      linker: new LifeLinker({ repository: projectionRepository }),
      commitmentDetector: new CommitmentDetector({ now: () => new Date('2026-09-13T10:00:00+03:00') }),
      repository: projectionRepository, gateway,
    });
    const worker = new LifeProjectionWorker({ eventRepository, projectionRepository, enrich: (item) => enrichment.enrich(item) });
    assert.equal(await worker.tick(), 1);
    const commitments = await projectionRepository.listCommitments({ userId, projectId: project.id });
    assert.equal(commitments.length, 1);
    assert.equal(commitments[0].title, 'Завтра вечером я продолжу проект Life OS');
    const timeline = await new TimelineService({ repository: projectionRepository }).list({ userId, projectId: project.id, limit: 20 });
    assert.equal(timeline.items.some((item) => item.id === event.id), true);
    const context = await new ContextRecoveryService({ repository: projectionRepository }).recover({ userId, projectId: project.id });
    assert.equal(context.commitments.length, 1);
    const proposalService = new ProposalService({ repository: projectionRepository, gateway });
    const proposal = await proposalService.create({
      userId, projectId: project.id, commitmentId: commitments[0].id,
      title: 'Вернуться к Life OS', explanation: 'Срок договорённости приближается.', riskClass: 'safe',
      actionName: null, actionArguments: {}, originChannel: 'desktop', originConversationId: conversationId,
      originDeviceId: deviceId, cooldownKey: 'acceptance:commitment:reminder',
      expiresAt: new Date(Date.now() + 86400000), evidenceEventIds: [event.id],
    });
    const completed = await proposalService.confirm({ userId, proposalId: proposal.id, revision: proposal.revision, originChannel: 'desktop', originDeviceId: deviceId });
    assert.equal(completed.status, 'completed');

    const people = new PeopleRepository(scopedPool);
    const person = await people.createPerson({ userId, displayName: 'Участник проекта', relationshipType: 'colleague', aliases: [], notes: '' });
    assert.ok(person?.id);
    assert.ok(await people.createProjectLink({ userId, personId: person.id, projectId: project.id, role: 'participant' }));
    const grant = await people.createFamilyGrant({ userId, memberUserId: otherUserId, resourceType: 'project', resourceId: project.id, permission: 'view_summary' });
    assert.ok(grant?.id);
    assert.equal((await people.listSharedSummaries({ memberUserId: otherUserId })).length, 1);
    assert.equal(await people.getPerson({ userId: otherUserId, personId: person.id }), null);

    const mode = await new LifeModeRepository(scopedPool).set({ userId, mode: 'focus', source: 'manual', revision: null });
    assert.equal(mode.mode, 'focus');
    const preference = await new LifePreferenceRepository(scopedPool).setExplicit({ userId, key: 'initiative.level', value: 'minimal', revision: null });
    assert.equal(preference.value, 'minimal');

    const reminderRepository = new ReminderRepository(scopedPool);
    const reminder = await reminderRepository.create({ userId, commitmentId: commitments[0].id, projectId: project.id,
      title: 'Продолжить Life OS', triggerAt: '2026-09-14T17:00:00+03:00', timezone: 'Europe/Moscow',
      deliveryChannels: ['desktop'], originChannel: 'desktop', originDeviceId: deviceId,
      idempotencyKey: 'acceptance:v2:reminder' });
    assert.ok(reminder?.id);
    assert.equal((await reminderRepository.list({ userId: otherUserId })).length, 0);

    const recoveryRepository = new RecoveryPlanRepository(scopedPool);
    const recovery = await recoveryRepository.create({ userId, projectId: project.id, sourceContextRevision: project.revision,
      summary: 'Подготовить рабочее пространство Life OS', creationReason: 'acceptance', originChannel: 'desktop',
      originDeviceId: deviceId, idempotencyKey: 'acceptance:v2:recovery', expiresAt: new Date(Date.now() + 86400000),
      steps: [{ position: 0, stepType: 'prepare_workspace', label: 'Подготовить рабочее пространство',
        riskClass: 'changing', actionName: 'workspace.prepare', dependsOnPositions: [] }] });
    assert.equal(recovery.steps.length, 1);
    assert.equal(await recoveryRepository.get({ userId: otherUserId, planId: recovery.id }), null);

    const source = await new SourceConnectionRepository(scopedPool).create({ userId, adapterType: 'calendar',
      displayName: 'Acceptance fixture', enabled: false, selectedScope: {}, privacyPolicyVersion: 1,
      configurationMetadata: {} });
    assert.ok(source?.id);
    assert.equal((await new SourceConnectionRepository(scopedPool).list({ userId: otherUserId })).length, 0);
    await gateway.record({ userId: otherUserId, eventType: 'message.received', occurredAt: new Date(), sourceChannel: 'telegram', sourceRef: 'other:1', deduplicationKey: 'other:1', summary: 'private other owner event', structuredData: {}, trustLevel: 'user', privacyClass: 'personal' });
    const ownerTimeline = await new TimelineService({ repository: projectionRepository }).list({ userId, limit: 100 });
    assert.equal(ownerTimeline.items.some((item) => item.summary.includes('other owner')), false);
    console.log(JSON.stringify({ ok: true, version: 2, project: Boolean(project.id), commitment: commitments.length,
      proposal: completed.status, person: Boolean(person.id), grant: Boolean(grant.id), mode: mode.mode,
      preference: preference.value, reminder: Boolean(reminder.id), recovery: recovery.status,
      source: source.adapter_type, ownerIsolation: true }));
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
