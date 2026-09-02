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

module.exports = { DesktopCommandExecutor, ExecutorRegistry };
