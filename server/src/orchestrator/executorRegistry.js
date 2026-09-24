class ExecutorRegistry {
  constructor() {
    this.executors = new Map();
  }

  register(type, executor) {
    const normalized = String(type || '').trim();
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(normalized)) throw new Error('executor type is invalid');
    if (!executor || typeof executor.execute !== 'function') throw new Error('executor must implement execute');
    if (this.executors.has(normalized)) throw new Error(`executor already registered: ${normalized}`);
    this.executors.set(normalized, executor);
    return this;
  }

  get(type) {
    return this.executors.get(String(type || '')) || null;
  }

  require(type) {
    const executor = this.get(type);
    if (!executor) throw new Error(`executor is unavailable: ${type}`);
    return executor;
  }

  listTypes() {
    return [...this.executors.keys()];
  }
}

class DesktopCommandExecutor {
  constructor(options = {}) {
    this.commandService = options.commandService;
  }

  async execute(input) {
    if (!this.commandService) throw new Error('command service is unavailable');
    return this.commandService.create({
      userId: input.userId,
      conversationId: input.conversationId,
      originChannel: input.originChannel,
      originDeviceId: input.originDeviceId || null,
      deviceId: input.targetId,
      action: input.action,
      args: input.args,
      trustedPolicy: input.policy,
      workflowId: input.workflowId || null,
      actionRunId: input.actionRunId || null,
    });
  }
}

class ServerActionExecutor {
  constructor(options = {}) {
    this.reminderService = options.reminderService;
    this.commitmentRepository = options.commitmentRepository;
    this.projectionRepository = options.projectionRepository;
    this.deviceRepository = options.deviceRepository;
    this.workflowRepository = options.workflowRepository || null;
    this.continueWorkflow = options.continueWorkflow || null;
  }

  async execute(input) {
    const args = input.args;
    let result;
    if (input.action === 'reminder.create') result = await this.reminderService.create({
      userId: input.userId,
      origin: { channel: input.originChannel, conversationId: input.conversationId, deviceId: input.originDeviceId },
      input: args,
    });
    else if (input.action === 'reminder.reschedule') result = await this.reminderService.reschedule({
      userId: input.userId, reminderId: args.reminderId, revision: args.revision,
      triggerAt: args.triggerAt, timezone: args.timezone, recurrence: args.recurrence,
      sourceDeviceId: input.originDeviceId,
    });
    else if (input.action === 'life.commitment.reschedule') result = await this.commitmentRepository.transition({
      userId: input.userId, commitmentId: args.commitmentId, revision: args.revision,
      status: 'open', dueAt: args.dueAt, dueWindowEndAt: args.dueWindowEndAt || args.dueAt,
    });
    else if (input.action === 'life.task.create') result = await this.commitmentRepository.create({
      userId: input.userId, sourceEventId: args.sourceEventId, kind: 'task', title: args.title,
      projectId: args.projectId || null, personId: args.personId || null,
      dueAt: args.dueAt || null, dueWindowEndAt: args.dueWindowEndAt || args.dueAt || null,
      confidence: 1,
    });
    else if (input.action === 'project.show_documents') {
      result = await this.projectionRepository.listProjectDocuments({ userId: input.userId, projectId: args.projectId, limit: 20 });
      return { status: 'succeeded', result: { ok: true, documents: result.map((item) => ({ id: item.id, name: item.original_name, category: item.category })) }, answer: result.length ? `Найдено связанных документов: ${result.length}.` : 'Связанных документов пока нет.' };
    } else if (input.action === 'device.status.request') {
      const devices = await this.deviceRepository.listForUser(input.userId);
      result = devices.find((item) => item.id === args.deviceId) || null;
      if (result) return { status: 'succeeded', result: { ok: true, device: { id: result.id, name: result.name, status: result.status } }, answer: `Устройство «${result.name}»: ${result.status}.` };
    } else if (input.action === 'workflow.continue' && this.continueWorkflow) {
      return this.continueWorkflow({ userId: input.userId, workflowId: args.workflowId, originChannel: input.originChannel, originDeviceId: input.originDeviceId });
    } else if (input.action === 'workflow.continue' && this.workflowRepository) {
      const workflow = await this.workflowRepository.getForUser({ userId: input.userId, workflowId: args.workflowId });
      if (!workflow) throw Object.assign(new Error('workflow unavailable'), { publicCode: 'LIFE_SCOPE_NOT_FOUND' });
      if (workflow.status === 'outcome_unknown') return { status: 'outcome_unknown', result: { ok: false, workflowId: workflow.id }, answer: 'Результат прежнего действия неизвестен. Jarvis не запускает его повторно без сверки состояния.' };
      return { status: 'succeeded', result: { ok: true, workflowId: workflow.id, previousStatus: workflow.status }, answer: 'Состояние сценария проверено. Для повторного действия будет создан новый явный план.' };
    } else throw Object.assign(new Error('server action unavailable'), { publicCode: 'SERVER_ACTION_UNAVAILABLE' });
    if (!result) throw Object.assign(new Error('resource unavailable'), { publicCode: 'LIFE_SCOPE_NOT_FOUND' });
    return { status: 'succeeded', result: { ok: true, resourceId: result.id }, answer: 'Life OS обновлён.' };
  }
}

module.exports = { DesktopCommandExecutor, ExecutorRegistry, ServerActionExecutor };
