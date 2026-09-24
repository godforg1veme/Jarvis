const state = {
  taskId: '',
  phase: 'created',
  events: [],
  plan: [],
  pendingConfirmation: null,
  strongConfirmArmed: false,
  dependencyErrors: [],
};

const taskIdEl = document.getElementById('task-id');
const taskCommandEl = document.getElementById('task-command');
const taskStatusEl = document.getElementById('task-status');
const currentTitleEl = document.getElementById('current-title');
const currentBodyEl = document.getElementById('current-body');
const choicesEl = document.getElementById('choices');
const eventListEl = document.getElementById('event-list');
const planListEl = document.getElementById('plan-list');
const planValidationEl = document.getElementById('plan-validation');
const footerStatusEl = document.getElementById('footer-status');
const policyBadgesEl = document.getElementById('policy-badges');
const continueBtn = document.getElementById('continue-btn');
const rejectBtn = document.getElementById('reject-btn');

function sendAction(action, payload = {}) {
  if (!window.jarvisAgentTask || typeof window.jarvisAgentTask.sendAction !== 'function') return;
  window.jarvisAgentTask.sendAction(action, payload);
}

function phaseOrder(phase) {
  return ['created', 'observing', 'planning', 'needs_input', 'needs_confirmation', 'executing', 'finalized', 'failed']
    .indexOf(phase);
}

function setPhase(phase) {
  state.phase = phase || state.phase;
  document.querySelectorAll('.phase').forEach((el) => {
    const name = el.getAttribute('data-phase');
    el.classList.toggle('active', name === state.phase);
    el.classList.toggle('done', phaseOrder(name) < phaseOrder(state.phase));
  });
}

function shortPath(value) {
  const text = String(value || '');
  if (text.length <= 70) return text;
  return `${text.slice(0, 28)}...${text.slice(-36)}`;
}

function resetTaskView(taskId) {
  state.taskId = taskId || '';
  state.phase = 'created';
  state.events = [];
  state.plan = [];
  state.pendingConfirmation = null;
  state.strongConfirmArmed = false;
  state.dependencyErrors = [];

  taskIdEl.textContent = state.taskId || '—';
  taskCommandEl.textContent = 'Ожидаю описание задачи';
  taskStatusEl.textContent = 'Задача создана.';
  currentTitleEl.textContent = 'Готов к работе';
  currentBodyEl.textContent = 'Здесь появится вопрос, текущий шаг или подтверждение плана.';
  footerStatusEl.textContent = 'Ожидаю событий агента.';

  setPhase('created');
  renderPlan([]);
  renderPlanValidation([]);
  renderChoices([]);
  setConfirmationControls(null);
  renderEvents();
}

function switchTaskIfNeeded(taskId) {
  if (!taskId) return;
  if (state.taskId && state.taskId !== taskId) {
    resetTaskView(taskId);
    return;
  }
  state.taskId = taskId;
  taskIdEl.textContent = taskId;
}

function renderBadges(plan = []) {
  const policies = new Set(plan.map((step) => step.policy).filter(Boolean));
  policyBadgesEl.innerHTML = '';
  for (const policy of policies) {
    const span = document.createElement('span');
    span.className = `badge${policy.includes('strong') || policy.includes('confirmation') ? ' warning' : ''}`;
    span.textContent = policy;
    policyBadgesEl.appendChild(span);
  }
}

function renderPlan(plan = []) {
  state.plan = plan;
  planListEl.innerHTML = '';
  if (plan.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'plan-step';
    empty.textContent = 'План появится после анализа задачи.';
    planListEl.appendChild(empty);
    renderBadges([]);
    return;
  }

  plan.forEach((step, index) => {
    const div = document.createElement('label');
    const classes = ['plan-step'];
    if (step.policy === 'requires_strong_confirmation') classes.push('strong');
    if (step.enabled === false) classes.push('disabled');
    if (step.status === 'blocked') classes.push('blocked');
    div.className = classes.join(' ');
    div.title = JSON.stringify(step.args || {}, null, 2);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = step.enabled !== false;
    checkbox.setAttribute('aria-label', `Включить шаг ${index + 1}`);
    checkbox.addEventListener('change', () => {
      step.enabled = checkbox.checked;
      const disabledStepIds = state.plan
        .filter((item) => item.enabled === false)
        .map((item) => item.id);
      sendAction('disable_steps', { taskId: state.taskId, disabledStepIds });
    });
    const title = document.createElement('span');
    title.textContent = `${index + 1}. ${step.title || step.action || step.id}`;
    div.appendChild(checkbox);
    div.appendChild(title);
    planListEl.appendChild(div);
  });
  renderBadges(plan);
}

function renderPlanValidation(errors = []) {
  state.dependencyErrors = Array.isArray(errors) ? errors : [];
  planValidationEl.hidden = state.dependencyErrors.length === 0;
  planValidationEl.textContent = state.dependencyErrors
    .map((error) => error.message || JSON.stringify(error))
    .join('\n');
  if (!state.pendingConfirmation) {
    continueBtn.disabled = state.dependencyErrors.length > 0;
  }
}

function renderEvents() {
  eventListEl.innerHTML = '';
  if (state.events.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'event';
    empty.innerHTML = '<span class="event-kind">idle</span><span>Ожидаю событий runtime.</span>';
    eventListEl.appendChild(empty);
    return;
  }

  state.events.slice(-80).forEach((event) => {
    const div = document.createElement('div');
    const kind = event.kind || event.type || 'event';
    div.className = 'event';
    const kindEl = document.createElement('span');
    kindEl.className = `event-kind ${kind}`;
    kindEl.textContent = kind;
    const messageEl = document.createElement('span');
    messageEl.textContent = event.message || event.title || event.phase || event.type || 'событие';
    div.appendChild(kindEl);
    div.appendChild(messageEl);
    eventListEl.appendChild(div);
  });
  eventListEl.scrollTop = eventListEl.scrollHeight;
}

function renderChoices(choices = []) {
  choicesEl.innerHTML = '';
  choices.forEach((choice, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `choice${index === 0 ? ' primary' : ''}`;
    btn.textContent = choice;
    btn.addEventListener('click', () => sendAction('user_choice', { index, choice, taskId: state.taskId }));
    choicesEl.appendChild(btn);
  });
}

function setConfirmationControls(pendingConfirmation) {
  state.pendingConfirmation = pendingConfirmation || null;
  state.strongConfirmArmed = false;
  continueBtn.textContent = pendingConfirmation
    ? pendingConfirmation.requiresStrongConfirmation ? 'Сильно подтвердить' : 'Подтвердить'
    : 'Продолжить';
  rejectBtn.hidden = !pendingConfirmation;
  continueBtn.disabled = state.dependencyErrors.length > 0;
}

function setTaskFinishedControls() {
  state.pendingConfirmation = null;
  state.strongConfirmArmed = false;
  continueBtn.textContent = 'Завершено';
  continueBtn.disabled = true;
  rejectBtn.hidden = true;
}

function describeToolRequest(request = {}) {
  const args = request.args || {};
  const parts = [request.action].filter(Boolean);
  for (const key of ['path', 'from', 'to', 'destination', 'appId', 'hwnd']) {
    if (args[key]) parts.push(`${key}: ${shortPath(args[key])}`);
  }
  return parts.join('\n') || 'Jarvis просит разрешение на действие.';
}

function summarizeEvent(event) {
  const payload = event.payload || {};
  if (payload.message || payload.error || payload.phase) {
    return payload.message || payload.error || payload.phase;
  }
  if (event.type === 'plan_draft') {
    const plan = Array.isArray(payload.plan) ? payload.plan : [];
    return `План подготовлен: ${plan.length} шагов.`;
  }
  if (event.type === 'needs_confirmation') {
    return describeToolRequest(payload.request || {});
  }
  if (event.type === 'needs_input') {
    const runtimePlan = payload.state && Array.isArray(payload.state.plan) ? payload.state.plan : [];
    const askStep = runtimePlan.find((step) => step.action === 'ask_user');
    return (askStep && askStep.args && askStep.args.question) || 'Нужен ответ пользователя.';
  }
  return event.type || 'событие';
}

function applyState(nextState = {}) {
  if (nextState.task_id) {
    switchTaskIfNeeded(nextState.task_id);
  }
  if (nextState.user_command) {
    taskCommandEl.textContent = nextState.user_command;
  }
  if (nextState.phase) {
    setPhase(nextState.phase);
    taskStatusEl.textContent = `Сейчас: ${nextState.phase}`;
  }
  if (Array.isArray(nextState.plan)) {
    renderPlan(nextState.plan);
  }
  if (Array.isArray(nextState.dependency_errors)) {
    renderPlanValidation(nextState.dependency_errors);
  }
}

function applyEvent(event) {
  if (!event || typeof event !== 'object') return;
  if (event.task_id) {
    switchTaskIfNeeded(event.task_id);
  }

  if (event.type === 'phase_changed') {
    const phase = event.payload && event.payload.phase;
    setPhase(phase);
    taskStatusEl.textContent = `Сейчас: ${phase}`;
  }

  if (event.type === 'plan_draft') {
    const plan = event.payload && event.payload.plan;
    const runtimeState = event.payload && event.payload.state;
    applyState(runtimeState || {});
    renderPlan(Array.isArray(plan) ? plan : []);
    currentTitleEl.textContent = 'План подготовлен';
    currentBodyEl.textContent = 'Проверь шаги и дождись следующего действия Jarvis.';
    setConfirmationControls(null);
  }

  if (event.type === 'needs_confirmation') {
    const payload = event.payload || {};
    const result = payload.result || {};
    const request = payload.request || {};
    setPhase('needs_confirmation');
    taskStatusEl.textContent = 'Сейчас: нужно подтверждение';
    currentTitleEl.textContent = result.requiresStrongConfirmation
      ? 'Нужно сильное подтверждение'
      : 'Нужно подтверждение';
    currentBodyEl.textContent = `${payload.message || 'Подтверди действие агента.'}\n${describeToolRequest(request)}`;
    setConfirmationControls({
      requiresStrongConfirmation: !!result.requiresStrongConfirmation,
    });
    renderChoices([]);
  }

  if (event.type === 'needs_input') {
    const runtimeState = event.payload && event.payload.state;
    applyState(runtimeState || {});
    const askStep = (runtimeState && Array.isArray(runtimeState.plan)
      ? runtimeState.plan.find((step) => step.action === 'ask_user')
      : null);
    currentTitleEl.textContent = askStep ? askStep.title : 'Нужно уточнение';
    currentBodyEl.textContent = (askStep && askStep.args && askStep.args.question) || 'Выбери вариант или ответь голосом.';
    renderChoices((askStep && askStep.args && askStep.args.choices) || []);
    setConfirmationControls(null);
  }

  if (event.type === 'plan_validation_error') {
    const payload = event.payload || {};
    const runtimeState = payload.state || {};
    applyState(runtimeState);
    renderPlanValidation(payload.errors || runtimeState.dependency_errors || []);
    currentTitleEl.textContent = 'План нужно исправить';
    currentBodyEl.textContent = payload.message || 'Отключённый шаг используется другими шагами.';
  }

  if (event.type === 'final_report') {
    const runtimeState = event.payload && event.payload.state;
    applyState(runtimeState || {});
    currentTitleEl.textContent = 'Отчет готов';
    currentBodyEl.textContent = event.payload && event.payload.message ? event.payload.message : 'Задача завершена.';
    setTaskFinishedControls();
  }

  if (event.type === 'error') {
    currentTitleEl.textContent = 'Ошибка агента';
    currentBodyEl.textContent = event.payload && event.payload.error ? event.payload.error : 'Неизвестная ошибка.';
    setPhase('failed');
    setTaskFinishedControls();
  }

  const eventMessage = summarizeEvent(event);
  state.events.push({
    type: event.type,
    kind: event.type === 'needs_input' || event.type === 'needs_confirmation' ? 'wait' : event.type,
    message: eventMessage,
  });
  footerStatusEl.textContent = eventMessage;
  renderEvents();
}

document.getElementById('cancel-btn').addEventListener('click', () => sendAction('cancel', { taskId: state.taskId }));
document.getElementById('stop-btn').addEventListener('click', () => sendAction('stop_after_current_step', { taskId: state.taskId }));
continueBtn.addEventListener('click', () => {
  if (state.pendingConfirmation) {
    if (state.pendingConfirmation.requiresStrongConfirmation) {
      if (!state.strongConfirmArmed) {
        state.strongConfirmArmed = true;
        continueBtn.textContent = 'Подтверждаю риск';
        footerStatusEl.textContent = 'Нажми еще раз, чтобы выполнить сильное подтверждение.';
        return;
      }
      sendAction('strong_confirm', { taskId: state.taskId });
      return;
    }
    sendAction('confirm', { taskId: state.taskId });
    return;
  }
  sendAction('continue', { taskId: state.taskId });
});
rejectBtn.addEventListener('click', () => sendAction('reject_confirmation', { taskId: state.taskId }));
document.getElementById('hide-btn').addEventListener('click', () => sendAction('hide', { taskId: state.taskId }));

renderEvents();
renderPlan();
setConfirmationControls(null);

if (window.jarvisAgentTask && typeof window.jarvisAgentTask.onEvent === 'function') {
  window.jarvisAgentTask.onEvent(applyEvent);
}
