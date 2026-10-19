import { createApi } from './api.js';

const api = createApi();
const statusNode = document.querySelector('#job-connect-status');
const stage = document.querySelector('#job-connect-stage');
const frame = document.querySelector('#job-connect-frame');
const input = document.querySelector('#job-connect-input');
const send = document.querySelector('#job-connect-send');
const reveal = document.querySelector('#job-connect-reveal');
const enter = document.querySelector('#job-connect-enter');
const tab = document.querySelector('#job-connect-tab');
const cancel = document.querySelector('#job-connect-cancel');
const SESSION_KEY = 'jarvis-job-guest-session';
let sessionId = null;
let sequence = 1;
let pollTimer = null;
let busy = false;
let pendingText = '';
let pendingOffset = 0;

function message(text) { statusNode.textContent = text; }
function clearPoll() { if (pollTimer) clearTimeout(pollTimer); pollTimer = null; }
function apiPath(kind) { return `/jobs/login/${kind}/${encodeURIComponent(sessionId)}`; }
function clearStoredSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch {} }

async function sendEvent(event) {
  if (busy) throw new Error('Дождись завершения предыдущего действия.');
  if (!sessionId) throw new Error('Временная ссылка истекла. Создай новую в Mini App.');
  busy = true;
  try {
    const current = sequence;
    try {
      const result = await api.request(`/jobs/login/input/${encodeURIComponent(sessionId)}`, 'POST', { sequence: current, event });
      sequence = result.nextSequence; return true;
    } catch (error) {
      try {
        const state = await api.request(apiPath('status'));
        sequence = state.nextSequence || sequence;
        if (sequence > current) return true;
      } catch {}
      throw error;
    }
  } finally { busy = false; }
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
  input.type = 'password'; reveal.textContent = 'Показать ввод'; reveal.setAttribute('aria-pressed', 'false');
}

function showLoginError(error) {
  clearPoll(); stage.hidden = true; clearStoredSession(); clearSensitiveInput(); sessionId = null;
  message(error.message || 'Сессия входа завершилась. Создай новую ссылку в Mini App.');
}

async function poll() {
  clearPoll(); if (!sessionId) return;
  try {
    const state = await api.request(apiPath('status'));
    sequence = state.nextSequence || sequence;
    if (state.state === 'authenticated' || state.status === 'authenticated') {
      clearSensitiveInput(); stage.hidden = true; message('Вход HH подтверждён. Вернись в Mini App и выбери основное резюме.'); return;
    }
    if (['expired','closed'].includes(state.state) || ['expired','cancelled','revoked','failed'].includes(state.status)) {
      showLoginError(new Error('Время входа завершилось. Создай новую ссылку в Mini App.')); return;
    }
    if (state.state === 'captcha') message('HH просит пройти дополнительную проверку на странице ниже.');
    else message('Войди в свой профиль соискателя HH в окне ниже.');
    const image = await api.request(apiPath('frame'));
    frame.src = `data:${image.mimeType};base64,${image.frameBase64}`; frame.hidden = false; stage.hidden = false;
    pollTimer = setTimeout(() => { void poll(); }, 3000);
  } catch (error) {
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
  event.preventDefault(); if (busy || !sessionId) return;
  const rect = frame.getBoundingClientRect(); if (!rect.width || !rect.height) return;
  const x = Math.max(0, Math.min(1024, (event.clientX - rect.left) * 1024 / rect.width));
  const y = Math.max(0, Math.min(768, (event.clientY - rect.top) * 768 / rect.height));
  input.focus({ preventScroll: true });
  try { await sendEvent({ type: 'pointer', action: 'click', button: 'left', x, y }); }
  catch (error) { message(error.message); }
});
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
    clearPoll(); clearStoredSession(); clearSensitiveInput(); sessionId = null; stage.hidden = true;
    message(result.status === 'connected' ? 'Профиль HH уже подключён. Вернись в Jarvis.' : 'Подключение отменено.');
  } catch (error) { message(error.message); }
  finally { cancel.disabled = false; }
});
window.addEventListener('pagehide', () => { clearPoll(); clearSensitiveInput(); }, { once: true });
void claim().catch((error) => { message(error.message || 'Не удалось открыть сессию входа. Создай новую ссылку в Mini App.'); });
