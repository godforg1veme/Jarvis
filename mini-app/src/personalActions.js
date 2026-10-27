import { ApiError, readPending, savePending, clearPending } from './api.js';

const LABELS = {
  upload: 'Добавить документ', delete: 'Удалить документ',
  pair: 'Подключить устройство', revoke: 'Отключить устройство', 'pair.cancel': 'Отменить подключение',
  'reminder.create': 'Создать напоминание', 'reminder.reschedule': 'Перенести напоминание', 'reminder.cancel': 'Отменить напоминание',
  'commitment.complete': 'Выполнить договорённость', 'commitment.dismiss': 'Скрыть договорённость',
  'project.pin': 'Закрепить проект', 'project.hide': 'Скрыть проект', 'project.restore': 'Вернуть проект',
};
const ROOT_KINDS = { documents: ['upload'], devices: ['pair'], life: ['reminder.create'] };
const MIME = { pdf: 'application/pdf', txt: 'text/plain', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function el(tag, text = '', className = '') { const n = document.createElement(tag); n.textContent = text; n.className = className; return n; }
function btn(text, className = 'secondary') { const n = el('button', text, className); n.type = 'button'; return n; }
function validMsk(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute) return null;
  return `${value}:00+03:00`;
}
function displayMsk(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return '';
  return `${new Intl.DateTimeFormat('ru-RU', { timeZone: 'Etc/GMT-3', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)} МСК`;
}
function targetKind(kind) { return kind === 'delete' ? 'document' : kind === 'pair.cancel' ? 'pairing' : kind === 'revoke' ? 'device' : kind.startsWith('reminder.') ? 'reminder' : kind.startsWith('commitment.') ? 'commitment' : 'project'; }

export function createPersonalActions({ api, actor, section, onChanged, onFatal, isActive }) {
  const root = el('section', '', 'personal-actions'); root.setAttribute('aria-label', 'Действия в разделе');
  const shortcuts = el('div', '', 'personal-actions__controls');
  const choices = el('div', '', 'personal-actions__choices');
  const form = el('form', '', 'personal-actions__form'); form.hidden = true;
  const heading = el('h2'); heading.tabIndex = -1;
  const current = el('p', '', 'personal-actions__preview');
  const fields = el('div', '', 'personal-actions__fields');
  const preview = el('p', '', 'personal-actions__preview'); preview.hidden = true;
  const next = btn('Показать изменение', 'primary'); next.type = 'submit';
  const back = btn('Изменить'); back.hidden = true;
  const confirm = btn('Подтвердить', 'primary'); confirm.hidden = true;
  const close = btn('Отмена');
  const controls = el('div', '', 'personal-actions__controls'); controls.append(next, back, confirm, close);
  form.append(heading, current, fields, preview, controls);
  const status = el('p', '', 'personal-actions__status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const result = el('p', '', 'personal-actions__result'); result.setAttribute('role', 'status'); result.hidden = true;
  const pairCancel = btn('Отменить это подключение'); pairCancel.hidden = true;
  const recovery = el('div', '', 'personal-actions__controls');
  const check = btn('Проверить исходную операцию'); const cancel = btn('Отменить невыполненную операцию');
  recovery.append(check, cancel); root.append(shortcuts, choices, form, status, result, pairCancel, recovery);
  const storageKind = `personal-${section}`;
  let pending = readPending(actor, storageKind), busy = false, loaded = false, dead = false, loadSequence = 0;
  let kinds = new Set(), describe = {}, draft = null, reviewed = null, itemButtons = [];
  if (pending) status.textContent = 'Осталась операция с неизвестным результатом. Проверь исходный ID или отмени операцию. Данные формы в браузере не сохранялись.';
  function active() { return !dead && isActive(); }
  function sync() {
    const blocked = busy || Boolean(pending) || !loaded;
    for (const control of [...shortcuts.querySelectorAll('button'), ...choices.querySelectorAll('button'), ...itemButtons]) control.disabled = blocked || !kinds.has(control.dataset.action);
    for (const control of [next, back, confirm, close, check, cancel]) control.disabled = busy || (control === check || control === cancel ? !pending : Boolean(pending));
    recovery.hidden = !pending; root.setAttribute('aria-busy', String(busy));
  }
  function inputField(labelText, type, id, maxLength) {
    const label = el('label', labelText); label.htmlFor = id;
    const input = el('input'); input.type = type; input.id = id; input.required = true;
    if (maxLength) input.maxLength = maxLength;
    fields.append(label, input); return input;
  }
  function setReview(value) {
    reviewed = value; preview.hidden = !value; fields.hidden = Boolean(value);
    next.hidden = Boolean(value); back.hidden = !value; confirm.hidden = !value;
    preview.textContent = value?.summary || '';
    confirm.textContent = draft?.kind === 'delete' ? 'Подтвердить удаление' : draft?.kind === 'revoke' ? 'Подтвердить отключение' : 'Подтвердить действие';
    sync();
  }
  async function open(kind, item = null) {
    if (!active() || busy || pending || !loaded || !kinds.has(kind)) return;
    status.textContent = ''; result.hidden = true; result.textContent = ''; pairCancel.hidden = true; fields.replaceChildren();
    const candidate = item?.id ? String(item.id) : null;
    let target = null;
    if (candidate) {
      if (!uuid.test(candidate)) { status.textContent = 'Обнови список перед изменением записи.'; return; }
      busy = true; sync();
      try {
        const data = await api.request(`/sections/${section}/actions/${encodeURIComponent(kind)}/${encodeURIComponent(candidate)}`);
        if (!active()) return;
        target = data.target;
        if (!target || target.id !== candidate || target.type !== targetKind(kind) || !((kind === 'pair.cancel' || kind.startsWith('project.')) && target.revision === null || (Number.isInteger(target.revision) && target.revision >= 0) || /^[a-f0-9]{64}$/i.test(target.revision || ''))) throw new ApiError('conflict');
      } catch (error) { if (active()) { status.textContent = error.message; if (['unauthorized', 'forbidden'].includes(error.code)) onFatal(error); } return; }
      finally { busy = false; sync(); }
    }
    draft = { kind, target };
    heading.textContent = LABELS[kind] || 'Действие';
    current.textContent = target ? `Текущая запись: ${target.title}${target.dueAt ? ` · ${displayMsk(target.dueAt)}` : ''}` : '';
    current.hidden = !target;
    if (kind === 'upload') {
      const file = inputField('Файл PDF, TXT или DOCX', 'file', 'personal-file'); file.accept = '.pdf,.txt,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else if (kind === 'pair') inputField('Название устройства', 'text', 'personal-name', 100);
    else if (kind === 'reminder.create') { inputField('Название напоминания', 'text', 'personal-title', 200); inputField('Дата и время, МСК', 'datetime-local', 'personal-time'); }
    else if (kind === 'reminder.reschedule') inputField('Новая дата и время, МСК', 'datetime-local', 'personal-time');
    form.hidden = false; setReview(null); heading.focus();
  }
  function collect() {
    if (!draft) return null;
    const { kind, target } = draft;
    let input = {}, file = null, summary = `${LABELS[kind]}.`;
    if (kind === 'upload') {
      file = fields.querySelector('input[type=file]')?.files?.[0];
      const ext = /\.([^.]+)$/.exec(file?.name || '')?.[1]?.toLowerCase();
      if (!file || !Object.hasOwn(MIME, ext) || !file.size || (describe.maxUploadBytes && file.size > describe.maxUploadBytes)) throw new Error('Выбери непустой PDF, TXT или DOCX в допустимом размере.');
      summary = `Добавить документ «${file.name}» (${Math.ceil(file.size / 1024)} КБ, ${MIME[ext]}). Файл будет загружен в твоё личное хранилище.`;
    } else if (kind === 'pair') {
      const name = fields.querySelector('#personal-name')?.value.trim(); if (!name || name.length > 100) throw new Error('Укажи название устройства до 100 символов.');
      input = { name }; summary = `Создать одноразовый код для устройства «${name}». Код появится только после подтверждения.`;
    } else if (kind === 'reminder.create' || kind === 'reminder.reschedule') {
      const triggerAt = validMsk(fields.querySelector('#personal-time')?.value || '');
      if (!triggerAt) throw new Error('Укажи корректную дату и время по МСК.');
      input = { triggerAt };
      if (kind === 'reminder.create') { const title = fields.querySelector('#personal-title')?.value.trim(); if (!title || title.length > 200) throw new Error('Укажи название напоминания до 200 символов.'); input.title = title; }
      summary = `${LABELS[kind]}: ${input.title ? `«${input.title}», ` : ''}${triggerAt.slice(0, 16).replace('T', ' ')} МСК. Уведомление придёт в твой Telegram.`;
    } else if (kind === 'project.hide') {
      input = { hiddenUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
      summary = `Скрыть проект «${target.title}» до ${displayMsk(input.hiddenUntil)}. Его можно вернуть раньше.`;
    } else if (kind === 'revoke') summary = `Отключить устройство «${target.title}» от Jarvis. Для доступа понадобится новое подключение.`;
    else if (kind === 'pair.cancel') summary = `Отозвать одноразовый код для «${target.title}». Этот код перестанет работать.`;
    else if (target) summary = `${LABELS[kind]}: «${target.title}». ${kind === 'delete' ? 'Удаление документа необратимо.' : 'Изменение затронет только твою запись.'}`;
    return { kind, targetId: target?.id || null, revision: target?.revision ?? null, input, file, summary };
  }
  form.addEventListener('submit', event => { event.preventDefault(); if (!active() || busy || pending) return; try { setReview(collect()); confirm.focus(); } catch (error) { status.textContent = error.message; } });
  back.addEventListener('click', () => { if (!busy && !pending) { setReview(null); fields.querySelector('input')?.focus(); } });
  close.addEventListener('click', () => { if (!busy && !pending) { form.hidden = true; draft = reviewed = null; fields.replaceChildren(); shortcuts.querySelector('button')?.focus(); } });
  function actionButton(kind, item, text = LABELS[kind]) { const control = btn(text); control.dataset.action = kind; control.disabled = busy || Boolean(pending) || !loaded || !kinds.has(kind); control.addEventListener('click', () => { void open(kind, item); }); itemButtons.push(control); return control; }
  function renderChoices() {
    shortcuts.replaceChildren(); choices.replaceChildren();
    for (const kind of ROOT_KINDS[section] || []) if (kinds.has(kind) && !(kind === 'reminder.create' && describe.canCreateReminder === false)) shortcuts.append(actionButton(kind, null));
    if (section === 'life' && describe.canCreateReminder === false && describe.reminderCreateHint) shortcuts.append(el('p', describe.reminderCreateHint, 'personal-actions__status'));
    if (section === 'life') {
      for (const reminder of describe.reminders || []) if (reminder?.id && uuid.test(reminder.id)) {
        const row = el('div', '', 'personal-actions__choice'); row.append(el('span', `Напоминание: ${reminder.title || 'Без названия'}${reminder.dueAt || reminder.triggerAt ? ` · ${displayMsk(reminder.dueAt || reminder.triggerAt)}` : ''}`));
        for (const kind of ['reminder.reschedule', 'reminder.cancel']) if (kinds.has(kind)) row.append(actionButton(kind, reminder)); choices.append(row);
      }
      for (const project of describe.projects || []) if (project?.id && uuid.test(project.id)) {
        const row = el('div', '', 'personal-actions__choice'); row.append(el('span', `Проект: ${project.title || 'Без названия'}`));
        for (const kind of ['project.pin', 'project.hide', 'project.restore']) if (kinds.has(kind)) row.append(actionButton(kind, project)); choices.append(row);
      }
    }
    sync();
  }
  async function load() {
    const sequence = ++loadSequence;
    const wasLoaded = loaded;
    try { const data = await api.request(`/sections/${section}/actions`); if (!active() || sequence !== loadSequence) return;
      describe = data; kinds = new Set((Array.isArray(data.kinds) ? data.kinds : []).filter(kind => Object.hasOwn(LABELS, kind)));
      loaded = true; renderChoices(); if (!wasLoaded) await onChanged();
    } catch (error) { if (!active() || sequence !== loadSequence) return; status.textContent = error.message || 'Не удалось загрузить действия.'; if (['unauthorized', 'forbidden'].includes(error.code)) onFatal(error); }
  }
  async function finish(data) {
    if (!['completed', 'cancelled'].includes(data?.status)) throw new ApiError('unknown', true);
    const id = pending; clearPending(actor, storageKind, id); pending = null;
    form.hidden = true; draft = reviewed = null; fields.replaceChildren();
    status.textContent = data.status === 'cancelled' ? 'Операция отменена.' : 'Действие выполнено.';
    if (data.status === 'completed' && data.result?.pairingId && uuid.test(data.result.pairingId)) {
      pairCancel.hidden = false; pairCancel.onclick = () => { void open('pair.cancel', { id: data.result.pairingId }); };
    }
    if (data.status === 'completed' && data.result?.code && data.result?.codeAvailable !== false) {
      result.hidden = false; result.textContent = `Одноразовый код подключения: ${data.result.code}. Срок действия: ${data.result.expiresAt ? displayMsk(data.result.expiresAt) : 'проверь в боте'}. Сохрани его сейчас: после ухода со страницы он не повторится.`;
    } else if (data.status === 'completed' && data.result?.codeAvailable === false) {
      result.hidden = false; result.textContent = 'Код подключения больше недоступен в этой сессии. Если устройство не подключено, отмени прежнее подключение и создай новое.';
    }
    if (active()) { try { await onChanged(); await load(); } catch { status.textContent += ' Не удалось обновить список; нажми «Обновить список».'; } }
  }
  async function run(mode) {
    if (!active() || busy || (mode === 'submit' ? !reviewed || pending : !pending)) return;
    busy = true; sync(); let submitted = false;
    try {
      if (mode === 'submit') {
        const id = crypto.randomUUID(); savePending(actor, storageKind, id); pending = id; submitted = true; sync();
        const { kind, targetId, revision, input, file } = reviewed;
        const data = kind === 'upload'
          ? await api.requestBinary(`/sections/documents/uploads/${id}`, file, file.name, MIME[/\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase()])
          : await api.request(`/sections/${section}/operations`, 'POST', { operationId: id, kind, targetId, revision, input });
        if (active()) await finish(data);
      } else {
        const path = `/sections/${section}/operations/${encodeURIComponent(pending)}`;
        const data = await api.request(mode === 'cancel' ? `${path}/cancel` : path, mode === 'cancel' ? 'POST' : 'GET', mode === 'cancel' ? {} : undefined);
        if (active()) await finish(data);
      }
    } catch (error) {
      if (!active()) return;
      if (submitted && error instanceof ApiError && error.code === 'invalid') { clearPending(actor, storageKind, pending); pending = null; status.textContent = error.message; }
      else if (pending) status.textContent = error.code === 'conflict' ? 'Данные изменились. Проверь исходную операцию или отмени её перед новым действием.' : 'Результат пока неизвестен. Проверь исходный ID или отмени операцию, если она не выполнена.';
      else status.textContent = error.message || 'Не удалось выполнить действие.';
      if (['unauthorized', 'forbidden'].includes(error.code)) onFatal(error);
    } finally { busy = false; sync(); }
  }
  confirm.addEventListener('click', () => { void run('submit'); });
  check.addEventListener('click', () => { void run('check'); });
  cancel.addEventListener('click', () => { void run('cancel'); });
  sync(); void load();
  return { element: root, actionButton, resetButtons() { itemButtons = []; }, supports(kind) { return kinds.has(kind); },
    dispose() { dead = true; result.textContent = ''; fields.replaceChildren(); form.hidden = true; draft = reviewed = null; }, load };
}
