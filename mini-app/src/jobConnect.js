import { createApi } from './api.js';

const api = createApi();
const statusNode = document.querySelector('#job-connect-status');
const stage = document.querySelector('#job-connect-stage');
const frame = document.querySelector('#job-connect-frame');
const direct = document.querySelector('#job-connect-direct');
const input = document.querySelector('#job-connect-input');
const send = document.querySelector('#job-connect-send');
const reveal = document.querySelector('#job-connect-reveal');
const enter = document.querySelector('#job-connect-enter');
const tab = document.querySelector('#job-connect-tab');
const cancel = document.querySelector('#job-connect-cancel');
const SESSION_KEY = 'jarvis-job-guest-session';
const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ru', { granularity: 'grapheme' }) : null;
const characters = (value) => graphemes ? Array.from(graphemes.segment(value), (item) => item.segment) : Array.from(value);
let sessionId = null;
let sequence = 1;
let pollTimer = null;
let pendingText = '';
let pendingOffset = 0;
let inputFields = [];
let directValue = '';
let remoteCursor = 0;
let composing = false;
let blocked = false;
let queue = Promise.resolve();
let queueDepth = 0;
let generation = 0;

function message(text) { statusNode.textContent = text; }
function clearPoll() { if (pollTimer) clearTimeout(pollTimer); pollTimer = null; }
function apiPath(kind) { return `/jobs/login/${kind}/${encodeURIComponent(sessionId)}`; }
function clearStoredSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch {} }

async function deliver(event) {
  if (blocked) throw new Error('Не удалось подтвердить ввод. Отмени подключение и начни заново; ввод повторно не отправлен.');
  if (!sessionId) throw new Error('Временная ссылка истекла. Создай новую в Mini App.');
  const current = sequence;
  try {
    const result = await api.request(`/jobs/login/input/${encodeURIComponent(sessionId)}`, 'POST', { sequence: current, event });
    sequence = result.nextSequence; return true;
  } catch (error) {
    try {
      const state = await api.request(apiPath('status'));
      if (state.nextSequence > current) { sequence = state.nextSequence; return true; }
    } catch {}
    blocked = true;
    clearDirect();
    throw error;
  }
}
function sendEvent(event) {
  const currentGeneration = generation;
  queueDepth++;
  const task = queue.then(() => {
    if (currentGeneration !== generation) throw new Error('Окно входа закрыто.');
    return deliver(event);
  });
  queue = task.catch(() => {}).finally(() => { queueDepth--; });
  return task;
}
function clearDirect() {
  directValue = ''; remoteCursor = 0; composing = false;
  direct.value = ''; direct.hidden = true; direct.blur();
}
function queueDirectChange() {
  if (composing || direct.hidden || blocked) return;
  if (direct.value.length > 256) {
    direct.value = directValue; message('Ввод ограничен 256 символами.'); return;
  }
  const oldValue = characters(directValue), nextValue = characters(direct.value);
  if (directValue === direct.value) return;
  let prefix = 0;
  while (prefix < oldValue.length && prefix < nextValue.length && oldValue[prefix] === nextValue[prefix]) prefix++;
  let suffix = 0;
  while (suffix < oldValue.length - prefix && suffix < nextValue.length - prefix
    && oldValue[oldValue.length - 1 - suffix] === nextValue[nextValue.length - 1 - suffix]) suffix++;
  const removed = oldValue.length - prefix - suffix;
  const inserted = nextValue.slice(prefix, nextValue.length - suffix);
  directValue = direct.value;
  const actions = [];
  const move = (key, count) => { for (let i = 0; i < count; i++) actions.push({ type: 'key', action: 'press', key }); };
  move(remoteCursor > prefix + removed ? 'ArrowLeft' : 'ArrowRight', Math.abs(remoteCursor - prefix - removed));
  move('Backspace', removed);
  const units = Array.from(inserted.join(''));
  for (let offset = 0; offset < units.length;) {
    let end = offset, length = 0;
    while (end < units.length && length + units[end].length <= 64) { length += units[end].length; end++; }
    actions.push({ type: 'text', value: units.slice(offset, end).join('') });
    offset = end;
  }
  remoteCursor = prefix + inserted.length;
  const tasks = actions.map(sendEvent);
  void Promise.all(tasks).then(() => message('Ввод передан в выбранное поле HH.'))
    .catch((error) => { blocked = true; message(error.message); });
}
function placeDirect(field, rect) {
  direct.style.left = `${field.x / 1024 * rect.width}px`;
  direct.style.top = `${field.y / 768 * rect.height}px`;
  direct.style.width = `${Math.max(44, field.width / 1024 * rect.width)}px`;
  direct.style.height = `${Math.max(36, field.height / 768 * rect.height)}px`;
  direct.type = ['password', 'email', 'tel', 'number', 'search', 'url'].includes(field.type) ? field.type : 'text';
  direct.inputMode = field.inputMode;
  direct.hidden = false;
  direct.focus({ preventScroll: true });
}

async function sendText() {
  if (!input.value && pendingOffset === 0) return;
  if (!pendingText) { pendingText = input.value; pendingOffset = 0; }
  const units = Array.from(pendingText);
  send.disabled = true; input.disabled = true;
  try {
    while (pendingOffset < units.length) {
      let end = pendingOffset, length = 0;
      while (end < units.length && length + units[end].length <= 64) { length += units[end].length; end++; }
      const chunk = units.slice(pendingOffset, end).join('');
      await sendEvent({ type: 'text', value: chunk });
      pendingOffset = end;
    }
    clearSensitiveInput(); input.disabled = false; input.focus();
    message('Текст введён в активное поле HH.');
  } finally { send.disabled = false; }
}

function clearSensitiveInput() {
  input.value = ''; pendingText = ''; pendingOffset = 0;
  clearDirect();
  input.type = 'password'; reveal.textContent = 'Показать ввод'; reveal.setAttribute('aria-pressed', 'false');
}

function showLoginError(error) {
  generation++;
  clearPoll(); stage.hidden = true; clearStoredSession(); clearSensitiveInput(); sessionId = null;
  message(error.message || 'Сессия входа завершилась. Создай новую ссылку в Mini App.');
}

async function poll() {
  clearPoll(); if (!sessionId) return;
  const pollGeneration = generation;
  try {
    const state = await api.request(apiPath('status'));
    if (pollGeneration !== generation || !sessionId) return;
    if (queueDepth === 0) sequence = Math.max(sequence, state.nextSequence || sequence);
    if (state.state === 'authenticated' || state.status === 'authenticated') {
      generation++; sessionId = null;
      clearSensitiveInput(); stage.hidden = true; message('Вход HH подтверждён. Вернись в Mini App и выбери основное резюме.'); return;
    }
    if (['expired','closed'].includes(state.state) || ['expired','cancelled','revoked','failed'].includes(state.status)) {
      showLoginError(new Error('Время входа завершилось. Создай новую ссылку в Mini App.')); return;
    }
    if (blocked) message('Не удалось подтвердить ввод. Отмени подключение и начни заново; ввод повторно не отправлен.');
    else if (state.state === 'captcha') message('HH просит пройти дополнительную проверку на странице ниже.');
    else message('Войди в свой профиль соискателя HH в окне ниже.');
    const image = await api.request(apiPath('frame'));
    if (pollGeneration !== generation || !sessionId) return;
    frame.src = `data:${image.mimeType};base64,${image.frameBase64}`; frame.hidden = false; stage.hidden = false;
    inputFields = Array.isArray(image.inputFields) ? image.inputFields : [];
    pollTimer = setTimeout(() => { void poll(); }, 3000);
  } catch (error) {
    if (pollGeneration !== generation || !sessionId) return;
    if (['unauthorized','forbidden','JOB_ACCESS_REVOKED','JOB_LOGIN_SESSION_INVALID','JOB_LOGIN_SESSION_EXPIRED','JOB_LOGIN_TICKET_INVALID'].includes(error.code)) {
      showLoginError(error); return;
    }
    message(error.message || 'Не удалось обновить страницу HH. Повторяем…');
    pollTimer = setTimeout(() => { void poll(); }, 3000);
  }
}

async function claim() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const ticket = fragment.get('ticket');
  if (ticket) {
    if (!/^[a-f\d]{64}$/i.test(ticket)) throw new Error('Ссылка входа недействительна. Создай новую в Mini App.');
    let result;
    try { result = await api.request('/jobs/login/claim', 'POST', { ticket }); }
    catch (error) {
      if (!error.uncertain) throw error;
      result = await api.request('/jobs/login/claim', 'POST', { ticket });
    }
    sessionId = result.sessionId;
    try { sessionStorage.setItem(SESSION_KEY, sessionId); } catch {}
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    message('Ссылка принята. Открываем страницу HH…'); await poll(); return;
  }
  let stored;
  try { stored = sessionStorage.getItem(SESSION_KEY); } catch {}
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(stored || '')) throw new Error('Открой временную ссылку или создай новую в Jarvis Mini App.');
  sessionId = stored; await poll();
}

frame.addEventListener('pointerdown', async (event) => {
  event.preventDefault(); if (blocked || !sessionId) return;
  const rect = frame.getBoundingClientRect(); if (!rect.width || !rect.height) return;
  const x = Math.max(0, Math.min(1024, (event.clientX - rect.left) * 1024 / rect.width));
  const y = Math.max(0, Math.min(768, (event.clientY - rect.top) * 768 / rect.height));
  const field = inputFields.find((item) => x >= item.x && y >= item.y
    && x <= item.x + item.width && y <= item.y + item.height);
  clearDirect();
  if (field) placeDirect(field, rect);
  try { await sendEvent({ type: 'pointer', action: 'click', button: 'left', x, y }); }
  catch (error) { message(error.message); }
});
direct.addEventListener('pointerdown', (event) => event.stopPropagation());
direct.addEventListener('input', queueDirectChange);
direct.addEventListener('compositionstart', () => { composing = true; });
direct.addEventListener('compositionend', () => { composing = false; queueDirectChange(); });
direct.addEventListener('keydown', (event) => {
  if (composing || !['Enter', 'Tab'].includes(event.key)) return;
  event.preventDefault();
  void sendEvent({ type: 'key', action: 'press', key: event.key }).catch((error) => message(error.message));
  clearDirect();
});
direct.addEventListener('beforeinput', (event) => {
  if (event.inputType !== 'deleteContentBackward' || direct.value || composing) return;
  event.preventDefault();
  void sendEvent({ type: 'key', action: 'press', key: 'Backspace' }).catch((error) => message(error.message));
});
input.addEventListener('focus', clearDirect);
frame.addEventListener('wheel', async (event) => {
  event.preventDefault(); if (!sessionId) return;
  const rect = frame.getBoundingClientRect(); if (!rect.width || !rect.height) return;
  try { await sendEvent({ type: 'wheel', x: (event.clientX - rect.left) * 1024 / rect.width,
    y: (event.clientY - rect.top) * 768 / rect.height, deltaX: event.deltaX, deltaY: event.deltaY }); }
  catch (error) { message(error.message); }
}, { passive: false });
send.addEventListener('click', () => { void sendText().catch((error) => message(error.message)); });
reveal.addEventListener('click', () => {
  const visible = input.type !== 'text';
  input.type = visible ? 'text' : 'password';
  reveal.textContent = visible ? 'Скрыть ввод' : 'Показать ввод';
  reveal.setAttribute('aria-pressed', String(visible));
  input.focus({ preventScroll: true });
});
input.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault(); void sendText().catch((error) => message(error.message));
});
enter.addEventListener('click', () => { void sendEvent({ type: 'key', action: 'press', key: 'Enter' }).catch((error) => message(error.message)); });
tab.addEventListener('click', () => { void sendEvent({ type: 'key', action: 'press', key: 'Tab' }).catch((error) => message(error.message)); });
cancel.addEventListener('click', async () => {
  if (!sessionId) return;
  cancel.disabled = true;
  try {
    const result = await api.request('/jobs/login/guest/cancel', 'POST', { sessionId });
    generation++; clearPoll(); clearStoredSession(); clearSensitiveInput(); sessionId = null; stage.hidden = true;
    message(result.status === 'connected' ? 'Профиль HH уже подключён. Вернись в Jarvis.' : 'Подключение отменено.');
  } catch (error) { message(error.message); }
  finally { cancel.disabled = false; }
});
window.addEventListener('pagehide', () => { generation++; sessionId = null; clearPoll(); clearSensitiveInput(); }, { once: true });
void claim().catch((error) => { message(error.message || 'Не удалось открыть сессию входа. Создай новую ссылку в Mini App.'); });
