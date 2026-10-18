
import { createApi, readPending, savePending, clearPending } from './api.js';
import { createAdmin } from './admin.js';
const $ = (selector) => document.querySelector(selector);
const api = createApi();
let actor; let core; let admin; let chatPending; let chatBusy = false;
const labels = { assistant: 'Ассистент', jobs: 'Поиск работы', life: 'Life OS', memory: 'Память', documents: 'Документы', devices: 'Устройства', vpn: 'VPN', operations: 'Панель управления' };
function status(message) { $('#session-state').textContent = message; }
function fail(error) {
  status(error.message || 'Не удалось проверить доступ. Открой приложение заново.');
  if (['unauthorized', 'forbidden'].includes(error.code)) { $('#application').hidden = true; $('#editor').close(); api.clear(); core?.dispose(); }
}
const chat = document.createElement('div'); chat.id = 'chat';
const history = document.createElement('div'); history.className = 'chat-history'; history.setAttribute('aria-label', 'Личный диалог');
const chatForm = document.createElement('form'); chatForm.className = 'chat-form';
const chatLabel = document.createElement('label'); chatLabel.htmlFor = 'chat-input'; chatLabel.textContent = 'Сообщение Jarvis';
const chatInput = document.createElement('textarea'); chatInput.id = 'chat-input'; chatInput.maxLength = 10000; chatInput.required = true; chatInput.rows = 3;
const chatStatus = document.createElement('p'); chatStatus.setAttribute('role', 'status'); chatStatus.className = 'muted';
const chatSend = document.createElement('button'); chatSend.type = 'submit'; chatSend.className = 'primary'; chatSend.textContent = 'Отправить';
chatForm.append(chatLabel, chatInput, chatStatus, chatSend); chat.append(history, chatForm); $('#assistant').append(chat);
async function loadChat() {
  if (!actor?.permissions.includes('assistant')) return;
  chat.hidden = false; $('#section-items')?.remove(); $('#assistant h1').textContent = 'Пространство диалога';
  $('#assistant .muted').textContent = 'Твой личный диалог. Действия с подтверждением выполняются через Telegram.';
  try {
    const data = await api.request('/assistant/messages'); history.replaceChildren();
    for (const message of data.messages || []) {
      const row = document.createElement('article'); row.className = `chat-message ${message.role === 'user' ? 'mine' : ''}`;
      const author = document.createElement('strong'); author.textContent = message.role === 'user' ? 'Ты' : 'Jarvis';
      const content = document.createElement('p'); content.textContent = message.content; row.append(author, content); history.append(row);
    }
    if (!history.children.length) history.textContent = 'Начни новый разговор.';
  } catch (problem) { chatStatus.textContent = problem.message; if (['unauthorized', 'forbidden'].includes(problem.code)) fail(problem); }
}
chatForm.addEventListener('submit', async (event) => {
  event.preventDefault(); if (chatBusy) return;
  if (!chatPending && !chatInput.value.trim()) { chatStatus.textContent = 'Напиши сообщение.'; return; }
  chatBusy = true; chatSend.disabled = true;
  const reconciling = Boolean(chatPending);
  if (!chatPending) chatPending = { requestId: crypto.randomUUID(), text: chatInput.value.trim() };
  chatInput.disabled = true; chatStatus.textContent = reconciling ? 'Проверяем исходный запрос…' : 'Jarvis отвечает…';
  try {
    if (reconciling) await api.request(`/assistant/requests/${encodeURIComponent(chatPending.requestId)}`);
    else { savePending(actor, 'chat', chatPending.requestId); await api.request('/assistant/messages', 'POST', chatPending); }
    clearPending(actor, 'chat', chatPending.requestId); chatPending = null; chatInput.disabled = false; chatInput.required = true; chatInput.value = ''; chatStatus.textContent = ''; chatSend.textContent = 'Отправить'; await loadChat();
  } catch (problem) {
    if (reconciling || problem.uncertain) { chatStatus.textContent = `Результат пока неизвестен. Проверяй исходный запрос: ${chatPending.requestId}`; chatSend.textContent = 'Проверить исходный запрос'; }
    else { clearPending(actor, 'chat', chatPending.requestId); chatPending = null; chatInput.disabled = false; chatStatus.textContent = problem.message; }
    if (['unauthorized', 'forbidden'].includes(problem.code)) fail(problem);
  } finally { chatBusy = false; chatSend.disabled = false; }
});
function navigate() {
  let page = location.hash.slice(1);
  if (page === 'admin' && !['owner', 'admin'].includes(actor?.level)) page = 'home';
  if (page === 'assistant' && !actor?.permissions.includes('assistant')) page = 'home';
  if (!['home', 'assistant', 'admin'].includes(page)) page = 'home';
  document.querySelectorAll('.view').forEach((view) => { view.hidden = view.id !== page; });
  document.querySelectorAll('[data-nav]').forEach((link) => { if (link.dataset.nav === page) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  if (page === 'admin') admin?.load().catch(fail);
  if (page === 'assistant') loadChat();
}
async function start() {
  let data;
  // Launch data is untrusted transport; the server verifies its Telegram HMAC.
  // Reading the fragment also works when the optional remote SDK cannot load.
  const fragmentData = new URLSearchParams(location.hash.slice(1)).get('tgWebAppData') || '';
  const sdk = $('#telegram-sdk');
  if (!fragmentData && !window.Telegram?.WebApp && sdk) {
    await new Promise((resolve) => {
      const done = () => { clearTimeout(timer); sdk.removeEventListener('load', done); sdk.removeEventListener('error', done); resolve(); };
      const timer = setTimeout(done, 2000);
      sdk.addEventListener('load', done, { once: true }); sdk.addEventListener('error', done, { once: true });
    });
  }
  const initData = window.Telegram?.WebApp?.initData || fragmentData;
  const ready = () => { window.Telegram?.WebApp?.ready?.(); window.Telegram?.WebApp?.expand?.(); };
  try {
    try { data = await api.request('/me'); }
    catch (error) {
      if (error.code !== 'unauthorized') throw error;
      if (initData) data = await api.request('/session', 'POST', { initData });
      else { status('Открой Jarvis Mini App из Telegram. Для входа нужен Telegram ID, заранее добавленный администратором.'); return; }
    }
    actor = data.actor;
    if (!actor || actor.blocked) throw Object.assign(new Error('Доступ закрыт. Обратись к администратору.'), { code: 'forbidden' });
    actor.permissions ||= [];
    const pendingChatId = readPending(actor, 'chat');
    if (pendingChatId) {
      chatPending = { requestId: pendingChatId }; chatInput.disabled = true; chatInput.required = false;
      chatStatus.textContent = `Проверь исходный запрос после перезагрузки: ${pendingChatId}. Текст сообщения не сохранялся.`; chatSend.textContent = 'Проверить исходный запрос';
    }
    $('#identity').textContent = `${actor.displayName || 'Пользователь'} · ${actor.telegramId}`;
    status(`${actor.level === 'owner' ? 'Главный администратор' : actor.level === 'admin' ? 'Администратор' : 'Личное пространство'} · подтверждено Telegram`);
    const logout = document.createElement('button'); logout.type = 'button'; logout.className = 'secondary'; logout.textContent = 'Выйти';
    logout.addEventListener('click', async () => { try { await api.request('/logout', 'POST', {}); api.clear(); core?.dispose(); $('#application').hidden = true; status('Вы вышли. Для входа открой Mini App заново.'); } catch (error) { fail(error); } });
    $('#session-state').append(' ', logout);
    for (const permission of actor.permissions) {
      if (!labels[permission]) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'module';
      const content = document.createElement('div'); const title = document.createElement('strong'); title.textContent = labels[permission];
      const note = document.createElement('small'); note.textContent = permission === 'assistant' ? 'Личный диалог и история сообщений.' : permission === 'jobs' ? 'Нужно личное подключение HH. Настройка через Telegram.' : 'Твои данные и состояние раздела.';
      content.append(title, note); button.append(content);
      button.addEventListener('click', async () => {
        if (permission === 'assistant') { location.hash = '#assistant'; loadChat(); return; }
        chat.hidden = true;
        $('#assistant h1').textContent = labels[permission]; $('#assistant .muted').textContent = 'Загружаем твои данные…'; $('#section-items')?.remove();
        document.querySelectorAll('.view').forEach((view) => { view.hidden = view.id !== 'assistant'; });
        try {
          const section = await api.request(`/sections/${encodeURIComponent(permission)}`);
          $('#assistant .muted').textContent = section.notice || note.textContent;
          const items = document.createElement('ul'); items.id = 'section-items'; items.className = 'section-items';
          for (const item of section.items || []) { const row = document.createElement('li'); row.textContent = typeof item === 'string' ? item : [item.title || item.name || item.label, item.detail || item.summary || item.status].filter(Boolean).join(' · '); items.append(row); }
          $('#assistant .muted').after(items);
        } catch (error) { $('#assistant .muted').textContent = error.message; if (['unauthorized', 'forbidden'].includes(error.code)) fail(error); }
      });
      $('#modules').append(button);
    }
    if (!actor.permissions.length) $('#modules').textContent = 'Разделы пока не назначены. Обратись к администратору.';
    $('[data-nav="admin"]').hidden = !['owner', 'admin'].includes(actor.level);
    $('[data-nav="assistant"]').hidden = !actor.permissions.includes('assistant');
    admin = createAdmin({ api, actor, labels, onSessionError: fail });
    $('#application').hidden = false;
    ready();
    if (!window.Telegram?.WebApp) $('#telegram-sdk').addEventListener('load', ready, { once: true });
    window.addEventListener('hashchange', navigate); navigate();
    try {
      const { createCore } = await import('./core.js');
      core = createCore($('#core-stage'), { onStatus: (text) => { $('#core-status').textContent = text; } });
      if (!core.available) throw new Error('WEBGL_UNAVAILABLE');
      const pause = $('#pause');
      const sync = () => { pause.textContent = core.paused ? 'Продолжить' : 'Пауза'; pause.setAttribute('aria-pressed', String(core.paused)); };
      pause.addEventListener('click', () => { core.setPaused(!core.paused); sync(); });
      $('#speed').addEventListener('input', (event) => core.setSpeed(Number(event.target.value)));
      $('#reset-core').addEventListener('click', () => core.reset());
      matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', sync); sync();
      window.addEventListener('pagehide', () => core.dispose(), { once: true });
      window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
    } catch { $('#core-stage').dataset.render = 'fallback'; $('#core-status').textContent = 'СТАТИЧНЫЙ ВИД · 3D НЕДОСТУПНО'; document.querySelectorAll('.motion-controls button,.motion-controls input').forEach((element) => { element.disabled = true; }); }
    finally { $('#core-loading').hidden = true; }
  } catch (error) { fail(error); }
}
start();
