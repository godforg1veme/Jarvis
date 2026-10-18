// Design sandbox: all users and edits exist only in memory in this tab.
const $ = (selector) => document.querySelector(selector);
const permissions = [
  ['jobs', 'Поиск работы'], ['life', 'Life OS'], ['memory', 'Память'],
  ['documents', 'Документы'], ['devices', 'Устройства'], ['vpn', 'VPN'],
  ['assistant', 'Ассистент'], ['operations', 'Панель управления'],
];
const roles = [{ id: 'search', name: 'Только поиск', permissions: ['jobs'] },
  { id: 'personal', name: 'Личное пространство', permissions: ['assistant', 'life', 'memory', 'documents'] }];
const users = [
  { telegramId: '100000001', name: 'Максим', level: 'owner', overrides: {}, blocked: false },
  { telegramId: '100000002', name: 'Алексей', level: 'admin', overrides: {}, blocked: false },
  { telegramId: '100000003', name: 'Анна', level: 'member', role: 'search', overrides: {}, blocked: false },
];
let core;
let edit = null;
let toastTimer;
const dialog = $('#editor');
const body = $('#editor-body');
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
}
function allowed(user, id) {
  if (user.blocked) return false;
  if (user.level === 'owner' || user.level === 'admin') return true;
  return user.overrides[id] ? user.overrides[id] === 'allow'
    : Boolean(roles.find((role) => role.id === user.role)?.permissions.includes(id));
}
function renderUsers() {
  const query = $('#search').value.trim().toLocaleLowerCase('ru');
  $('#user-count').textContent = users.length;
  $('#users').replaceChildren();
  for (const user of users.filter((item) => `${item.name} ${item.telegramId}`.toLocaleLowerCase('ru').includes(query))) {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'user-row';
    const title = user.level === 'owner' ? 'Владелец' : user.level === 'admin' ? 'Администратор' : roles.find((role) => role.id === user.role)?.name || 'Без роли';
    row.innerHTML = `<span class="avatar">${escape(user.name[0])}</span><span class="user-info"><strong>${escape(user.name)}</strong><small>Telegram ID: ${escape(user.telegramId)}</small></span><span class="tag ${user.level === 'owner' ? 'owner' : user.blocked ? 'blocked' : ''}">${escape(user.blocked ? 'Заблокирован' : title)}</span><span aria-hidden="true">›</span>`;
    row.addEventListener('click', () => editUser(user)); $('#users').append(row);
  }
  if (!$('#users').children.length) $('#users').textContent = 'Пользователь не найден.';
  $('#roles').replaceChildren();
  for (const role of roles) {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'user-row';
    row.innerHTML = `<span class="avatar">${escape(role.name[0])}</span><span class="user-info"><strong>${escape(role.name)}</strong><small>Разрешено разделов: ${role.permissions.length} · Участников: ${users.filter((user) => user.role === role.id).length}</small></span><span aria-hidden="true">›</span>`;
    row.addEventListener('click', () => editRole(role)); $('#roles').append(row);
  }
}
function openEditor(title, eyebrow) {
  $('#editor-title').textContent = title; $('#editor-eyebrow').textContent = eyebrow;
  $('#editor-error').textContent = ''; body.replaceChildren(); dialog.showModal();
}
function roleOptions(selected) {
  return roles.map((role) => `<option value="${escape(role.id)}" ${selected === role.id ? 'selected' : ''}>${escape(role.name)}</option>`).join('');
}
function summary(user) {
  return permissions.filter(([id]) => allowed(user, id)).map(([, name]) => name).join(', ') || 'Нет доступа к разделам';
}
function editUser(user) {
  if (user.level !== 'member') {
    openEditor(user.name, user.level === 'owner' ? 'ГЛАВНЫЙ АДМИНИСТРАТОР' : 'АДМИНИСТРАТОР');
    body.innerHTML = `<p class="muted">Telegram ID: ${escape(user.telegramId)}</p><p class="field-hint">${user.level === 'owner' ? 'Владелец защищён от блокировки и понижения.' : 'Управляет системой, ролями и доступами. Личные данные других пользователей закрыты.'}</p><p class="summary">Назначение и снятие администраторов реализуется только на сервере с подтверждением владельца. Этот образец проверяет обычные роли и личные исключения.</p>`;
    edit = { kind: 'readonly' }; return;
  }
  edit = { kind: 'user', original: user, draft: structuredClone(user) };
  openEditor(`Доступ: ${user.name}`, `TELEGRAM ID: ${user.telegramId}`);
  body.innerHTML = `<label class="field-label" for="user-role">Роль</label><select id="user-role">${roleOptions(user.role)}</select><p class="field-hint">Личная настройка имеет приоритет над ролью.</p>`;
  for (const [id, name] of permissions) {
    const row = document.createElement('div'); row.className = 'permission';
    const roleAllows = roles.find((role) => role.id === user.role)?.permissions.includes(id);
    row.innerHTML = `<span class="permission-name">${name}<small id="source-${id}">Роль: ${roleAllows ? 'разрешено' : 'запрещено'}</small></span><div class="segments" role="group" aria-label="${name}">${[['inherit','По роли'],['allow','Да'],['deny','Нет']].map(([value,label]) => `<label><input type="radio" name="perm-${id}" value="${value}" ${(user.overrides[id] || 'inherit') === value ? 'checked' : ''} aria-label="${name}: ${label}"><span>${label}</span></label>`).join('')}</div>`;
    row.addEventListener('change', (event) => {
      if (event.target.value === 'inherit') delete edit.draft.overrides[id];
      else edit.draft.overrides[id] = event.target.value;
      updateSummary();
    }); body.append(row);
  }
  const result = document.createElement('p'); result.id = 'access-summary'; result.className = 'summary'; body.append(result);
  const block = document.createElement('button'); block.type = 'button'; block.className = 'block-toggle';
  const refreshBlock = () => { block.textContent = edit.draft.blocked ? 'Разблокировать пользователя' : 'Заблокировать пользователя'; };
  refreshBlock();
  block.addEventListener('click', () => { edit.draft.blocked = !edit.draft.blocked; refreshBlock(); updateSummary(); }); body.append(block);
  $('#user-role').addEventListener('change', (event) => {
    edit.draft.role = event.target.value;
    for (const [id] of permissions) $(`#source-${id}`).textContent = `Роль: ${roles.find((role) => role.id === edit.draft.role).permissions.includes(id) ? 'разрешено' : 'запрещено'}`;
    updateSummary();
  });
  updateSummary();
}
function updateSummary() { $('#access-summary').textContent = edit.draft.blocked ? 'Пользователь заблокирован. Доступ закрыт.' : `Доступны: ${summary(edit.draft)}`; }
function editRole(role = null) {
  edit = { kind: 'role', original: role };
  openEditor(role ? 'Настройка роли' : 'Новая роль', 'ПРАВА ПО РАЗДЕЛАМ');
  body.innerHTML = `<label class="field-label" for="role-name">Название роли</label><input id="role-name" type="text" required maxlength="60" value="${escape(role?.name || '')}" placeholder="Например: Только поиск"><p class="field-hint">Применяется ко всем участникам. Личные исключения сохраняются.</p>${permissions.map(([id,name]) => `<label class="check-row">${name}<input type="checkbox" name="role-permissions" value="${id}" ${role?.permissions.includes(id) ? 'checked' : ''}></label>`).join('')}`;
}
$('#invite').addEventListener('click', () => {
  edit = { kind: 'add-user' }; openEditor('Добавить пользователя', 'ПРИВЯЗКА К TELEGRAM ID');
  body.innerHTML = `<label class="field-label" for="telegram-id">Telegram ID</label><input id="telegram-id" name="telegramId" type="text" inputmode="numeric" pattern="[1-9][0-9]{0,15}" maxlength="16" placeholder="Например: 100000004" required><p class="field-hint">Числовой ID аккаунта. Имя и @username не определяют доступ.</p><label class="field-label" for="user-name">Имя для отображения</label><input id="user-name" type="text" maxlength="60" required><label class="field-label" for="new-user-role">Роль</label><select id="new-user-role">${roleOptions('search')}</select>`;
});
$('#add-role').addEventListener('click', () => editRole());
$('#editor-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const error = $('#editor-error'); error.textContent = '';
  if (edit.kind === 'user') Object.assign(edit.original, edit.draft);
  if (edit.kind === 'role') {
    const name = $('#role-name').value.trim();
    if (!name) { error.textContent = 'Введи название роли.'; return; }
    if (roles.some((role) => role !== edit.original && role.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'))) { error.textContent = 'Роль с таким названием уже есть.'; return; }
    const selected = [...body.querySelectorAll('input[name=role-permissions]:checked')].map((input) => input.value);
    if (edit.original) Object.assign(edit.original, { name, permissions: selected });
    else roles.push({ id: crypto.randomUUID(), name, permissions: selected });
  }
  if (edit.kind === 'add-user') {
    const telegramId = $('#telegram-id').value.trim();
    if (!/^[1-9]\d{0,15}$/.test(telegramId) || BigInt(telegramId) > BigInt(Number.MAX_SAFE_INTEGER)) { error.textContent = 'Введи корректный числовой Telegram ID.'; return; }
    if (users.some((user) => user.telegramId === telegramId)) { error.textContent = 'Этот Telegram ID уже добавлен.'; return; }
    const name = $('#user-name').value.trim();
    if (!name) { error.textContent = 'Введи имя для отображения.'; return; }
    users.push({ telegramId, name, role: $('#new-user-role').value, level: 'member', overrides: {}, blocked: false });
  }
  dialog.close(); renderUsers(); if (edit.kind !== 'readonly') toast('Сохранено в превью. Сервер не изменён.');
});
$('#close-editor').addEventListener('click', () => dialog.close());
$('#cancel-editor').addEventListener('click', () => dialog.close());
$('#search').addEventListener('input', renderUsers);
function selectTab(tab) {
  for (const name of ['users', 'roles']) {
    const selected = name === tab;
    $(`#${name}-tab`).setAttribute('aria-selected', String(selected));
    $(`#${name}-tab`).tabIndex = selected ? 0 : -1;
    $(`#${name}-panel`).hidden = !selected;
  }
}
for (const name of ['users','roles']) {
  $(`#${name}-tab`).addEventListener('click', () => selectTab(name));
  $(`#${name}-tab`).addEventListener('keydown', (event) => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 'users' : event.key === 'End' ? 'roles' : name === 'users' ? 'roles' : 'users';
    selectTab(next); $(`#${next}-tab`).focus();
  });
}
const iconPaths = [
  '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 12h18M10 12v3h4v-3"/>',
  '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  '<path d="M8 4a3 3 0 0 0-4 3 3 3 0 0 0-1 5 4 4 0 0 0 5 6v2h4V5a3 3 0 0 0-4-1Zm8 0a3 3 0 0 1 4 3 3 3 0 0 1 1 5 4 4 0 0 1-5 6v2h-4V5a3 3 0 0 1 4-1Z"/>',
  '<path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8M8 16h6"/>',
  '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Zm-4 9 3 3 5-5"/>',
];
const descriptions = ['Вакансии, отклики и сопроводительные','Задачи, цели и ежедневный ритм','Твои знания и личный контекст','Всё важное в одном месте','Подключённые компьютеры','Твои безопасные подключения'];
permissions.slice(0,6).forEach(([,name], index) => {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'module';
  button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[index]}</svg><div><strong>${name}</strong><small>${descriptions[index]}</small></div><span class="arrow" aria-hidden="true">↗</span>`;
  button.addEventListener('click', () => toast(`${name}: подключение к серверу — следующий этап.`)); $('#modules').append(button);
});
function navigate() {
  const page = ['admin','assistant'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  document.querySelectorAll('.view').forEach((view) => { view.hidden = view.id !== page; });
  document.querySelectorAll('[data-nav]').forEach((link) => {
    if (link.dataset.nav === page) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  document.title = `Jarvis · ${page === 'admin' ? 'Управление' : page === 'assistant' ? 'Ассистент' : 'Mini App'} — образец`;
}
window.addEventListener('hashchange', navigate);
renderUsers(); navigate();
// Keep the UI usable even if the 3D module fails to load or WebGL is disabled.
try {
  const { createCore } = await import('/core.js');
  core = createCore($('#core-stage'), { onStatus: (text) => { $('#core-status').textContent = text; } });
  if (!core.available) throw new Error('WEBGL_UNAVAILABLE');
  const pause = $('#pause');
  const sync = () => { pause.textContent = core.paused ? 'Продолжить' : 'Пауза'; pause.setAttribute('aria-pressed', String(core.paused)); };
  pause.addEventListener('click', () => { core.setPaused(!core.paused); sync(); });
  $('#speed').addEventListener('input', (event) => core.setSpeed(Number(event.target.value)));
  $('#reset-core').addEventListener('click', () => core.reset());
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', sync);
  sync();
  window.addEventListener('pagehide', () => core.dispose(), { once: true });
  window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
} catch {
  $('#core-stage').dataset.render = 'fallback'; $('#core-status').textContent = 'СТАТИЧНЫЙ ВИД · 3D НЕДОСТУПНО';
  for (const element of document.querySelectorAll('.motion-controls button,.motion-controls input')) element.disabled = true;
} finally { $('#core-loading').hidden = true; }
