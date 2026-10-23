import { readPending, savePending, clearPending } from './api.js';
const $ = (selector) => document.querySelector(selector);
const make = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
export function createAdmin({ api, actor, labels, onSessionError }) {
  let users = []; let roles = []; let edit; let busy = false;
  const dialog = $('#editor'); const form = $('#editor-form'); const body = $('#editor-body');
  const submit = form.querySelector('[type="submit"]');
  const error = $('#editor-error');
  function button(text, action, className = 'secondary') { const result = make('button', text, className); result.type = 'button'; result.addEventListener('click', action); return result; }
  function field(label, id, value = '', options) {
    const caption = make('label', label, 'field-label'); caption.htmlFor = id;
    const input = make(options ? 'select' : 'input'); input.id = id;
    if (options) for (const [key, name] of options) { const option = make('option', name); option.value = key; input.append(option); }
    else { input.type = 'text'; input.maxLength = 80; }
    input.value = value; body.append(caption, input); return input;
  }
  function roleName(id) { return roles.find((role) => role.id === id)?.name || 'Без роли'; }
  function effective(user, permission) {
    if (user.blocked) return { allowed: false, source: 'Блокировка' };
    if (user.level === 'owner' || user.level === 'admin') return { allowed: true, source: user.level === 'owner' ? 'Владелец' : 'Администратор' };
    if (user.overrides?.[permission]) return { allowed: user.overrides[permission] === 'allow', source: 'Личная настройка' };
    return { allowed: !!roles.find((role) => role.id === user.roleId)?.permissions.includes(permission), source: `Роль «${roleName(user.roleId)}»` };
  }
  function open(title, draft, path, method, kind) {
    edit = { draft, path, method, kind, confirmed: false, pending: null };
    $('#editor-title').textContent = title; $('#editor-eyebrow').textContent = 'ПРОВЕРЕННЫЙ ДОСТУП';
    body.replaceChildren(); error.textContent = ''; submit.hidden = false; submit.disabled = false; submit.textContent = 'Проверить изменения';
    dialog.dataset.kind = kind; dialog.dataset.state = 'editing'; dialog.showModal();
  }
  function readonly(user) {
    open(user.displayName || user.telegramId, {}, '', '', 'readonly');
    body.append(make('p', `Telegram ID: ${user.telegramId}`, 'muted'), make('p', user.level === 'owner' ? 'Владелец защищён от блокировки и понижения.' : 'Только главный администратор может изменять другого администратора.', 'summary'));
    submit.hidden = true;
  }
  function updateSummary() {
    const summary = $('#access-summary');
    if (!summary || !edit) return;
    summary.replaceChildren();
    for (const [id, name] of Object.entries(labels)) { const result = effective(edit.draft, id); summary.append(make('p', `${name}: ${result.allowed ? 'разрешено' : 'закрыто'} · ${result.source}`)); }
  }
  function invalidate() { if (!edit?.pending) { edit.confirmed = false; submit.textContent = 'Проверить изменения'; $('#confirmation')?.remove(); updateSummary(); } }
  function userEditor(user) {
    if (user?.level === 'owner' || (user?.level === 'admin' && actor.level !== 'owner')) return readonly(user);
    const draft = user ? { revision: user.revision, roleId: user.roleId, overrides: { ...user.overrides }, blocked: user.blocked, ...(actor.level === 'owner' ? { level: user.level } : {}) } : { telegramId: '', displayName: '', roleId: roles[0]?.id || null, level: 'member' };
    open(user ? `Доступ: ${user.displayName || user.telegramId}` : 'Добавить пользователя', draft, user ? `/admin/users/${encodeURIComponent(user.telegramId)}` : '/admin/users', user ? 'PATCH' : 'POST', 'user');
    edit.target = user?.telegramId;
    if (!user) {
      const id = field('Telegram ID', 'telegram-id'); id.required = true; id.inputMode = 'numeric'; id.pattern = '[1-9][0-9]{0,15}'; id.maxLength = 16;
      id.addEventListener('input', () => { draft.telegramId = id.value.trim(); });
      const name = field('Имя для отображения', 'user-name'); name.required = true;
      name.addEventListener('input', () => { draft.displayName = name.value.trim(); });
      body.append(make('p', 'Только числовой Telegram ID. Имя и @username не дают полномочий.', 'field-hint'));
    } else body.append(make('p', `Telegram ID: ${user.telegramId}`, 'muted'));
    const role = field('Роль', 'user-role', draft.roleId || '', [['', 'Без роли'], ...roles.map((item) => [item.id, item.name])]);
    role.addEventListener('change', () => { draft.roleId = role.value || null; updateSummary(); });
    if (actor.level === 'owner') {
      const level = field('Уровень доступа', 'user-level', draft.level, [['member', 'Пользователь'], ['admin', 'Администратор']]);
      level.addEventListener('change', () => { draft.level = level.value; updateSummary(); });
      body.append(make('p', 'Администратор управляет ролями и доступами. Чужая переписка и подключения закрыты.', 'field-hint'));
    }
    if (user) {
      body.append(make('p', 'Личные настройки имеют приоритет над ролью.', 'field-hint'));
      for (const [id, name] of Object.entries(labels)) {
        const row = make('div', undefined, 'permission'); row.append(make('span', name, 'permission-name'));
        const group = make('div', undefined, 'segments'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', name);
        for (const [value, text] of [['inherit', 'По роли'], ['allow', 'Да'], ['deny', 'Нет']]) {
          const label = make('label'); const input = make('input'); input.type = 'radio'; input.name = `perm-${id}`; input.value = value; input.checked = (draft.overrides[id] || 'inherit') === value; input.setAttribute('aria-label', `${name}: ${text}`);
          input.addEventListener('change', () => { if (value === 'inherit') delete draft.overrides[id]; else draft.overrides[id] = value; updateSummary(); });
          label.append(input, make('span', text)); group.append(label);
        }
        row.append(group); body.append(row);
      }
      const block = button(draft.blocked ? 'Разблокировать пользователя' : 'Заблокировать пользователя', () => { draft.blocked = !draft.blocked; block.textContent = draft.blocked ? 'Разблокировать пользователя' : 'Заблокировать пользователя'; block.dataset.action = draft.blocked ? 'unblock' : 'block'; invalidate(); }, 'block-toggle'); block.dataset.action = draft.blocked ? 'unblock' : 'block'; body.append(block);
      const summary = make('div', undefined, 'summary'); summary.id = 'access-summary'; body.append(summary); updateSummary();
    }
  }
  function roleEditor(role) {
    const draft = { name: role?.name || '', permissions: [...(role?.permissions || [])], ...(role ? { revision: role.revision } : {}) };
    open(role ? 'Настройка роли' : 'Новая роль', draft, role ? `/admin/roles/${encodeURIComponent(role.id)}` : '/admin/roles', role ? 'PATCH' : 'POST', 'role');
    const name = field('Название роли', 'role-name', draft.name); name.required = true; name.maxLength = 60; name.addEventListener('input', () => { draft.name = name.value.trim(); });
    body.append(make('p', 'Изменения применяются ко всем участникам роли. Личные исключения сохраняются.', 'field-hint'));
    for (const [id, text] of Object.entries(labels)) { const label = make('label', text, 'check-row'); const check = make('input'); check.type = 'checkbox'; check.checked = draft.permissions.includes(id); check.addEventListener('change', () => { draft.permissions = [...body.querySelectorAll('.check-row input:checked')].map((input) => input.value); }); check.value = id; label.append(check); body.append(label); }
  }
  function render() {
    $('#user-count').textContent = users.length; $('#users').replaceChildren(); $('#roles').replaceChildren();
    const query = $('#search').value.trim().toLocaleLowerCase('ru');
    for (const user of users.filter((item) => `${item.displayName || ''} ${item.telegramId}`.toLocaleLowerCase('ru').includes(query))) {
      const row = button('', () => userEditor(user), 'user-row'); const info = make('span', undefined, 'user-info'); info.append(make('strong', user.displayName || 'Пользователь'), make('small', `Telegram ID: ${user.telegramId}`));
      row.append(make('span', (user.displayName || 'J')[0], 'avatar'), info, make('span', user.blocked ? 'Заблокирован' : user.level === 'owner' ? 'Владелец' : user.level === 'admin' ? 'Администратор' : roleName(user.roleId), `tag ${user.blocked ? 'blocked' : ''}`)); $('#users').append(row);
    }
    if (!$('#users').children.length) $('#users').append(make('div', 'Пользователь не найден.', 'section-empty'));
    for (const role of roles) { const row = button('', () => roleEditor(role), 'user-row'); const info = make('span', undefined, 'user-info'); info.append(make('strong', role.name), make('small', `Разделов: ${role.permissions.length} · Участников: ${users.filter((user) => user.roleId === role.id).length}`)); row.append(info); $('#roles').append(row); }
    if (!roles.length) $('#roles').append(make('div', 'Роли пока не созданы.', 'section-empty'));
  }
  async function load() {
    if (!['owner', 'admin'].includes(actor.level)) return;
    $('#admin').dataset.state = 'loading'; $('#admin').setAttribute('aria-busy', 'true'); $('#admin-feedback')?.remove();
    $('#admin-loading')?.remove();
    const loading = make('p', 'Загружаем людей и роли…', 'interior-loading'); loading.id = 'admin-loading'; loading.setAttribute('role', 'status'); $('#admin .tabs').before(loading);
    let data;
    try { data = await api.request('/admin'); }
    catch (problem) {
      loading.remove();
      $('#admin').dataset.state = 'error'; $('#admin').setAttribute('aria-busy', 'false');
      if (['unauthorized', 'forbidden'].includes(problem.code)) throw problem;
      const feedback = make('div', undefined, 'section-notice'); feedback.id = 'admin-feedback'; feedback.setAttribute('role', 'status');
      feedback.append(make('p', 'Не удалось обновить список доступа. Проверь соединение и повтори.'), button('Повторить', () => load().catch(onSessionError)));
      $('#admin .tabs').before(feedback); return;
    }
    loading.remove(); $('#admin').dataset.state = 'ready'; $('#admin').setAttribute('aria-busy', 'false'); users = data.users; roles = data.roles; render();
    $('#audit').replaceChildren(make('h2', 'История доступа'));
    const actions = { 'user.create': 'Добавлен пользователь', 'user.update': 'Изменены права пользователя', 'role.create': 'Создана роль', 'role.update': 'Изменена роль' };
    for (const record of data.audit || []) {
      const entry = make('article', undefined, 'audit-entry');
      const time = new Date(record.createdAt);
      const date = Number.isFinite(time.getTime()) ? `${new Intl.DateTimeFormat('ru-RU', { timeZone: 'Etc/GMT-3', dateStyle: 'short', timeStyle: 'short' }).format(time)} МСК` : '';
      entry.append(make('strong', actions[record.kind] || 'Изменение доступа'), make('p', [date, record.target ? `Пользователь: ${record.target}` : '', record.actorId ? `Администратор: ${record.actorId}` : ''].filter(Boolean).join(' · '), 'muted')); $('#audit').append(entry);
    }
    if (!data.audit?.length) $('#audit').append(make('p', 'Изменений пока нет.', 'muted'));
  }
  function freeze(value) { for (const control of body.querySelectorAll('input,select,button')) control.disabled = value; }
  async function finish() { clearPending(actor, 'admin', edit.pending.operationId); edit.pending = null; dialog.close(); edit = null; try { await load(); } catch (problem) { onSessionError(problem); } }
  async function reconcile() {
    try {
      const outcome = await api.request(`/admin/operations/${encodeURIComponent(edit.pending.operationId)}`);
      if (outcome.result && outcome.status !== 'pending') { await finish(); return; }
      error.textContent = 'Операция ещё не завершена. Проверь её исходный ID ещё раз.';
    } catch (problem) { error.textContent = problem.code === 'invalid' ? 'Операция пока не найдена. Не повторяй изменение: проверь исходный ID позже.' : problem.message; if (['unauthorized', 'forbidden'].includes(problem.code)) onSessionError(problem); }
  }
  form.addEventListener('input', invalidate); form.addEventListener('change', invalidate);
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!edit || busy || edit.kind === 'readonly') return;
    if (edit.pending) { busy = true; submit.disabled = true; await reconcile(); busy = false; submit.disabled = false; return; }
    if (!edit.confirmed) {
      const confirmation = make('div', undefined, 'summary'); confirmation.id = 'confirmation';
      const draft = edit.draft;
      confirmation.append(make('strong', 'Подтверди изменение доступа'), make('p', edit.kind === 'role' ? `Роль «${draft.name}». Разрешено: ${draft.permissions.map((id) => labels[id]).join(', ') || 'ничего'}. Изменение затронет всех участников роли.` : `Telegram ID: ${edit.target || draft.telegramId}. Роль: ${roleName(draft.roleId)}. Уровень: ${draft.level === 'admin' ? 'Администратор' : 'Пользователь'}. ${draft.blocked ? 'Доступ будет заблокирован.' : 'Доступ активен.'}`));
      if (draft.overrides) confirmation.append(make('p', `Личные исключения: ${Object.entries(draft.overrides).map(([id, value]) => `${labels[id]} — ${value === 'allow' ? 'разрешить' : 'запретить'}`).join('; ') || 'по роли'}`));
      body.append(confirmation); edit.confirmed = true; dialog.dataset.state = 'confirmation'; submit.textContent = 'Подтвердить и сохранить'; confirmation.scrollIntoView({ block: 'nearest' }); return;
    }
    busy = true; submit.disabled = true; error.textContent = ''; dialog.dataset.state = 'pending'; freeze(true);
    edit.pending = { ...edit.draft, operationId: crypto.randomUUID() };
    try { savePending(actor, 'admin', edit.pending.operationId); await api.request(edit.path, edit.method, edit.pending); await finish(); }
    catch (problem) {
      error.textContent = problem.message;
      if (problem.uncertain) { dialog.dataset.state = 'unknown'; submit.textContent = 'Проверить исходную операцию'; error.textContent += ` ID: ${edit.pending.operationId}`; }
      else { dialog.dataset.state = 'error'; clearPending(actor, 'admin', edit.pending.operationId); edit.pending = null; freeze(false); edit.confirmed = false; submit.textContent = 'Проверить изменения'; $('#confirmation')?.remove(); }
      if (['unauthorized', 'forbidden'].includes(problem.code)) onSessionError(problem);
    } finally { busy = false; submit.disabled = false; }
  });
  function close() { if (busy || edit?.pending) { error.textContent = 'Сначала проверь результат исходной операции. Черновик остаётся в этой вкладке.'; return; } dialog.close(); edit = null; }
  $('#close-editor').addEventListener('click', close); $('#cancel-editor').addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  $('#invite').addEventListener('click', () => userEditor()); $('#add-role').addEventListener('click', () => roleEditor()); $('#search').addEventListener('input', render);
  const refresh = button('Обновить список', () => load().catch(onSessionError)); $('#admin .tabs').before(refresh);
  for (const [current, other] of [['users', 'roles'], ['roles', 'users']]) {
    const activate = () => { $(`#${current}-panel`).hidden = false; $(`#${other}-panel`).hidden = true; $(`#${current}-tab`).setAttribute('aria-selected', 'true'); $(`#${other}-tab`).setAttribute('aria-selected', 'false'); $(`#${current}-tab`).tabIndex = 0; $(`#${other}-tab`).tabIndex = -1; };
    $(`#${current}-tab`).addEventListener('click', activate);
    $(`#${current}-tab`).addEventListener('keydown', (event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); $(`#${other}-tab`).click(); $(`#${other}-tab`).focus(); } });
  }
  const pendingId = readPending(actor, 'admin');
  if (pendingId && ['owner', 'admin'].includes(actor.level)) {
    open('Незавершённая операция', {}, '', '', 'recovery'); edit.pending = { operationId: pendingId };
    body.append(make('p', 'После перезагрузки нужно проверить результат исходного изменения. Данные черновика не сохранялись; повторная отправка отключена.', 'summary'));
    error.textContent = `ID: ${pendingId}`; submit.textContent = 'Проверить исходную операцию';
    dialog.dataset.state = 'unknown';
  }
  return { load };
}
