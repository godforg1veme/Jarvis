
import { createApi, readPending, savePending, clearPending } from './api.js';
import { createAdmin } from './admin.js';
import { createJobConnectionPanel } from './jobConnection.js';
import { renderSectionView } from './sectionViews.js';
const $ = (selector) => document.querySelector(selector);
const api = createApi();
let actor; let core; let admin; let chatPending; let chatBusy = false;
let jobConnectionPanel;
let navigationVersion = 0;
let currentPage = '';
let chatLoadVersion = 0;
let sessionActive = false;
let modulesOpen = false;
let lastSection = '';
let sceneMoving = true;
const labels = { assistant: 'Ассистент', jobs: 'Поиск работы', life: 'Life OS', memory: 'Память', documents: 'Документы', devices: 'Устройства', vpn: 'VPN', operations: 'Панель управления' };
function status(message) { $('#session-state').textContent = message; $('#session-state').hidden = !message; }
function fail(error) {
  status(error.message || 'Не удалось проверить доступ. Открой приложение заново.');
  if (['unauthorized', 'forbidden'].includes(error.code)) { sessionActive = false; navigationVersion++; currentPage = ''; $('#application').hidden = true; $('#editor').close(); disposeJobPanel(); api.clear(); core?.dispose(); syncMotion(); }
}
function openSection(permission) { location.hash = permission === 'assistant' ? '#assistant' : `#section/${permission}`; }
function syncDock() {
  const active = currentPage === 'home' && modulesOpen ? 'modules' : currentPage;
  document.querySelectorAll('[data-nav]').forEach((link) => { if (link.dataset.nav === active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
}
function showModules(value) {
  modulesOpen = value;
  $('#modules').hidden = !value;
  $('#all-sections')?.setAttribute('aria-expanded', String(value));
  syncDock();
}
function syncMotion() {
  const paused = !sessionActive || document.hidden || currentPage !== 'home' || !sceneMoving || $('#core-stage')?.dataset.render === 'fallback' || Boolean(core?.paused) || matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.body.dataset.motion = paused ? 'paused' : 'running';
}
function setExpanded(expanded) {
  $('#application').dataset.expanded = String(expanded);
  $('#workspace-expand').setAttribute('aria-pressed', String(expanded));
  $('#workspace-expand').setAttribute('aria-label', expanded ? 'Свернуть раздел' : 'Развернуть раздел');
}
function makeJobPanel() {
  jobConnectionPanel?.dispose();
  jobConnectionPanel = createJobConnectionPanel({ api, actor, anchor: $('#assistant .muted') });
}
function disposeJobPanel() { jobConnectionPanel?.dispose(); jobConnectionPanel = null; }
const chat = document.createElement('div'); chat.id = 'chat';
const history = document.createElement('div'); history.className = 'chat-history'; history.setAttribute('aria-label', 'Личный диалог');
const chatLoadStatus = document.createElement('p'); chatLoadStatus.setAttribute('role', 'status'); chatLoadStatus.className = 'muted';
const chatForm = document.createElement('form'); chatForm.className = 'chat-form';
const chatLabel = document.createElement('label'); chatLabel.htmlFor = 'chat-input'; chatLabel.textContent = 'Сообщение Jarvis';
const chatInput = document.createElement('textarea'); chatInput.id = 'chat-input'; chatInput.maxLength = 10000; chatInput.required = true; chatInput.rows = 3;
const chatStatus = document.createElement('p'); chatStatus.setAttribute('role', 'status'); chatStatus.className = 'muted chat-state';
const chatSend = document.createElement('button'); chatSend.type = 'submit'; chatSend.className = 'primary'; chatSend.textContent = 'Отправить';
chatForm.append(chatLabel, chatInput, chatStatus, chatSend); chat.append(history, chatLoadStatus, chatForm); $('#assistant > a[href="#home"]').before(chat);
async function loadChat() {
  if (!actor?.permissions.includes('assistant')) return;
  $('#assistant').dataset.state = 'ready';
  const version = navigationVersion;
  const loadVersion = ++chatLoadVersion;
  chat.hidden = false; $('#section-items')?.remove(); $('#section-retry')?.remove(); $('#chat-retry')?.remove(); $('#assistant h1').textContent = 'Диалог'; $('#assistant .eyebrow').textContent = 'ЛИЧНЫЙ АССИСТЕНТ';
  $('#assistant .muted').textContent = 'Твой личный диалог. Действия с подтверждением выполняются через Telegram.';
  chatLoadStatus.textContent = 'Загружаем диалог…'; chatLoadStatus.dataset.state = 'loading'; history.setAttribute('aria-busy', 'true');
  try {
    const data = await api.request('/assistant/messages');
    if (version !== navigationVersion || loadVersion !== chatLoadVersion || currentPage !== 'assistant') return;
    chatLoadStatus.textContent = ''; chatLoadStatus.dataset.state = ''; history.setAttribute('aria-busy', 'false'); history.replaceChildren();
    for (const message of data.messages || []) {
      const row = document.createElement('article'); row.className = `chat-message ${message.role === 'user' ? 'mine' : ''}`;
      const author = document.createElement('strong'); author.textContent = message.role === 'user' ? 'Ты' : 'Jarvis';
      const header = document.createElement('div'); header.className = 'chat-message__header';
      const avatar = document.createElement('span'); avatar.className = 'chat-message__avatar'; avatar.setAttribute('aria-hidden', 'true'); avatar.textContent = message.role === 'user' ? 'Т' : 'J';
      header.append(avatar, author);
      const content = document.createElement('p'); content.textContent = message.content; row.append(header, content); history.append(row);
    }
    if (!history.children.length) {
      const empty = document.createElement('div'); empty.className = 'chat-empty';
      const title = document.createElement('h2'); title.textContent = 'Начни новый разговор.';
      const hint = document.createElement('p'); hint.textContent = 'Напиши вопрос или расскажи, с чем нужна помощь.';
      empty.append(title, hint); history.append(empty);
    }
  } catch (problem) {
    if (version !== navigationVersion || loadVersion !== chatLoadVersion || currentPage !== 'assistant') return;
    chatLoadStatus.textContent = problem.code === 'unavailable' ? 'Не удалось загрузить историю. Проверь соединение и повтори.' : problem.message || 'Не удалось загрузить диалог.';
    chatLoadStatus.dataset.state = 'error'; history.setAttribute('aria-busy', 'false');
    if (['unauthorized', 'forbidden'].includes(problem.code)) { fail(problem); return; }
    const retry = document.createElement('button'); retry.id = 'chat-retry'; retry.type = 'button'; retry.className = 'secondary'; retry.textContent = 'Повторить';
    retry.addEventListener('click', () => { if (currentPage === 'assistant') loadChat(); });
    history.after(retry);
  }
}
chatForm.addEventListener('submit', async (event) => {
  event.preventDefault(); if (chatBusy) return;
  if (!chatPending && !chatInput.value.trim()) { chatStatus.textContent = 'Напиши сообщение.'; return; }
  chatBusy = true; chatSend.disabled = true;
  const reconciling = Boolean(chatPending);
  if (!chatPending) chatPending = { requestId: crypto.randomUUID(), text: chatInput.value.trim() };
  chatInput.disabled = true; chatStatus.textContent = reconciling ? 'Проверяем исходный запрос…' : 'Jarvis отвечает…';
  chatStatus.dataset.state = 'pending';
  try {
    if (reconciling) await api.request(`/assistant/requests/${encodeURIComponent(chatPending.requestId)}`);
    else { savePending(actor, 'chat', chatPending.requestId); await api.request('/assistant/messages', 'POST', chatPending); }
    clearPending(actor, 'chat', chatPending.requestId); chatPending = null; chatInput.disabled = false; chatInput.required = true; chatInput.value = ''; chatStatus.textContent = ''; chatStatus.dataset.state = ''; chatSend.textContent = 'Отправить'; if (currentPage === 'assistant') await loadChat();
  } catch (problem) {
    if (reconciling || problem.uncertain) { chatStatus.dataset.state = 'unknown'; chatStatus.textContent = `Результат пока неизвестен. Проверяй исходный запрос: ${chatPending.requestId}`; chatSend.textContent = 'Проверить исходный запрос'; }
    else { chatStatus.dataset.state = 'error'; clearPending(actor, 'chat', chatPending.requestId); chatPending = null; chatInput.disabled = false; chatStatus.textContent = problem.message; }
    if (['unauthorized', 'forbidden'].includes(problem.code)) fail(problem);
  } finally { chatBusy = false; chatSend.disabled = false; }
});
async function loadSection(permission, version) {
  try {
    const section = await api.request(`/sections/${encodeURIComponent(permission)}`);
    if (version !== navigationVersion || currentPage !== `section/${permission}`) return;
    $('#assistant .muted').textContent = section.notice || 'Твои данные и состояние раздела.';
    $('#assistant').dataset.state = 'ready';
    if (permission === 'jobs') { makeJobPanel(); return; }
    const items = renderSectionView(permission, section);
    if (['vpn', 'operations'].includes(permission)) $('#assistant .muted').textContent = 'Доступ и порядок подтверждения';
    $('#assistant .muted').after(items);
  } catch (error) {
    if (version !== navigationVersion || currentPage !== `section/${permission}`) return;
    $('#assistant .muted').textContent = error.code === 'unavailable' ? 'Не удалось загрузить раздел. Проверь соединение и повтори.' : error.message || 'Не удалось загрузить раздел.';
    $('#assistant').dataset.state = 'error';
    if (['unauthorized', 'forbidden'].includes(error.code)) { fail(error); return; }
    const retry = document.createElement('button'); retry.id = 'section-retry'; retry.type = 'button'; retry.className = 'secondary'; retry.textContent = 'Повторить';
    retry.addEventListener('click', () => { if (currentPage !== `section/${permission}`) return; retry.remove(); $('#assistant').dataset.state = 'loading'; $('#assistant .muted').textContent = 'Загружаем твои данные…'; loadSection(permission, ++navigationVersion); });
    $('#assistant .muted').after(retry);
  }
}
function navigate() {
  const hash = location.hash.slice(1);
  if (!sessionActive) return;
  if (hash === 'home') {
    showModules(false); $('#section-search').value = ''; $('#section-search-status').textContent = '';
    document.querySelectorAll('#modules .module').forEach((button) => { button.hidden = false; });
  }
  if (hash === 'modules') showModules(true);
  if (hash === 'modules' && currentPage === 'home') return;
  let page = hash === 'modules' ? 'home' : hash;
  if (page === 'admin' && !['owner', 'admin'].includes(actor?.level)) page = 'home';
  if (page === 'assistant' && !actor?.permissions.includes('assistant')) page = 'home';
  const permission = page.startsWith('section/') ? page.slice(8) : '';
  if (page.startsWith('section/') && (!permission || !labels[permission] || permission === 'assistant' || !actor?.permissions.includes(permission))) page = 'home';
  if (!['home', 'assistant', 'admin'].includes(page) && !page.startsWith('section/')) page = 'home';
  if (page === currentPage) return;
  const version = ++navigationVersion; currentPage = page;
  disposeJobPanel();
  const workspaceOpen = page !== 'home';
  $('#workspace').hidden = !workspaceOpen;
  $('#application').dataset.workspace = workspaceOpen ? 'open' : '';
  $('#application').dataset.expanded = 'false';
  $('#workspace-expand').setAttribute('aria-pressed', 'false');
  $('#workspace-expand').setAttribute('aria-label', 'Развернуть раздел');
  $('#core-stage').dataset.selected = page === 'assistant' ? 'assistant' : page.startsWith('section/') ? page.slice(8) : '';
  core?.setWorkspace(workspaceOpen);
  syncMotion();
  document.querySelectorAll('.view').forEach((view) => { view.hidden = view.id !== (page.startsWith('section/') ? 'assistant' : page); });
  syncDock();
  if (page === 'admin') admin?.load().catch((error) => { if (version === navigationVersion) fail(error); });
  if (page === 'assistant') loadChat();
  if (page.startsWith('section/')) {
    const section = page.slice(8); chat.hidden = true; $('#section-items')?.remove(); $('#section-retry')?.remove();
    $('#assistant').dataset.state = 'loading'; $('#assistant h1').textContent = labels[section]; $('#assistant .eyebrow').textContent = 'ЛИЧНОЕ ПРОСТРАНСТВО'; $('#assistant .muted').textContent = 'Загружаем твои данные…';
    loadSection(section, version);
  }
  if (page === 'assistant' || page.startsWith('section/')) lastSection = page === 'assistant' ? 'assistant' : page.slice(8);
  if (hash === 'modules') requestAnimationFrame(() => { if (currentPage === 'home' && location.hash === '#modules') $('#modules').scrollIntoView(); });
  if (page !== 'home') $(`#${page.startsWith('section/') ? 'assistant' : page} h1`)?.focus({ preventScroll: true });
  else if (lastSection && hash !== 'modules') {
    const target = document.querySelector(`[data-planet="${lastSection}"]`);
    (target && !target.hidden ? target : $('#all-sections'))?.focus({ preventScroll: true });
  }
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
    sessionActive = true;
    const pendingChatId = readPending(actor, 'chat');
    if (pendingChatId) {
      chatPending = { requestId: pendingChatId }; chatInput.disabled = true; chatInput.required = false;
      chatStatus.textContent = `Проверь исходный запрос после перезагрузки: ${pendingChatId}. Текст сообщения не сохранялся.`; chatSend.textContent = 'Проверить исходный запрос';
      chatStatus.dataset.state = 'unknown';
    }
    status('');
    const logout = document.createElement('button'); logout.type = 'button'; logout.className = 'secondary'; logout.textContent = 'Выйти';
    logout.addEventListener('click', async () => { if (logout.disabled) return; logout.disabled = true; try { await api.request('/logout', 'POST', {}); sessionActive = false; navigationVersion++; currentPage = ''; disposeJobPanel(); api.clear(); core?.dispose(); syncMotion(); $('#application').hidden = true; status('Вы вышли. Для входа открой Mini App заново.'); } catch (error) { logout.disabled = false; fail(error); } });
    $('.topbar').append(logout);
    for (const permission of actor.permissions) {
      if (!labels[permission]) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'module'; button.dataset.module = permission;
      const content = document.createElement('div'); const title = document.createElement('strong'); title.textContent = labels[permission];
      const note = document.createElement('small'); note.textContent = permission === 'assistant' ? 'Личный диалог и история сообщений.' : permission === 'jobs' ? 'Личный поиск по твоему профилю HH.' : 'Твои данные и состояние раздела.';
      content.append(title, note); button.append(content);
      button.addEventListener('click', () => openSection(permission));
      $('#modules').append(button);
    }
    if (!actor.permissions.length) $('#modules').textContent = 'Разделы пока не назначены. Обратись к администратору.';
    $('#section-search').addEventListener('input', (event) => {
      const query = event.target.value.trim().toLocaleLowerCase('ru');
      if (currentPage !== 'home') location.hash = '#modules';
      showModules(Boolean(query) || modulesOpen);
      let matches = 0;
      for (const button of document.querySelectorAll('#modules .module')) {
        button.hidden = !labels[button.dataset.module].toLocaleLowerCase('ru').includes(query);
        if (!button.hidden) matches++;
      }
      $('#section-search-status').textContent = query && !matches ? 'Ничего не найдено. Попробуй другое название.' : '';
    });
    $('#all-sections').addEventListener('click', (event) => {
      event.preventDefault(); showModules(!modulesOpen);
      if (modulesOpen) $('#modules').scrollIntoView({ block: 'nearest', behavior: 'instant' });
    });
    document.querySelectorAll('.bottom-nav a[href="#modules"]').forEach((link) => link.addEventListener('click', () => showModules(true)));
    document.querySelectorAll('a[href="#home"]').forEach((link) => link.addEventListener('click', () => showModules(false)));
    $('#workspace-expand').addEventListener('click', () => setExpanded($('#application').dataset.expanded !== 'true'));
    document.addEventListener('focusin', (event) => {
      if (innerWidth < 700 && currentPage !== 'home' && event.target.closest('#workspace') && event.target.matches('textarea,input[type=search],input[type=text],input[type=password],input[type=email],input[type=tel]')) setExpanded(true);
    });
    const toolbar = $('#workspace .workspace-toolbar');
    let swipe = null;
    toolbar.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch' || innerWidth >= 700 || event.target.closest('a,button')) return;
      swipe = { id: event.pointerId, y: event.clientY, route: currentPage };
      toolbar.setPointerCapture(event.pointerId);
    });
    toolbar.addEventListener('pointerup', (event) => {
      if (!swipe || swipe.id !== event.pointerId) return;
      const delta = event.clientY - swipe.y, sameRoute = swipe.route === currentPage; swipe = null;
      if (!sameRoute || !sessionActive) return;
      if (delta > 60) location.hash = '#home';
      else if (delta < -60) setExpanded(true);
    });
    toolbar.addEventListener('pointercancel', () => { swipe = null; });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]') && currentPage !== 'home' && sessionActive) location.hash = '#home';
    });
    document.addEventListener('visibilitychange', syncMotion);
    $('#sky-image')?.addEventListener('error', (event) => { event.target.hidden = true; });
    $('[data-nav="admin"]').hidden = !['owner', 'admin'].includes(actor.level);
    $('[data-nav="assistant"]').hidden = !actor.permissions.includes('assistant');
    admin = createAdmin({ api, actor, labels, onSessionError: fail });
    $('#application').hidden = false;
    ready();
    if (!window.Telegram?.WebApp) $('#telegram-sdk').addEventListener('load', ready, { once: true });
    window.addEventListener('hashchange', navigate); navigate();
    try {
      const { createCore } = await import('./core.js');
      if (!sessionActive) return;
      const items = ['assistant', 'memory', 'documents', 'devices', 'life', 'jobs'].filter((key) => actor.permissions.includes(key)).map((key) => ({ key, label: labels[key] }));
      core = createCore($('#core-stage'), { items, onSelect: openSection, onMotionChange: ({ moving }) => { sceneMoving = moving; syncMotion(); }, onStatus: (text) => { $('#core-status').textContent = text; if ($('#core-stage').dataset.render === 'fallback') showModules(true); } });
      if (!core.available) throw new Error('WEBGL_UNAVAILABLE');
      core.setWorkspace(currentPage !== 'home');
      const pause = $('#pause');
      const sync = () => { pause.textContent = core.paused ? 'Продолжить' : 'Пауза'; pause.setAttribute('aria-pressed', String(core.paused)); syncMotion(); };
      pause.addEventListener('click', () => { core.setPaused(!core.paused); sync(); });
      $('#speed').addEventListener('input', (event) => core.setSpeed(Number(event.target.value)));
      $('#reset-core').addEventListener('click', () => core.reset());
      matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', sync); sync();
      window.addEventListener('pagehide', () => core.dispose(), { once: true });
      window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
    } catch { $('#core-stage').dataset.render = 'fallback'; $('#core-status').textContent = 'СТАТИЧНЫЙ ВИД · 3D НЕДОСТУПНО'; showModules(true); $('#pause').disabled = true; document.querySelectorAll('.motion-controls button,.motion-controls input').forEach((element) => { element.disabled = true; }); document.body.dataset.motion = 'paused'; }
    finally { $('#core-loading').hidden = true; }
  } catch (error) { fail(error); }
}
start();
