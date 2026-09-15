const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
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
const { LifeContextComposer } = require('../src/life/context/lifeContextComposer');
const { PriorityEngine } = require('../src/life/priority/priorityEngine');
const { ProposalService } = require('../src/life/proposalService');
const { CommitmentRepository } = require('../src/life/commitments/commitmentRepository');
const { CommitmentLifecycleService } = require('../src/life/commitments/commitmentLifecycleService');
const { ActionOrchestrator } = require('../src/orchestrator/actionOrchestrator');
const { createActionManifest } = require('../src/orchestrator/actionManifest');
const { DesktopCommandExecutor, ExecutorRegistry } = require('../src/orchestrator/executorRegistry');
const { WorkflowRepository } = require('../src/orchestrator/workflowRepository');
const { PeopleRepository } = require('../src/life/people/peopleRepository');
const { LifeModeRepository } = require('../src/life/modes/lifeModeRepository');
const { LifePreferenceRepository } = require('../src/life/preferences/lifePreferenceRepository');
const { ReminderRepository } = require('../src/life/reminders/reminderRepository');
const { RecoveryPlanRepository } = require('../src/life/recovery/recoveryPlanRepository');
const { SourceConnectionRepository } = require('../src/life/sources/sourceConnectionRepository');
const { executeToolRequest } = require('../../agents/toolGateway');
const { WorkspaceRegistry } = require('../../tools/workspaceRegistry');
const { WorkspacePreparationService } = require('../../tools/workspacePreparationService');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Life OS PostgreSQL acceptance');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  const schema = `life_accept_${process.pid}_${Date.now()}`.toLowerCase();
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '99999999-9999-4999-8999-999999999999';
  const deviceId = '22222222-2222-4222-8222-222222222222';
  const conversationId = '33333333-3333-4333-8333-333333333333';
  let temporaryRoot = null;
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
      CREATE TABLE commands (id uuid PRIMARY KEY, user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    `);
    for (const name of ['006_action_orchestrator.sql', '013_life_os_core.sql', '016_life_os_v2.sql', '017_life_os_reminders.sql', '018_life_os_proactivity_actions.sql']) {
      const migration = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', name), 'utf8');
      await client.query(migration);
    }
    await client.query("INSERT INTO users(id,role) VALUES ($1,'owner'), ($2,'member')", [userId, otherUserId]);
    await client.query("INSERT INTO devices(id,user_id,name,status,capabilities) VALUES ($1,$2,'Jarvis Desktop','online',$3::jsonb)", [deviceId, userId, JSON.stringify({ actions: ['workspace.prepare'] })]);
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
    const replayedEvent = await gateway.record({
      userId, eventType: 'voice.transcribed', occurredAt: event.occurred_at, sourceChannel: 'desktop',
      sourceRef: 'desktop:acceptance:voice', sourceDeviceId: deviceId,
      deduplicationKey: 'acceptance:voice:1', summary: 'Завтра вечером я продолжу проект Life OS',
      structuredData: { conversationId, messageKind: 'voice' }, trustLevel: 'user', privacyClass: 'personal',
    });
    assert.equal(replayedEvent.id, event.id);
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
    const replyContext = await new LifeContextComposer({
      repository: projectionRepository,
      priorityEngine: new PriorityEngine({ now: () => new Date('2026-09-13T10:00:00+03:00') }),
      now: () => new Date('2026-09-13T10:00:00+03:00'),
      deadlineMs: 1000,
    }).compose({ userId, channel: 'desktop', text: 'Что дальше по проекту Life OS?' });
    assert.equal(replyContext.status, 'fresh');
    assert.equal(replyContext.lifeContext.currentProject.name, 'Life OS');
    assert.equal(replyContext.lifeContext.items.some((item) => item.kind === 'commitment'), true);

    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-life-pg-'));
    const workspacePath = path.join(temporaryRoot, 'workspace');
    fs.mkdirSync(workspacePath);
    const workspaceRegistry = new WorkspaceRegistry({ filePath: path.join(temporaryRoot, 'workspaces.local.json') });
    assert.ok(workspaceRegistry.save({ projectId: project.id, label: 'Life OS PostgreSQL acceptance',
      appAliases: ['Fixture Editor'], fileSearchHints: [], localPaths: [workspacePath] }));
    let desktopDispatches = 0;
    let launchedApps = 0;
    let openedPaths = 0;
    const workspacePreparationService = new WorkspacePreparationService({
      registry: workspaceRegistry,
      appResolver: { resolve() { return { ok: true, app: { id: 'fixture-editor' } }; } },
      async launchApp() { launchedApps += 1; return { ok: true }; },
      shell: { async openPath(value) { assert.equal(value, workspacePath); openedPaths += 1; return ''; } },
    });
    const commands = new Map();
    const commandService = {
      async create(input) {
        desktopDispatches += 1;
        const command = { id: crypto.randomUUID(), user_id: input.userId, workflow_id: input.workflowId,
          action_run_id: input.actionRunId, action: input.action, arguments: input.args,
          policy: input.trustedPolicy, status: 'awaiting_confirmation', result: null };
        await client.query('INSERT INTO commands(id,user_id) VALUES ($1,$2)', [command.id, input.userId]);
        commands.set(command.id, command);
        return { status: 'awaiting_confirmation', command, prompt: 'Подтвердить подготовку рабочего пространства?' };
      },
      async get({ userId: scopedUserId, commandId }) {
        const command = commands.get(commandId);
        return command?.user_id === scopedUserId ? command : null;
      },
      async approve({ userId: scopedUserId, commandId, originChannel, originDeviceId }) {
        const command = commands.get(commandId);
        assert.equal(command?.user_id, scopedUserId);
        assert.equal(originChannel, 'desktop');
        assert.equal(originDeviceId, deviceId);
        command.result = await executeToolRequest({ action: command.action, args: command.arguments }, { confirmed: true, workspacePreparationService });
        command.status = command.result.ok ? 'succeeded' : 'failed';
        return { status: 'running', command };
      },
      async waitForTerminal({ userId: scopedUserId, commandId }) {
        const command = commands.get(commandId);
        return command?.user_id === scopedUserId ? command : null;
      },
    };
    const workflowRepository = new WorkflowRepository(scopedPool);
    const executors = new ExecutorRegistry().register('device', new DesktopCommandExecutor({ commandService }));
    const commitmentRepository = new CommitmentRepository(scopedPool);
    const commitmentLifecycleService = new CommitmentLifecycleService({ repository: commitmentRepository, gateway });
    const orchestrator = new ActionOrchestrator({
      repository: workflowRepository, manifest: createActionManifest(), executors, commandService,
      deviceRepository: { listForUser: async (scopedUserId) => scopedUserId === userId
        ? [{ id: deviceId, name: 'Jarvis Desktop', status: 'online', capabilities: { actions: ['workspace.prepare'] } }] : [] },
      lifeEventGateway: gateway, fastResultWaitMs: 100,
    });
    const proposalService = new ProposalService({ repository: projectionRepository, gateway,
      orchestrator, manifest: createActionManifest(), commitmentLifecycleService });
    const proposal = await proposalService.create({
      userId, projectId: project.id, commitmentId: commitments[0].id,
      title: 'Подготовить рабочее пространство Life OS', explanation: 'Срок договорённости приближается.', riskClass: 'changing',
      actionName: 'workspace.prepare', actionArguments: { projectId: project.id, capabilityClasses: ['applications', 'files'] },
      originChannel: 'desktop', originConversationId: conversationId,
      originDeviceId: deviceId, cooldownKey: 'acceptance:commitment:reminder',
      expiresAt: new Date(Date.now() + 86400000), evidenceEventIds: [event.id],
    });
    assert.equal(await proposalService.confirm({ userId: otherUserId, proposalId: proposal.id, revision: proposal.revision, originChannel: 'desktop', originDeviceId: deviceId }), null);
    assert.equal(await proposalService.confirm({ userId, proposalId: proposal.id, revision: proposal.revision, originChannel: 'desktop', originDeviceId: otherUserId }), null);
    const completed = await proposalService.confirm({ userId, proposalId: proposal.id, revision: proposal.revision, originChannel: 'desktop', originDeviceId: deviceId });
    assert.equal(completed.status, 'completed');
    assert.equal(desktopDispatches, 1);
    assert.equal(launchedApps, 1);
    assert.equal(openedPaths, 1);
    assert.equal(await proposalService.confirm({ userId, proposalId: proposal.id, revision: completed.revision, originChannel: 'desktop', originDeviceId: deviceId }), null);
    assert.equal(desktopDispatches, 1);
    const completedCommitment = await commitmentRepository.get({ userId, commitmentId: commitments[0].id });
    assert.equal(completedCommitment.status, 'completed');
    assert.doesNotMatch(JSON.stringify([...commands.values()].map((command) => command.result)), /jarvis-life-pg|workspaces\.local|fixture-editor/i);
    while (await new LifeProjectionWorker({ eventRepository, projectionRepository }).tick()) {}
    const recoveredAfterAction = await new ContextRecoveryService({ repository: projectionRepository }).recover({ userId, projectId: project.id });
    assert.equal(recoveredAfterAction.commitments.length, 0);
    assert.equal(recoveredAfterAction.continuation.summary, 'Сценарий успешно завершён');
    assert.equal(recoveredAfterAction.verifiedFacts.some((fact) => fact.type === 'workflow.completed'), true);
    const workflowEvents = (await new TimelineService({ repository: projectionRepository }).list({ userId, projectId: project.id, limit: 100 }))
      .items.filter((item) => item.event_type === 'workflow.completed');
    assert.equal(workflowEvents.length, 1);

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
      proposal: completed.status, workflow: workflowEvents.length, dispatches: desktopDispatches,
      commitmentStatus: completedCommitment.status, person: Boolean(person.id), grant: Boolean(grant.id), mode: mode.mode,
      preference: preference.value, reminder: Boolean(reminder.id), recovery: recovery.status,
      source: source.adapter_type, ownerIsolation: true }));
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
    if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
