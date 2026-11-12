import { ApiError } from './shared/api.js';
import { createMemoryActions } from './shared/memoryActions.js';
import { createPersonalActions } from './shared/personalActions.js';
import { renderSectionView, renderSectionActions } from './shared/sectionViews.js';
import { createJobConnectionPanel } from './shared/jobConnection.js';

const cloud = window.jarvisCloud;
const content = document.getElementById('desktop-page-content');
const labels = { memory: 'Память', documents: 'Документы', jobs: 'Поиск работы', devices: 'Устройства',
  operations: 'Панель управления', settings: 'Настройки', vpn: 'VPN' };
let page = 'assistant';
let state = { paired: false };
let scope = '';
let generation = 0;
let currentSection = null;
let historyGeneration = 0;
let historyCursor = null;
let historyScope = '';

function node(tag, text = '', className = '') {
  const item = document.createElement(tag); item.textContent = text; item.className = className; return item;
}
function button(text, fn, style = 'secondary') {
  const item = node('button', text, style); item.type = 'button';
  item.addEventListener('click', () => { Promise.resolve(fn()).catch(() => {}); }); return item;
}
function failure(error) {
  if (error?.code === 'unauthorized') return 'Подключение истекло. Подключите Desktop заново.';
  if (error?.code === 'forbidden') return 'Доступ к разделу закрыт.';
  if (error?.code === 'unavailable') return 'Раздел пока недоступен. Проверьте подключение и версию сервера.';
  return error?.message || 'Не удалось загрузить данные. Попробуйте ещё раз.';
}
function makeApi(capturedScope) {
  const ensureScope = () => { if (capturedScope !== scope || !state.paired) throw new ApiError('unauthorized'); };
  const unwrap = (result) => {
    ensureScope();
    if (!result?.ok) {
      if (result?.pendingId) queueMicrotask(() => { if (capturedScope === scope) void navigate(page); });
      const code = typeof result?.code === 'string' ? result.code : 'unavailable';
      const error = new ApiError(code, Boolean(result?.uncertain));
      // These failures are transport states, never user content or raw exceptions.
      if (['unauthorized', 'forbidden', 'unavailable'].includes(code)) error.message = failure({ code });
      throw error;
    }
    return result;
  };
  return {
    publicOrigin: state.serverUrl,
    async request(path, method = 'GET', body) {
      ensureScope();
      if (typeof cloud?.workspaceRequest !== 'function') throw new ApiError('unavailable');
      let result;
      try { result = await cloud.workspaceRequest(path, method, body); }
      catch { throw new ApiError(method === 'GET' ? 'unavailable' : 'unknown', method !== 'GET'); }
      return unwrap(result);
    },
    async requestBinary(path, file, name, type) {
      ensureScope();
      const match = /^\/sections\/documents\/uploads\/([a-f0-9-]{36})$/i.exec(path);
      if (!match || !file || file.size < 1 || file.size > 20 * 1024 * 1024) throw new ApiError('invalid');
      const data = await file.arrayBuffer(); ensureScope();
      let result;
      try { result = await cloud.workspaceUpload({ operationId: match[1], name, type, data }); }
      catch { throw new ApiError('unknown', true); }
      return unwrap(result);
    },
  };
}
function disposeSection() {
  currentSection?.personal?.dispose(); currentSection?.jobs?.dispose();
  currentSection = null;
}
function errorView(error, retry = () => navigate(page)) {
  content.replaceChildren(node('p', failure(error), 'workspace-error'), button('Повторить', retry));
}
function fatal(error, section) {
  if (section !== currentSection) return;
  generation++; disposeSection(); errorView(error);
}
function openLink(href, errorTarget) {
  return Promise.resolve(cloud?.openWorkspaceLink?.(href)).then((result) => {
    if (!result?.ok && errorTarget?.isConnected) errorTarget.textContent = 'Не удалось открыть ссылку.';
  }).catch(() => { if (errorTarget?.isConnected) errorTarget.textContent = 'Не удалось открыть ссылку.'; });
}

function renderSection(section) {
  if (currentSection !== section) return;
  const active = () => currentSection === section && section.scope === scope;
  section.memory?.resetButtons(); section.personal?.resetButtons();
  const view = renderSectionView(section.page, section.data, {
    memoryActions: section.data.memoryActionsAvailable ? section.memory : null,
    personalActions: section.data.personalActionsAvailable ? section.personal : null,
    filterQuery: section.filter,
    onFilterChange: (value) => { if (active()) section.filter = value; },
    onRefresh: async () => {
      await readSection(section);
      if (active()) { await section.personal?.load(); renderSection(section); }
    },
    onLoadMore: (cursor) => cursor === section.data.paging?.nextCursor ? readSection(section, cursor) : Promise.resolve(),
  });
  // No permanent technical prose: action previews, errors and confirmations remain.
  view.querySelector('.section-handoff__hint')?.remove();
  content.replaceChildren(view);
}
async function readSection(section, cursor) {
  const sequence = ++section.sequence;
  let data;
  try { data = await section.api.request(`/sections/${section.page}${cursor ? `/page/${encodeURIComponent(cursor)}` : ''}`); }
  catch (error) {
    if (['unauthorized', 'forbidden'].includes(error?.code) && currentSection === section) fatal(error, section);
    throw error;
  }
  if (currentSection !== section || section.scope !== scope || sequence !== section.sequence) return;
  const items = cursor ? [...section.data.items, ...(data.items || [])] : data.items || [];
  const unique = new Map(items.map((item, index) => [item?.id || `row-${index}`, item]));
  section.data = { ...data, items: [...unique.values()] };
  renderSection(section);
}

function settingsView() {
  const status = node('p', '', 'workspace-status'); status.setAttribute('role', 'status');
  const tools = node('div', '', 'workspace-settings');
  const voiceForm = node('form', '', 'workspace-voice-settings'); voiceForm.hidden = true;
  const choices = [];
  tools.append(button('Настроить голос', async () => {
    const result = await cloud?.openVoiceSettings?.();
    if (!result?.ok) status.textContent = 'Настройки голоса недоступны.';
    else if (result.settings && tools.isConnected) {
      voiceForm.replaceChildren(); choices.length = 0;
      for (const [key, title] of [['echoCancellation', 'Подавление эха'], ['noiseSuppression', 'Подавление шума'], ['autoGainControl', 'Автоматическая громкость микрофона']]) {
        const label = node('label', '', 'workspace-check');
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = result.settings[key] === true;
        label.append(input, node('span', title)); voiceForm.append(label); choices.push({ key, input });
      }
      const save = node('button', 'Сохранить', 'primary'); save.type = 'submit';
      voiceForm.append(save, button('Отмена', () => { voiceForm.hidden = true; status.textContent = ''; }));
      voiceForm.hidden = false;
      if (result.needsRepair) status.textContent = 'Не удалось прочитать прежние настройки. Проверьте параметры и сохраните их заново.';
      if (result.enabled) status.textContent = 'Выключите голос перед сохранением настроек.';
    }
  }));
  voiceForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = Object.fromEntries(choices.map((choice) => [choice.key, choice.input.checked]));
    const result = await cloud?.saveVoiceSettings?.(input);
    if (!tools.isConnected) return;
    if (result?.ok) { voiceForm.hidden = true; status.textContent = 'Сохранено.'; }
    else status.textContent = result?.code === 'voice_active' ? 'Выключите голос перед сохранением настроек.' : 'Не удалось сохранить настройки.';
  });
  tools.append(voiceForm);
  const motion = button(document.body.dataset.scenePaused === 'true' ? 'Продолжить анимацию' : 'Приостановить анимацию', () => {
    const paused = document.body.dataset.scenePaused !== 'true';
    document.body.dataset.scenePaused = String(paused);
    window.dispatchEvent(new CustomEvent('desktop:motion', { detail: { paused } }));
    motion.textContent = paused ? 'Продолжить анимацию' : 'Приостановить анимацию';
    motion.setAttribute('aria-pressed', String(paused));
  });
  motion.setAttribute('aria-pressed', String(document.body.dataset.scenePaused === 'true'));
  tools.append(motion);
  if (state.paired) tools.append(button('VPN', () => {
    window.dispatchEvent(new CustomEvent('desktop:page', { detail: { page: 'settings' } }));
    void navigate('vpn');
  }));
  const address = node('p', state.serverUrl || state.defaultServerUrl || '', 'workspace-address');
  tools.append(address, status); content.replaceChildren(tools);
}

async function miniHistory(section) {
  let cursor = null; let busy = false;
  const root = node('section', '', 'workspace-mini-history');
  const back = button('Вернуться к Desktop', () => {
    window.dispatchEvent(new CustomEvent('desktop:page', { detail: { page: 'assistant' } }));
    void navigate('assistant');
  });
  const list = node('div', '', 'workspace-history');
  const status = node('p', '', 'workspace-status'); status.setAttribute('role', 'status');
  const more = button('Загрузить предыдущие сообщения', () => load(true)); more.hidden = true;
  root.append(back, status, more, list); content.replaceChildren(root);
  const seen = new Set();
  async function load(older = false) {
    if (busy || currentSection !== section) return;
    busy = true; more.disabled = true; status.textContent = 'Загрузка…';
    try {
      const data = await section.api.request(`/assistant/messages${older && cursor ? `/page/${encodeURIComponent(cursor)}` : ''}`);
      if (currentSection !== section) return;
      const group = document.createDocumentFragment();
      for (const message of data.messages || []) {
        if (!['user', 'assistant'].includes(message.role) || seen.has(message.id)) continue;
        seen.add(message.id);
        const article = node('article', '', `message ${message.role}`);
        article.append(node('div', message.role === 'user' ? 'Вы' : 'JARVIS', 'message-meta'), node('div', message.content, 'message-body'));
        group.append(article);
      }
      list.prepend(group); cursor = data.paging?.nextCursor || null; more.hidden = !cursor;
      status.textContent = list.childElementCount ? '' : 'Здесь пока нет сообщений.';
    } catch (error) { if (currentSection === section) status.textContent = failure(error); }
    finally { if (currentSection === section) { busy = false; more.disabled = false; } }
  }
  await load();
}

async function navigate(next) {
  page = next; const version = ++generation; disposeSection();
  if (['home', 'life'].includes(next)) return;
  if (next === 'assistant') { await loadDesktopHistory(); return; }
  if (next === 'settings') { settingsView(); return; }
  if (!content || !Object.hasOwn(labels, next)) return;
  const title = document.getElementById('desktop-page-title');
  if (title) title.textContent = labels[next];
  if (!state.paired) {
    content.replaceChildren(node('p', 'Подключите Desktop, чтобы открыть раздел.'), button('Подключить', () => {
      window.dispatchEvent(new CustomEvent('desktop:page', { detail: { page: 'assistant' } }));
      void navigate('assistant'); document.getElementById('pairing-code')?.focus();
    })); return;
  }
  const loading = node('p', 'Загрузка…', 'workspace-status'); loading.setAttribute('role', 'status'); content.replaceChildren(loading);
  const api = makeApi(scope);
  try {
    const me = await api.request('/me');
    if (version !== generation) return;
    const actor = { ...me.actor, storageScope: `${scope}|${me.actor?.userId || ''}` };
    if (!Array.isArray(actor.permissions) || !actor.permissions.includes(next)) throw new ApiError('forbidden');
    if (typeof cloud?.getWorkspacePending === 'function') {
      const snapshot = await cloud.getWorkspacePending();
      if (version !== generation) return;
      if (!snapshot?.ok) throw new ApiError('unavailable');
      for (const entry of snapshot.pending || []) {
        if (!/^[a-f0-9-]{36}$/i.test(entry?.id || '')) continue;
        if (entry.kind === 'job-login') {
          sessionStorage.setItem(`jarvis-job-login:request:${actor.storageScope}`, entry.id);
        } else if (['memory', 'personal-documents', 'personal-devices', 'personal-life', 'job-resumes'].includes(entry.kind)) {
          sessionStorage.setItem(`jarvis-pending:${entry.kind}:${actor.storageScope}`,
            JSON.stringify({ actor: actor.telegramId, kind: entry.kind, id: entry.id }));
        }
      }
    }
    const section = { page: next, api, actor, scope, sequence: 0, filter: '', data: { items: [] } };
    currentSection = section;
    const active = () => section === currentSection && section.scope === scope;
    section.data = await api.request(`/sections/${next}`);
    if (!active()) return;
    if (next === 'jobs') {
      const actions = renderSectionActions('jobs', section.data.actions);
      actions.querySelector('.section-handoff__hint')?.remove(); content.replaceChildren(actions);
      section.jobs = createJobConnectionPanel({ api, actor, anchor: actions }); return;
    }
    if (next === 'memory' && section.data.memoryActionsAvailable) section.memory = createMemoryActions({ api, actor,
      isActive: active, onChanged: () => readSection(section), onFatal: (error) => fatal(error, section) });
    if (['documents', 'devices'].includes(next) && section.data.personalActionsAvailable) {
      section.personal = createPersonalActions({ api, actor, section: next, isActive: active,
        onChanged: () => readSection(section), onFatal: (error) => fatal(error, section) });
      // Let the first describe call finish before rendering row action affordances.
      await section.personal.load();
      if (!active()) return;
    }
    renderSection(section);
  } catch (error) { if (version === generation) { disposeSection(); errorView(error); } }
}

// History is rendered by the existing chat controller; commands retain its
// recovery/confirmation logic rather than being inferred from historic text.
const historyTools = node('div', '', 'desktop-history-tools');
const historyStatus = node('p', '', 'workspace-status'); historyStatus.setAttribute('role', 'status');
const older = button('Загрузить предыдущие сообщения', () => loadDesktopHistory(true)); older.hidden = true;
const mini = button('История Mini App', async () => {
  window.dispatchEvent(new CustomEvent('desktop:page', { detail: { page: 'memory' } }));
  page = 'mini-history'; generation++; disposeSection();
  document.getElementById('desktop-page-title').textContent = 'История Mini App';
  const section = { page, api: makeApi(scope), scope }; currentSection = section;
  await miniHistory(section);
});
const historyRetry = button('Загрузить историю', () => loadDesktopHistory());
historyRetry.hidden = true;
historyTools.append(older, mini, historyRetry, historyStatus);
document.getElementById('chat-shell')?.before(historyTools);
async function loadDesktopHistory(more = false) {
  if (typeof cloud?.workspaceRequest !== 'function' || !state.paired || page !== 'assistant') return;
  if (!more && historyScope === scope) return;
  const version = ++historyGeneration; const captured = scope;
  const chatVersion = window.jarvisChatHistory?.version?.();
  older.disabled = true; historyRetry.disabled = true;
  try {
    const data = await makeApi(captured).request(`/desktop/messages${more && historyCursor ? `/page/${encodeURIComponent(historyCursor)}` : ''}`);
    if (version !== historyGeneration || captured !== scope || page !== 'assistant') return;
    const applied = window.jarvisChatHistory?.prepend?.(data.messages || [], chatVersion);
    if (applied === false) { historyRetry.hidden = false; return; }
    historyScope = scope; historyCursor = data.paging?.nextCursor || null;
    older.hidden = !historyCursor; historyStatus.textContent = ''; historyRetry.hidden = true;
  } catch (error) {
    if (version !== historyGeneration || captured !== scope || page !== 'assistant') return;
    historyStatus.textContent = failure(error); historyRetry.hidden = false;
  } finally { if (version === historyGeneration) { older.disabled = false; historyRetry.disabled = false; } }
}

function updateState(next) {
  const nextState = { ...state, ...next };
  const nextScope = `${Boolean(nextState.paired)}|${nextState.serverUrl || ''}|${nextState.deviceId || ''}`;
  state = nextState;
  if (nextScope !== scope) {
    scope = nextScope; generation++; historyGeneration++; historyScope = ''; historyCursor = null;
    older.hidden = true; historyStatus.textContent = ''; disposeSection();
    if (!['home', 'life'].includes(page)) void navigate(page);
  }
  mini.disabled = !state.paired;
}
window.addEventListener('desktop:navigate', (event) => { void navigate(event.detail?.page); });
window.addEventListener('focus', () => {
  // Do not discard an edited form or an operation awaiting reconciliation.
  if (currentSection && ['memory', 'documents', 'devices'].includes(page)
    && !content.querySelector('form:not([hidden]), [data-pending="true"], [aria-busy="true"]')) {
    const section = currentSection;
    void readSection(section).catch((error) => { if (currentSection === section) errorView(error); });
  }
});
content?.addEventListener('click', (event) => {
  const link = event.target.closest('a[href]');
  if (!link) return;
  event.preventDefault();
  const status = node('p', '', 'workspace-status'); status.setAttribute('role', 'status');
  link.after(status); void openLink(link.href, status);
});
if (cloud?.onState) cloud.onState(updateState);
if (cloud?.getState) cloud.getState().then(updateState).catch(() => {});
