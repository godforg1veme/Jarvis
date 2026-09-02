const assert = require('node:assert/strict');
const test = require('node:test');
const { ActionOrchestrator } = require('../src/orchestrator/actionOrchestrator');
const { createActionManifest } = require('../src/orchestrator/actionManifest');
const { ExecutorRegistry } = require('../src/orchestrator/executorRegistry');

const userId = '11111111-1111-4111-8111-111111111111';
const deviceId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';

class MemoryWorkflowRepository {
  constructor() { this.workflows = new Map(); this.runs = new Map(); }
  async create(input) {
    const row = {
      id: input.id, user_id: input.userId, conversation_id: input.conversationId,
      origin_channel: input.originChannel, origin_device_id: input.originDeviceId,
      target_id: input.targetId, target_executor_type: input.targetExecutorType,
      status: 'active', state: input.state, step_count: 0, revision: 0,
    };
    this.workflows.set(row.id, row); return { ...row };
  }
  async getActiveForConversation({ userId: owner, conversationId: conversation, originChannel, originDeviceId }) {
    return [...this.workflows.values()].find((row) => row.user_id === owner && row.conversation_id === conversation &&
      row.origin_channel === originChannel && (!originDeviceId || row.origin_device_id === originDeviceId) &&
      ['active', 'awaiting_input', 'awaiting_confirmation', 'awaiting_result'].includes(row.status)) || null;
  }
  async getForUser({ userId: owner, workflowId }) { const row = this.workflows.get(workflowId); return row?.user_id === owner ? { ...row } : null; }
  async update(input) {
    const row = this.workflows.get(input.workflowId);
    if (!row || row.user_id !== input.userId || row.revision !== input.expectedRevision) return null;
    Object.assign(row, {
      status: input.status, state: input.state,
      target_id: input.targetId === undefined ? row.target_id : input.targetId,
      step_count: row.step_count + (input.incrementStep ? 1 : 0), revision: row.revision + 1,
    });
    return { ...row };
  }
  async createRun(input) {
    const row = { id: input.id, user_id: input.userId, workflow_id: input.workflowId, position: input.position, action: input.action, status: input.status || 'planned' };
    this.runs.set(row.id, row); return { ...row };
  }
  async linkCommand({ userId: owner, runId, commandId, status }) { const row = this.runs.get(runId); assert.equal(row.user_id, owner); Object.assign(row, { command_id: commandId, status }); return { ...row }; }
  async completeRun({ userId: owner, runId, status, result }) { const row = this.runs.get(runId); assert.equal(row.user_id, owner); Object.assign(row, { status, result }); return { ...row }; }
}

function createHarness(plans, options = {}) {
  const repository = new MemoryWorkflowRepository();
  const commands = new Map();
  const executions = [];
  const delivered = [];
  let commandNumber = 0;
  const commandService = {
    async get({ userId: owner, commandId }) { const command = commands.get(commandId); if (!command || command.user_id !== owner) throw new Error('not found'); return command; },
    async approve({ userId: owner, commandId, originChannel, originDeviceId }) {
      const command = commands.get(commandId); assert.equal(command.user_id, owner); assert.equal(command.origin_channel, originChannel); assert.equal(command.origin_device_id, originDeviceId);
      command.status = 'running'; return { status: 'running', command };
    },
    async reject({ commandId }) { const command = commands.get(commandId); command.status = 'cancelled'; return { status: 'cancelled', command }; },
    async waitForTerminal({ commandId }) {
      if (options.waitPending) return null;
      const command = commands.get(commandId);
      const terminal = options.terminals?.[command.action];
      if (!terminal) return null;
      Object.assign(command, terminal, { action_run_id: command.action_run_id });
      return command;
    },
  };
  const executor = {
    async execute(input) {
      executions.push(input);
      commandNumber += 1;
      const id = `command-${commandNumber}`;
      const changing = input.policy === 'requires_confirmation' || input.policy === 'requires_strong_confirmation';
      const command = {
        id, user_id: input.userId, workflow_id: input.workflowId, action_run_id: input.actionRunId,
        action: input.action, arguments: input.args, status: changing ? 'awaiting_confirmation' : 'running',
        policy: input.policy, origin_channel: input.originChannel,
        origin_device_id: input.originDeviceId, result: null,
      };
      commands.set(id, command);
      return changing
        ? { status: 'awaiting_confirmation', command, prompt: 'Подтвердить удаление?' }
        : { status: 'running', command };
    },
  };
  const orchestrator = new ActionOrchestrator({
    repository,
    planner: { async plan() { const next = plans.shift(); if (!next) throw new Error('missing plan'); return next; } },
    manifest: createActionManifest(),
    executors: new ExecutorRegistry().register('device', executor),
    commandService,
    deviceRepository: { async listForUser(owner) { assert.equal(owner, userId); return options.devices || [{ id: deviceId, name: 'Основной ПК', status: 'online', capabilities: { actions: ['file.search', 'file.open_folder', 'file.delete'] } }]; } },
    conversationRepository: { async appendMessage() {} },
    deliverUpdate: async (input) => delivered.push(input),
    fastResultWaitMs: 1,
  });
  return { orchestrator, repository, executions, commands, delivered };
}

test('natural folder task searches, consumes an opaque candidate, opens it, and reports only verified success', async () => {
  const candidateId = 'candidate-file-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const { orchestrator, executions } = createHarness([
    { kind: 'tool_call', action: 'file.search', args: { query: 'Tabletop Simulator', location: 'F:\\', targetType: 'directory' } },
    { kind: 'tool_call', action: 'file.open_folder', args: { candidateId } },
  ], { terminals: {
    'file.search': { status: 'succeeded', result: { ok: true, action: 'file.search', results: [{ candidateId, name: 'Tabletop Simulator', type: 'directory', locationHint: 'F: · Steam' }] } },
    'file.open_folder': { status: 'succeeded', result: { ok: true, action: 'file.open_folder', target: { name: 'Tabletop Simulator', type: 'directory' } } },
  } });
  const result = await orchestrator.handle({ userId, conversationId, originChannel: 'desktop', originDeviceId: deviceId, text: 'Найди и открой папку tabletop симулятора на диске ф', history: [] });
  assert.equal(result.answer, 'Папка «Tabletop Simulator» открыта.');
  assert.deepEqual(executions.map((entry) => entry.action), ['file.search', 'file.open_folder']);
  assert.equal(executions[1].args.candidateId, candidateId);
  assert.equal(JSON.stringify(result).includes('Steam\\steamapps'), false);
});

test('a repeated successful candidate action is completed without executing the one-time candidate twice', async () => {
  const candidateId = 'candidate-file-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const { orchestrator, executions, repository } = createHarness([
    { kind: 'tool_call', action: 'file.search', args: { query: 'Projects 2026', location: 'D:\\', targetType: 'directory' } },
    { kind: 'tool_call', action: 'file.open_folder', args: { candidateId } },
    { kind: 'tool_call', action: 'file.open_folder', args: { candidateId } },
  ], { terminals: {
    'file.search': { status: 'succeeded', result: { ok: true, action: 'file.search', results: [{ candidateId, name: 'Projects 2026', type: 'directory' }] } },
    'file.open_folder': { status: 'succeeded', result: { ok: true, action: 'file.open_folder', target: { name: 'Projects 2026', type: 'directory' } } },
  } });

  const result = await orchestrator.handle({ userId, conversationId, originChannel: 'desktop', originDeviceId: deviceId, text: 'Найди и открой Projects 2026 на диске D', history: [] });

  assert.equal(result.answer, 'Папка «Projects 2026» открыта.');
  assert.deepEqual(executions.map((entry) => entry.action), ['file.search', 'file.open_folder']);
  assert.equal([...repository.workflows.values()][0].status, 'succeeded');
});

test('verified safe file candidates open without confirmation while dangerous candidates require it', async () => {
  const devices = [{ id: deviceId, name: 'Основной ПК', status: 'online', capabilities: { actions: ['file.search', 'file.open'] } }];
  const safeId = 'candidate-file-cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const safeHarness = createHarness([
    { kind: 'tool_call', action: 'file.search', args: { query: 'notes.txt', targetType: 'file' } },
  ], { devices, terminals: {
    'file.search': { status: 'succeeded', result: { ok: true, action: 'file.search', results: [{ candidateId: safeId, name: 'notes.txt', type: 'file', dangerous: false }] } },
    'file.open': { status: 'succeeded', result: { ok: true, action: 'file.open', target: { name: 'notes.txt', type: 'file' } } },
  } });
  const safe = await safeHarness.orchestrator.handle({ userId, conversationId, originChannel: 'desktop', originDeviceId: deviceId, text: 'Найди и открой файл notes.txt', history: [] });
  assert.equal(safe.answer, 'Файл «notes.txt» открыт.');
  assert.equal(safeHarness.executions[1].policy, 'low_risk');

  const dangerousId = 'candidate-file-dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const dangerousHarness = createHarness([
    { kind: 'tool_call', action: 'file.search', args: { query: 'run.bat', targetType: 'file' } },
  ], { devices, terminals: {
    'file.search': { status: 'succeeded', result: { ok: true, action: 'file.search', results: [{ candidateId: dangerousId, name: 'run.bat', type: 'file', dangerous: true }] } },
  } });
  const dangerous = await dangerousHarness.orchestrator.handle({ userId, conversationId, originChannel: 'desktop', originDeviceId: deviceId, text: 'Найди и открой файл run.bat', history: [] });
  assert.match(dangerous.answer, /Подтвердить/);
  assert.equal(dangerousHarness.executions[1].policy, 'requires_confirmation');
});

test('a background continuation failure closes the workflow and notifies its origin', async () => {
  const { orchestrator, commands, repository, delivered } = createHarness([
    { kind: 'tool_call', action: 'window.list', args: {} },
  ], { waitPending: true, devices: [{ id: deviceId, name: 'Основной ПК', status: 'online', capabilities: { actions: ['window.list'] } }] });
  const pending = await orchestrator.handle({ userId, conversationId, originChannel: 'desktop', originDeviceId: deviceId, text: 'Какие окна открыты?', history: [] });
  assert.equal(pending.pending, true);
  const command = [...commands.values()][0];
  Object.assign(command, { status: 'succeeded', result: { ok: true, action: 'window.list', windows: [] } });

  await orchestrator.onCommandTerminal(command);

  assert.equal([...repository.workflows.values()][0].status, 'failed');
  assert.equal(delivered.length, 1);
  assert.match(delivered[0].answer, /Не удалось безопасно завершить план/);
});

test('a failed Desktop tool never exposes its raw system error to the user', async () => {
  const rawError = 'EnumWindows failed at C:\\Users\\owner\\private.ps1:42';
  const { orchestrator } = createHarness([
    { kind: 'tool_call', action: 'window.list', args: {} },
  ], {
    devices: [{ id: deviceId, name: 'Основной ПК', status: 'online', capabilities: { actions: ['window.list'] } }],
    terminals: { 'window.list': { status: 'failed', error_code: 'TOOL_EXECUTION_FAILED', result: { ok: false, error: rawError } } },
  });

  const result = await orchestrator.handle({ userId, conversationId, originChannel: 'desktop', originDeviceId: deviceId, text: 'Какие окна открыты?', history: [] });

  assert.equal(result.answer, 'Не удалось выполнить действие на компьютере.');
  assert.equal(result.answer.includes('EnumWindows'), false);
  assert.equal(result.answer.includes('private.ps1'), false);
});

test('an initial planner failure returns a retryable answer instead of failing the Desktop request', async () => {
  const { orchestrator, executions } = createHarness([]);
  const result = await orchestrator.handle({ userId, conversationId, originChannel: 'desktop', originDeviceId: deviceId, text: 'Сложная команда', history: [] });
  assert.match(result.answer, /Переформулируй запрос/);
  assert.equal(executions.length, 0);
});

test('a semantic knowledge question bypasses the device planner', async () => {
  const { orchestrator, executions, repository } = createHarness([]);
  const result = await orchestrator.handle({
    userId,
    conversationId,
    originChannel: 'telegram',
    originChatId: '123',
    text: 'Какой оттенок у запасного светового сигнала и какая комбинация открывает доступ?',
    history: [],
  });

  assert.deepEqual(result, { handled: false });
  assert.equal(executions.length, 0);
  assert.equal(repository.workflows.size, 0);
});

test('a changing action accepts one natural confirmation only from its Desktop origin', async () => {
  const { orchestrator, repository } = createHarness([
    { kind: 'tool_call', action: 'file.delete', args: { path: 'C:\\Temp\\old.txt' } },
    { kind: 'answer', text: 'Файл удалён в корзину.' },
  ], { terminals: { 'file.delete': { status: 'succeeded', result: { ok: true, action: 'file.delete', recycled: true } } } });
  const first = await orchestrator.handle({ userId, conversationId, originChannel: 'desktop', originDeviceId: deviceId, text: 'Удали старый файл', history: [] });
  assert.match(first.answer, /Подтвердить удаление/);
  const confirmed = await orchestrator.handle({ userId, conversationId, originChannel: 'desktop', originDeviceId: deviceId, text: 'да', history: [] });
  assert.equal(confirmed.answer, 'Файл удалён в корзину.');
  assert.equal([...repository.workflows.values()][0].status, 'succeeded');
});

test('Telegram asks which device when several compatible computers are online', async () => {
  const devices = ['A', 'B'].map((name, index) => ({ id: `${index + 4}4444444-4444-4444-8444-444444444444`, name, status: 'online', capabilities: { actions: ['file.search'] } }));
  const { orchestrator, executions } = createHarness([
    { kind: 'tool_call', action: 'file.search', args: { query: 'отчёт' } },
  ], { devices });
  const result = await orchestrator.handle({ userId, conversationId, originChannel: 'telegram', originChatId: '123', text: 'Найди отчёт на компьютере', history: [] });
  assert.match(result.answer, /На каком компьютере/);
  assert.equal(executions.length, 0);
});

test('seeded varied folder names and drives follow the same generic search-to-open path', async () => {
  let seed = 0x5eed1234;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const names = ['Проекты 2026', 'Baldurs Gate Mods', 'семейные фото', 'invoice archive', 'Музыка FLAC', 'obs recordings'];
  const drives = ['C', 'D', 'F', 'G'];
  for (let index = 0; index < 24; index += 1) {
    const name = `${names[Math.floor(random() * names.length)]} ${index}`;
    const drive = drives[Math.floor(random() * drives.length)];
    const candidateId = `candidate-file-${String(index).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
    const { orchestrator, executions } = createHarness([
      { kind: 'tool_call', action: 'file.search', args: { query: name, location: `${drive}:\\`, targetType: 'directory' } },
      { kind: 'tool_call', action: 'file.open_folder', args: { candidateId } },
    ], { terminals: {
      'file.search': { status: 'succeeded', result: { ok: true, action: 'file.search', results: [{ candidateId, name, type: 'directory', locationHint: `${drive}:` }] } },
      'file.open_folder': { status: 'succeeded', result: { ok: true, action: 'file.open_folder', target: { name, type: 'directory' } } },
    } });
    const result = await orchestrator.handle({ userId, conversationId, originChannel: 'desktop', originDeviceId: deviceId, text: `найди сам и открой «${name}» на диске ${drive}`, history: [] });
    assert.equal(result.answer, `Папка «${name}» открыта.`);
    assert.deepEqual(executions.map((entry) => entry.action), ['file.search', 'file.open_folder']);
  }
});
