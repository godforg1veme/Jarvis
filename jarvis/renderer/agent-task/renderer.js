const state = {
  taskId: '',
  phase: 'created',
  events: [],
  plan: [],
  pendingConfirmation: null,
};

const taskIdEl = document.getElementById('task-id');
const taskCommandEl = document.getElementById('task-command');
const taskStatusEl = document.getElementById('task-status');
const currentTitleEl = document.getElementById('current-title');
const currentBodyEl = document.getElementById('current-body');
const choicesEl = document.getElementById('choices');
const eventListEl = document.getElementById('event-list');
const planListEl = document.getElementById('plan-list');
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
    const div = document.createElement('div');
    const classes = ['plan-step'];
    if (step.policy === 'requires_strong_confirmation') classes.push('strong');
    if (step.enabled === false) classes.push('disabled');
    div.className = classes.join(' ');
    div.title = JSON.stringify(step.args || {}, null, 2);
    div.textContent = `${index + 1}. ${step.title || step.action || step.id}`;
    planListEl.appendChild(div);
  });
  renderBadges(plan);
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
    div.innerHTML = `<span class="event-kind ${kind}">${kind}</span><span></span>`;
    div.lastChild.textContent = event.message || event.title || event.phase || JSON.stringify(event.payload || event);
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
  continueBtn.textContent = pendingConfirmation
    ? pendingConfirmation.requiresStrongConfirmation ? 'Сильно подтвердить' : 'Подтвердить'
    : 'Продолжить';
  rejectBtn.hidden = !pendingConfirmation;
}

function describeToolRequest(request = {}) {
  const args = request.args || {};
  const parts = [request.action].filter(Boolean);
  for (const key of ['path', 'from', 'to', 'destination', 'appId', 'hwnd']) {
    if (args[key]) parts.push(`${key}: ${shortPath(args[key])}`);
  }
  return parts.join('\n') || 'Jarvis просит разрешение на действие.';
}

function applyState(nextState = {}) {
  if (nextState.task_id) {
    state.taskId = nextState.task_id;
    taskIdEl.textContent = nextState.task_id;
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
}

function applyEvent(event) {
  if (!event || typeof event !== 'object') return;
  if (event.task_id) {
    state.taskId = event.task_id;
    taskIdEl.textContent = event.task_id;
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

  if (event.type === 'final_report') {
    const runtimeState = event.payload && event.payload.state;
    applyState(runtimeState || {});
    currentTitleEl.textContent = 'Отчет готов';
    currentBodyEl.textContent = event.payload && event.payload.message ? event.payload.message : 'Задача завершена.';
    setConfirmationControls(null);
  }

  if (event.type === 'error') {
    currentTitleEl.textContent = 'Ошибка агента';
    currentBodyEl.textContent = event.payload && event.payload.error ? event.payload.error : 'Неизвестная ошибка.';
    setPhase('failed');
  }

  state.events.push({
    type: event.type,
    kind: event.type === 'needs_input' || event.type === 'needs_confirmation' ? 'wait' : event.type,
    message: event.payload && (event.payload.message || event.payload.error || event.payload.phase),
    payload: event.payload,
  });
  footerStatusEl.textContent = state.events[state.events.length - 1].message || event.type;
  renderEvents();
}

document.getElementById('cancel-btn').addEventListener('click', () => sendAction('cancel', { taskId: state.taskId }));
document.getElementById('stop-btn').addEventListener('click', () => sendAction('stop_after_current_step', { taskId: state.taskId }));
continueBtn.addEventListener('click', () => {
  if (state.pendingConfirmation) {
    sendAction(state.pendingConfirmation.requiresStrongConfirmation ? 'strong_confirm' : 'confirm', { taskId: state.taskId });
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
