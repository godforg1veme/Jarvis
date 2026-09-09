const crypto = require('node:crypto');

const WORKFLOW_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STEPS = 4;
// Keep request/response clients responsive. Real device results continue through
// the result broker and are delivered asynchronously to the originating client.
const FAST_RESULT_WAIT_MS = 1;
const POSITIVE_CONFIRMATION = /^(?:да|ок|okay|подтверждаю|подтвердить|выполняй|делай|yes)[.!\s]*$/iu;
const NEGATIVE_CONFIRMATION = /^(?:нет|не надо|отмена|отмени|отклонить|cancel|no)[.!\s]*$/iu;
const TERMINAL_AFTER_SUCCESS = new Set(['file.open', 'file.open_folder', 'file.reveal', 'app.launch']);
const OPEN_INTENT = /(?:^|\s)(?:открой|открыть|запусти|запустить|open|launch)(?:\s|$)/iu;
const REVEAL_INTENT = /(?:покажи|показать|проводник|где\s+(?:лежит|находится)|расположен|reveal|show\s+in\s+(?:explorer|folder))/iu;
const DEVICE_ACTION_INTENT = /(?:(?:^|\s)(?:найди|найти|поищи|поиск|открой|открыть|покажи|показать|посмотри|взгляни|запусти|запустить|закрой|закрыть|удали|удалить|удаляй|перемести|перенеси|переместить|переименуй|переименовать|создай|создать|скопируй|копировать|сфокусируй|разверни|восстанови|расположи|выполни|сделай|команда|find|search|open|reveal|show|look|launch|close|delete|remove|move|rename|create|copy|focus|restore|resize|layout|execute)(?:\s|$)|что\s+(?:ты\s+)?видишь|что\s+(?:сейчас\s+)?на\s+(?:камере|экране|мониторе)|(?:какие|перечисли|покажи)\s+окна(?:\s|[?.!,]|$)|что\s+(?:сейчас\s+)?открыто\s+(?:на|в)\s+(?:пк|компьютере)(?:\s|[?.!,]|$)|что\s+(?:лежит|находится)\s+в\s+папке(?:\s|[?.!,]|$)|[a-z]:[\\/])/iu;

function hasPotentialDeviceAction(text) {
  return DEVICE_ACTION_INTENT.test(String(text || '').trim());
}

function publicErrorText(error) {
  const code = error && error.publicCode;
  if (code === 'ACTION_UNSUPPORTED_BY_DEVICE') return 'Это действие недоступно на выбранном компьютере.';
  if (code === 'DEVICE_NOT_FOUND') return 'Выбранный компьютер не найден.';
  if (code === 'DEVICE_REVOKED') return 'Выбранный компьютер отозван.';
  if (code === 'CONFIRMATION_UNAVAILABLE') return 'Подтверждение не найдено, уже использовано или истекло.';
  if (code === 'VISION_LOCAL_LEASE_REQUIRED') return 'Сначала включите зрение на самом компьютере; удалённо запускать камеру нельзя.';
  return 'Не удалось выполнить действие на компьютере.';
}

function candidateLabel(candidate, index) {
  const name = String(candidate?.name || candidate?.label || `Вариант ${index + 1}`).slice(0, 255);
  const type = candidate?.type === 'directory' ? 'папка' : candidate?.type === 'file' ? 'файл' : 'объект';
  const location = candidate?.locationHint ? ` — ${String(candidate.locationHint).slice(0, 160)}` : '';
  return `${index + 1}. ${name} (${type})${location}`;
}

function sanitizeToolResult(result) {
  const visit = (value, depth = 0) => {
    if (depth > 6) return '[truncated]';
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => visit(item, depth + 1));
    if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 1000) : value;
    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      if (['path', 'from', 'to', 'destination', 'directory', 'command', 'token', 'secret'].includes(key)) continue;
      output[key] = visit(nested, depth + 1);
    }
    return output;
  };
  const safe = visit(result || {});
  const encoded = JSON.stringify(safe);
  return encoded.length <= 24000 ? safe : { ok: safe.ok === true, action: safe.action || '', error: 'Tool result was too large.' };
}

function terminalText(command) {
  const result = command && command.result || {};
  if (command?.status === 'succeeded' && result.ok === true) return 'Действие выполнено на компьютере.';
  return publicErrorText({ publicCode: command?.error_code });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function actionCallFingerprint(action, args) {
  return crypto.createHash('sha256')
    .update(`${String(action || '')}\0${JSON.stringify(stableValue(args || {}))}`)
    .digest('hex');
}

function policyForPlan(workflow, action, plan) {
  const defaultPolicy = action.policyForArgs(plan.args);
  if (action.name !== 'file.open' || !plan.args?.candidateId) return defaultPolicy;
  const candidate = (workflow.state?.toolResults || [])
    .flatMap((item) => Array.isArray(item?.result?.results) ? item.result.results : [])
    .find((item) => item?.candidateId === plan.args.candidateId);
  return candidate?.dangerous === false ? 'low_risk' : defaultPolicy;
}

function repeatedSuccessText(toolResult) {
  const action = String(toolResult?.action || '');
  const result = toolResult?.result || {};
  const name = String(result?.target?.name || '').trim().slice(0, 255);
  if (action === 'file.open_folder') return name ? `Папка «${name}» открыта.` : 'Папка открыта.';
  if (action === 'file.open') return name ? `Файл «${name}» открыт.` : 'Файл открыт.';
  if (action === 'file.reveal') return name ? `Объект «${name}» показан в Проводнике.` : 'Объект показан в Проводнике.';
  if (action === 'app.launch') return name ? `Приложение «${name}» запущено.` : 'Приложение запущено.';
  return 'Действие выполнено на компьютере.';
}

function fileSearchContinuation(workflow, safeResult) {
  const results = Array.isArray(safeResult?.results) ? safeResult.results : [];
  if (results.length === 0) return { kind: 'answer', text: 'Ничего подходящего на компьютере не найдено.' };
  if (results.length > 1) {
    return {
      kind: 'ask_user',
      question: `Нашёл несколько вариантов:\n${results.map(candidateLabel).join('\n')}\nКакой выбрать?`,
    };
  }
  const candidate = results[0];
  const requestText = `${workflow.state?.originalRequest || ''}\n${workflow.state?.latestUserText || ''}`;
  if (candidate.type === 'directory' && OPEN_INTENT.test(requestText)) {
    return { kind: 'tool_call', action: 'file.open_folder', args: { candidateId: candidate.candidateId } };
  }
  if (candidate.type === 'file' && REVEAL_INTENT.test(requestText)) {
    return { kind: 'tool_call', action: 'file.reveal', args: { candidateId: candidate.candidateId } };
  }
  if (candidate.type === 'file' && OPEN_INTENT.test(requestText)) {
    return { kind: 'tool_call', action: 'file.open', args: { candidateId: candidate.candidateId } };
  }
  return { kind: 'answer', text: `Нашёл: ${candidateLabel(candidate, 0)}` };
}

class ActionOrchestrator {
  constructor(options = {}) {
    this.repository = options.repository;
    this.planner = options.planner;
    this.manifest = options.manifest;
    this.executors = options.executors;
    this.commandService = options.commandService;
    this.deviceRepository = options.deviceRepository;
    this.conversationRepository = options.conversationRepository;
    this.deliverUpdate = options.deliverUpdate || null;
    this.now = options.now || (() => new Date());
    this.fastResultWaitMs = options.fastResultWaitMs || FAST_RESULT_WAIT_MS;
    this.inFlightCommands = new Set();
  }

  async handle(input) {
    if (!this.repository || !this.planner) return { handled: false };
    let workflow = await this.repository.getActiveForConversation({
      userId: input.userId,
      conversationId: input.conversationId,
      originChannel: input.originChannel,
      originDeviceId: input.originDeviceId || null,
    });

    if (workflow?.status === 'awaiting_confirmation') {
      const commandId = workflow.state?.pendingCommandId;
      if (commandId && POSITIVE_CONFIRMATION.test(input.text)) {
        return this.confirm({ ...input, commandId, workflow });
      }
      if (commandId && NEGATIVE_CONFIRMATION.test(input.text)) {
        return this.reject({ ...input, commandId, workflow });
      }
    }
    if (workflow?.status === 'awaiting_result') {
      return { handled: true, answer: 'Предыдущее действие ещё выполняется на компьютере. Я сообщу результат, когда Desktop ответит.', workflowId: workflow.id };
    }

    // Ordinary conversation and private-knowledge questions should not depend
    // on the stricter device planner. Active workflows still reach it for
    // continuations, confirmations, and follow-up selections.
    if (!workflow && !hasPotentialDeviceAction(input.text)) return { handled: false };

    const devices = await this.deviceRepository.listForUser(input.userId);
    const availableActions = this._availableActions(devices, input.originChannel, input.originDeviceId, workflow?.target_id);
    let plan;
    try {
      plan = await this.planner.plan({
        text: input.text,
        history: input.history || [],
        devices,
        availableActions,
        workflowStatus: workflow?.status || null,
        workflowState: workflow?.state || {},
      });
    } catch (error) {
      if (workflow) {
        const failed = await this._update(workflow, 'failed', {
          ...workflow.state,
          failureCode: error?.publicCode || 'TOOL_PLANNER_FAILED',
        }, false, true);
        return { handled: true, answer: 'Не удалось надёжно разобрать действие. Переформулируй запрос одним коротким предложением.', workflowId: failed.id };
      }
      return { handled: true, answer: 'Не удалось надёжно разобрать действие. Переформулируй запрос одним коротким предложением.' };
    }
    if (plan.kind === 'answer') return { handled: false };

    if (!workflow) {
      workflow = await this.repository.create({
        id: crypto.randomUUID(),
        userId: input.userId,
        conversationId: input.conversationId,
        originChannel: input.originChannel,
        originDeviceId: input.originDeviceId || null,
        targetExecutorType: 'device',
        targetId: null,
        expiresAt: new Date(this.now().getTime() + WORKFLOW_TTL_MS),
        state: {
          originalRequest: String(input.text || '').slice(0, 10000),
          latestUserText: String(input.text || '').slice(0, 10000),
          toolResults: [],
          ...(input.originChatId ? { originChatId: String(input.originChatId).slice(0, 128) } : {}),
        },
      });
    }
    if (plan.kind === 'ask_user') {
      workflow = await this._update(workflow, 'awaiting_input', {
        ...workflow.state,
        latestUserText: String(input.text || '').slice(0, 10000),
      });
      return { handled: true, answer: plan.question, workflowId: workflow.id };
    }
    return this._executePlan({ input, workflow, plan, devices, history: input.history || [] });
  }

  async confirm(input) {
    const command = await this.commandService.get({ userId: input.userId, commandId: input.commandId });
    const workflow = input.workflow || (command.workflow_id
      ? await this.repository.getForUser({ userId: input.userId, workflowId: command.workflow_id })
      : null);
    if (!workflow) return { handled: false };
    try {
      const dispatched = await this.commandService.approve({
        userId: input.userId,
        commandId: input.commandId,
        originChannel: input.originChannel,
        originDeviceId: input.originDeviceId || null,
      });
      if (dispatched.status === 'failed') return this._finishFailed(workflow, dispatched.command);
      const waiting = await this._update(workflow, 'awaiting_result', {
        ...workflow.state,
        pendingCommandId: input.commandId,
      });
      return this._waitAndContinue({ input, workflow: waiting, command: dispatched.command, history: input.history || [] });
    } catch (error) {
      return { handled: true, answer: publicErrorText(error), workflowId: workflow.id };
    }
  }

  async reject(input) {
    const command = await this.commandService.get({ userId: input.userId, commandId: input.commandId });
    const workflow = input.workflow || (command.workflow_id
      ? await this.repository.getForUser({ userId: input.userId, workflowId: command.workflow_id })
      : null);
    if (!workflow) return { handled: false };
    try {
      await this.commandService.reject({
        userId: input.userId,
        commandId: input.commandId,
        originChannel: input.originChannel,
        originDeviceId: input.originDeviceId || null,
      });
      if (command.action_run_id) await this.repository.completeRun({ userId: input.userId, runId: command.action_run_id, status: 'cancelled', result: { ok: false, cancelled: true } });
      const completed = await this._update(workflow, 'cancelled', { ...workflow.state, pendingCommandId: null }, false, true);
      return { handled: true, answer: 'Действие отменено.', workflowId: completed.id };
    } catch (error) {
      return { handled: true, answer: publicErrorText(error), workflowId: workflow.id };
    }
  }

  async onCommandTerminal(command) {
    if (!command?.workflow_id || this.inFlightCommands.has(command.id)) return;
    let workflow = await this.repository.getForUser({ userId: command.user_id, workflowId: command.workflow_id });
    if (!workflow || workflow.status !== 'awaiting_result' || workflow.state?.pendingCommandId !== command.id) return;
    let response;
    try {
      response = await this._continueFromTerminal({ workflow, command, input: {
        userId: command.user_id,
        conversationId: workflow.conversation_id,
        originChannel: workflow.origin_channel,
        originDeviceId: workflow.origin_device_id,
        originChatId: workflow.state?.originChatId,
        text: workflow.state?.latestUserText || workflow.state?.originalRequest || '',
        history: [],
      } });
    } catch (error) {
      workflow = await this.repository.getForUser({ userId: command.user_id, workflowId: command.workflow_id });
      if (!workflow || !['active', 'awaiting_input', 'awaiting_confirmation', 'awaiting_result'].includes(workflow.status)) return;
      const failed = await this._update(workflow, 'failed', {
        ...workflow.state,
        pendingCommandId: null,
        failureCode: error?.publicCode || 'WORKFLOW_CONTINUATION_FAILED',
      }, false, true);
      workflow = failed;
      response = {
        handled: true,
        answer: 'Не удалось безопасно завершить план после ответа компьютера. Повтори запрос — уже выполненное действие повторно запущено не будет.',
        workflowId: failed.id,
      };
    }
    if (response?.handled && response.answer && !response.pending && this.deliverUpdate) {
      await this.conversationRepository.appendMessage({
        userId: command.user_id,
        conversationId: workflow.conversation_id,
        role: 'assistant',
        content: response.answer,
      });
      await this.deliverUpdate({ workflow, answer: response.answer, response });
    }
  }

  async _executePlan({ input, workflow, plan, devices, history }) {
    const action = this.manifest.require(plan.action);
    const policy = policyForPlan(workflow, action, plan);
    const fingerprint = actionCallFingerprint(action.name, plan.args);
    if ((workflow.state?.completedCallFingerprints || []).includes(fingerprint)) {
      const completed = await this._update(workflow, 'succeeded', {
        ...workflow.state,
        pendingCommandId: null,
        duplicatePlanPrevented: true,
      }, false, true);
      const matchingResult = [...(workflow.state?.toolResults || [])]
        .reverse()
        .find((item) => item.callFingerprint === fingerprint);
      return {
        handled: true,
        answer: repeatedSuccessText(matchingResult),
        workflowId: completed.id,
      };
    }
    if (workflow.step_count >= MAX_STEPS) {
      const failed = await this._update(workflow, 'failed', { ...workflow.state, failureCode: 'STEP_LIMIT' }, false, true);
      return { handled: true, answer: 'Я остановил задачу: достигнут безопасный лимит шагов.', workflowId: failed.id };
    }
    const target = this._selectDevice({ devices, input, workflow, plan, action });
    if (!target) {
      const online = devices.filter((device) => device.status === 'online' && this._supports(device, action.name));
      const question = online.length > 1
        ? `На каком компьютере выполнить действие: ${online.map((device) => `«${device.name}»`).join(', ')}?`
        : 'Подходящий компьютер сейчас не подключён. Открой Jarvis Desktop и повтори запрос.';
      const waiting = await this._update(workflow, 'awaiting_input', { ...workflow.state, pendingPlan: plan });
      return { handled: true, answer: question, workflowId: waiting.id };
    }

    const run = await this.repository.createRun({
      id: crypto.randomUUID(),
      workflowId: workflow.id,
      userId: input.userId,
      position: workflow.step_count,
      executorType: action.executorType,
      targetId: target.id,
      action: action.name,
      args: plan.args,
      policy,
    });
    let result;
    try {
      result = await this.executors.require(action.executorType).execute({
        userId: input.userId,
        conversationId: input.conversationId,
        originChannel: input.originChannel,
        originDeviceId: input.originDeviceId || null,
        targetId: target.id,
        action: action.name,
        args: plan.args,
        policy,
        workflowId: workflow.id,
        actionRunId: run.id,
      });
    } catch (error) {
      await this.repository.completeRun({ userId: input.userId, runId: run.id, status: 'failed', result: { ok: false, error: error.publicCode || 'COMMAND_CREATE_FAILED' } });
      const failed = await this._update(workflow, 'failed', { ...workflow.state, failureCode: error.publicCode || 'COMMAND_CREATE_FAILED' }, true, true, target.id);
      return { handled: true, answer: publicErrorText(error), workflowId: failed.id };
    }
    const runStatus = result.status === 'awaiting_confirmation' ? 'awaiting_confirmation' : result.status === 'running' ? 'running' : 'failed';
    await this.repository.linkCommand({ userId: input.userId, runId: run.id, commandId: result.command.id, status: runStatus });
    if (result.status === 'awaiting_confirmation') {
      const waiting = await this._update(workflow, 'awaiting_confirmation', {
        ...workflow.state,
        latestUserText: String(input.text || '').slice(0, 10000),
        pendingCommandId: result.command.id,
      }, true, false, target.id);
      return {
        handled: true,
        answer: `${result.prompt}\nПодтверди: /confirm ${result.command.id}\nОтмена: /reject ${result.command.id}`,
        workflowId: waiting.id,
        confirmation: { commandId: result.command.id, policy: result.command.policy },
      };
    }
    if (result.status === 'failed') return this._finishFailed(workflow, result.command, run.id, true, target.id);
    const waiting = await this._update(workflow, 'awaiting_result', {
      ...workflow.state,
      latestUserText: String(input.text || '').slice(0, 10000),
      pendingCommandId: result.command.id,
    }, true, false, target.id);
    return this._waitAndContinue({ input, workflow: waiting, command: result.command, history });
  }

  async _waitAndContinue({ input, workflow, command, history }) {
    this.inFlightCommands.add(command.id);
    try {
      const terminal = await this.commandService.waitForTerminal({ userId: input.userId, commandId: command.id, timeoutMs: this.fastResultWaitMs });
      if (!terminal) return { handled: true, pending: true, answer: 'Выполняю действие на компьютере. Сообщу результат, когда Desktop ответит.', workflowId: workflow.id };
      return this._continueFromTerminal({ input: { ...input, history }, workflow, command: terminal });
    } finally {
      this.inFlightCommands.delete(command.id);
    }
  }

  async _continueFromTerminal({ input, workflow, command }) {
    const safeResult = sanitizeToolResult(command.result || { ok: command.status === 'succeeded' });
    if (command.action_run_id) {
      await this.repository.completeRun({
        userId: input.userId,
        runId: command.action_run_id,
        status: command.status === 'succeeded' ? 'succeeded' : 'failed',
        result: safeResult,
      });
    }
    if (command.status !== 'succeeded' || safeResult.ok !== true) return this._finishFailed(workflow, command);
    const callFingerprint = actionCallFingerprint(command.action, command.arguments || {});
    const toolResults = [...(workflow.state?.toolResults || []), {
      action: command.action,
      callFingerprint,
      result: safeResult,
    }].slice(-MAX_STEPS);
    const completedCallFingerprints = [...new Set([
      ...(workflow.state?.completedCallFingerprints || []),
      callFingerprint,
    ])].slice(-MAX_STEPS);
    let active = await this._update(workflow, 'active', {
      ...workflow.state,
      pendingCommandId: null,
      toolResults,
      completedCallFingerprints,
    });
    const latestToolResult = toolResults.at(-1);
    if (TERMINAL_AFTER_SUCCESS.has(command.action)) {
      const completed = await this._update(active, 'succeeded', active.state, false, true);
      return { handled: true, answer: repeatedSuccessText(latestToolResult), workflowId: completed.id };
    }
    if (command.action === 'file.search') {
      const continuation = fileSearchContinuation(active, safeResult);
      if (continuation.kind === 'tool_call') {
        const devices = await this.deviceRepository.listForUser(input.userId);
        return this._executePlan({ input, workflow: active, plan: continuation, devices, history: input.history || [] });
      }
      const status = continuation.kind === 'ask_user' ? 'awaiting_input' : 'succeeded';
      const completed = await this._update(active, status, active.state, false, status === 'succeeded');
      return {
        handled: true,
        answer: continuation.kind === 'ask_user' ? continuation.question : continuation.text,
        workflowId: completed.id,
      };
    }
    if (command.action === 'vision.capture') {
      const answer = String(safeResult.answer || '').trim().slice(0, 10000);
      const completed = await this._update(active, 'succeeded', active.state, false, true);
      return { handled: true, answer: answer || 'Визуальный анализ завершён.', workflowId: completed.id };
    }
    const devices = await this.deviceRepository.listForUser(input.userId);
    const plan = await this.planner.plan({
      text: input.text,
      history: input.history || [],
      devices,
      availableActions: this._availableActions(devices, input.originChannel, input.originDeviceId, active.target_id),
      workflowStatus: active.status,
      workflowState: active.state,
    });
    if (plan.kind === 'tool_call') return this._executePlan({ input, workflow: active, plan, devices, history: input.history || [] });
    if (plan.kind === 'ask_user') {
      active = await this._update(active, 'awaiting_input', active.state);
      return { handled: true, answer: plan.question, workflowId: active.id };
    }
    const completed = await this._update(active, 'succeeded', active.state, false, true);
    return { handled: true, answer: String(plan.text || '').trim() || terminalText(command), workflowId: completed.id };
  }

  async _finishFailed(workflow, command, runId = null, incrementStep = false, targetId = undefined) {
    if (runId) await this.repository.completeRun({ userId: workflow.user_id, runId, status: 'failed', result: sanitizeToolResult(command?.result || {}) });
    const failed = await this._update(workflow, 'failed', {
      ...workflow.state,
      pendingCommandId: null,
      failureCode: command?.error_code || 'TOOL_EXECUTION_FAILED',
    }, incrementStep, true, targetId);
    return { handled: true, answer: terminalText(command), workflowId: failed.id };
  }

  async _update(workflow, status, state, incrementStep = false, completed = false, targetId = undefined) {
    const updated = await this.repository.update({
      userId: workflow.user_id,
      workflowId: workflow.id,
      expectedRevision: workflow.revision,
      status,
      state,
      incrementStep,
      completed,
      targetId,
    });
    if (!updated) {
      const current = await this.repository.getForUser({ userId: workflow.user_id, workflowId: workflow.id });
      if (current) return current;
      throw new Error('workflow update conflict');
    }
    return updated;
  }

  _supports(device, action) {
    return Array.isArray(device.capabilities?.actions) && device.capabilities.actions.includes(action);
  }

  _availableActions(devices, originChannel, originDeviceId, targetId) {
    const candidates = devices.filter((device) => (!targetId || device.id === targetId) &&
      (originChannel !== 'desktop' || device.id === originDeviceId));
    const declared = [...new Set(candidates.flatMap((device) => Array.isArray(device.capabilities?.actions) ? device.capabilities.actions : []))]
      .filter((name) => this.manifest.get(name));
    return declared.length ? declared : this.manifest.list().map((action) => action.name);
  }

  _selectDevice({ devices, input, workflow, plan, action }) {
    const eligible = devices.filter((device) => device.status === 'online' && this._supports(device, action.name));
    const requested = plan.targetDeviceId || workflow.target_id || (input.originChannel === 'desktop' ? input.originDeviceId : null);
    if (requested) return eligible.find((device) => device.id === requested) || null;
    return eligible.length === 1 ? eligible[0] : null;
  }
}

module.exports = {
  ActionOrchestrator,
  FAST_RESULT_WAIT_MS,
  MAX_STEPS,
  WORKFLOW_TTL_MS,
  actionCallFingerprint,
  fileSearchContinuation,
  hasPotentialDeviceAction,
  sanitizeToolResult,
};
