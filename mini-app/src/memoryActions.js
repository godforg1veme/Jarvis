import { ApiError, readPending, savePending, clearPending } from './api.js';

function node(tag, text = '', className = '') {
  const value = document.createElement(tag);
  value.textContent = text; value.className = className;
  return value;
}
function button(text, className = 'secondary') {
  const value = node('button', text, className); value.type = 'button'; return value;
}

// Drafts stay in this tab's memory. Only the original operation UUID is persisted.
export function createMemoryActions({ api, actor, onChanged, onFatal, isActive = () => true }) {
  const root = node('section', '', 'memory-actions'); root.setAttribute('aria-label', 'Действия с памятью');
  const add = button('Добавить запись');
  const form = node('form', '', 'memory-actions__form'); form.hidden = true;
  const heading = node('h2'); heading.tabIndex = -1;
  const original = node('p', '', 'memory-actions__preview');
  const label = node('label', 'Что запомнить'); label.htmlFor = 'memory-content';
  const input = node('textarea'); input.id = 'memory-content'; input.rows = 4; input.maxLength = 1000;
  const preview = node('p', '', 'memory-actions__preview'); preview.hidden = true;
  const next = button('Продолжить', 'primary'); next.type = 'submit';
  const back = button('Изменить текст'); back.hidden = true;
  const confirm = button('Подтвердить', 'primary'); confirm.hidden = true;
  const close = button('Отмена');
  const controls = node('div', '', 'memory-actions__controls'); controls.append(next, back, confirm, close);
  form.append(heading, original, label, input, preview, controls);
  const status = node('p', '', 'memory-actions__status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const recovery = node('div', '', 'memory-actions__controls');
  const check = button('Проверить исходную операцию');
  const cancel = button('Отменить невыполненную операцию');
  recovery.append(check, cancel); root.append(add, form, status, recovery);
  let pending = readPending(actor, 'memory'); let busy = false; let draft = null; let reviewed = null; let itemButtons = [];

  function sync() {
    add.disabled = busy || Boolean(pending);
    recovery.hidden = !pending;
    check.disabled = busy; cancel.disabled = busy;
    for (const control of [input, next, back, confirm, close]) control.disabled = busy || Boolean(pending);
    root.dataset.pending = pending ? 'true' : 'false';
    root.setAttribute('aria-busy', String(busy));
    for (const control of itemButtons) control.disabled = busy || Boolean(pending);
  }
  function review(value) {
    reviewed = value;
    input.hidden = label.hidden = Boolean(value) || draft?.kind === 'forget';
    next.hidden = Boolean(value);
    back.hidden = !value || draft?.kind === 'forget';
    confirm.hidden = !value;
    preview.hidden = !value;
    preview.textContent = value ? (draft.kind === 'forget' ? 'Эта запись будет удалена из активной памяти.' : `Будет сохранено: ${value.content}`) : '';
    confirm.textContent = draft?.kind === 'forget' ? 'Подтвердить удаление' : 'Подтвердить сохранение';
  }
  function open(kind, item = null) {
    if (!isActive() || busy || pending) return;
    if (kind !== 'add' && (!item?.id || !/^[a-f0-9]{64}$/.test(item.expectedDigest || ''))) {
      status.textContent = 'Обнови список перед изменением записи.'; return;
    }
    draft = { kind, memoryId: item?.id || null, expectedDigest: item?.expectedDigest || null };
    form.hidden = false;
    heading.textContent = kind === 'add' ? 'Новая запись' : kind === 'correct' ? 'Исправление записи' : 'Удаление записи';
    original.hidden = !item; original.textContent = item ? `Сейчас в памяти: ${item.title}` : '';
    input.value = kind === 'correct' ? item.title : ''; input.required = kind !== 'forget';
    status.textContent = '';
    review(kind === 'forget' ? { ...draft, content: null } : null);
    sync(); heading.focus();
    if (kind !== 'forget') input.focus();
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault(); if (busy || pending || !draft || !isActive()) return;
    const content = input.value.trim().replace(/\s+/g, ' ');
    if (!content) { status.textContent = 'Напиши, что нужно запомнить.'; return; }
    review({ ...draft, content }); confirm.focus();
  });
  back.addEventListener('click', () => { if (!busy && !pending) { review(null); input.focus(); } });
  close.addEventListener('click', () => { if (!busy && !pending) { form.hidden = true; draft = reviewed = null; input.value = ''; add.focus(); } });
  add.addEventListener('click', () => open('add'));

  async function finish(result) {
    if (!['completed', 'cancelled'].includes(result?.status)) throw new ApiError('unknown', true);
    // Keep the UUID if browser storage is unavailable; never manufacture a replacement.
    clearPending(actor, 'memory', pending); pending = null;
    form.hidden = true; draft = reviewed = null; input.value = '';
    status.textContent = result.status === 'completed' ? 'Изменение памяти выполнено.' : 'Операция отменена. Изменений нет.';
    if (isActive()) {
      try { await onChanged(); }
      catch { status.textContent += ' Не удалось обновить список. Нажми «Обновить список».'; }
    }
  }
  async function run(mode) {
    if (busy || !isActive() || (mode === 'submit' && (!reviewed || pending)) || (mode !== 'submit' && !pending)) return;
    busy = true; sync();
    let submitted = false;
    try {
      if (mode === 'submit') {
        const id = crypto.randomUUID();
        savePending(actor, 'memory', id); pending = id; sync();
        submitted = true;
        await finish(await api.request('/memory/operations', 'POST', { operationId: id, ...reviewed }));
      } else {
        const path = `/memory/operations/${encodeURIComponent(pending)}`;
        await finish(await api.request(mode === 'cancel' ? `${path}/cancel` : path, mode === 'cancel' ? 'POST' : 'GET'));
      }
    } catch (error) {
      if (mode === 'submit' && submitted && error instanceof ApiError && ['invalid', 'rate_limited'].includes(error.code)) {
        clearPending(actor, 'memory', pending); pending = null;
        status.textContent = error.message;
      } else if (pending) {
        // A conflict may be a changed-payload replay. Reconcile or tombstone the same UUID.
        status.textContent = error.code === 'conflict'
          ? 'Данные изменились. Проверь исходную операцию или отмени невыполненную. После отмены список обновится.'
          : 'Результат пока неизвестен. Проверь исходную операцию. Можно отменить её, если она ещё не выполнена.';
      } else status.textContent = error.message || 'Не удалось подготовить запрос. Попробуй ещё раз.';
      if (['unauthorized', 'forbidden'].includes(error.code)) onFatal(error);
    } finally { busy = false; sync(); }
  }
  confirm.addEventListener('click', () => { void run('submit'); });
  check.addEventListener('click', () => { void run('check'); });
  cancel.addEventListener('click', () => { void run('cancel'); });
  if (pending) status.textContent = 'Осталась операция с неизвестным результатом. Проверь её перед новым изменением памяти. Текст записи в браузере не сохранялся.';
  sync();
  return { element: root, open, resetButtons() { itemButtons = []; }, actionButton(kind, item) {
    const control = button(kind === 'correct' ? 'Исправить' : 'Удалить');
    control.dataset.memoryAction = kind;
    control.disabled = busy || Boolean(pending);
    control.addEventListener('click', () => open(kind, item));
    itemButtons.push(control); return control;
  } };
}
