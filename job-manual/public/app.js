import RFB from '/hh/novnc/core/rfb.js';
import { bindKeyboard } from '/hh/input.js';
const el = id => document.getElementById(id);
let state = null, csrf = null, rfb = null, busy = false;
const labels = { idle: 'Ручная проверка сейчас не требуется.', pending: 'Нужна ручная проверка. Сбор приостановлен.', active: 'Ручная проверка открыта. Сбор приостановлен.', checking: 'Проверяем доступ к HH…' };
function disconnect() { if (rfb) { const old = rfb; rfb = null; old.disconnect(); } el('screen').replaceChildren(); }
function render() {
  el('status').textContent = state ? labels[state.phase] : 'Нет связи. Обнови страницу, когда подключение восстановится.';
  el('start').hidden = state?.phase !== 'pending'; el('done').hidden = state?.phase !== 'active';
  el('refresh').hidden = state?.phase !== 'active';
  el('connect').hidden = state?.phase !== 'active' || !!rfb;
  el('keyboard-panel').hidden = !rfb;
  for (const id of ['start', 'done', 'connect', 'refresh']) el(id).disabled = busy;
}
async function status() {
  if (busy) return;
  try {
    const response = await fetch('/hh/api/status', { cache: 'no-store', credentials: 'same-origin' });
    const result = await response.json(); if (!result.ok) throw new Error();
    if (rfb && (result.value.phase !== 'active' || result.value.revision !== state?.revision)) disconnect();
    state = result.value; csrf = result.csrf;
  } catch { state = null; disconnect(); }
  render();
}
function connect() {
  if (!state || state.phase !== 'active' || rfb || busy) return;
  const url = new URL('/hh/transport', location.origin); url.protocol = 'wss:'; url.searchParams.set('revision', state.revision);
  const current = new RFB(el('screen'), url.href, { shared: false }); rfb = current;
  current.scaleViewport = true; current.resizeSession = false; current.clipViewport = false; current.focusOnClick = false;
  // No clipboard handlers or clipboardPasteFrom calls; file transfer is not exposed.
  current.addEventListener('disconnect', () => { if (rfb === current) { rfb = null; el('screen').replaceChildren(); render(); } });
  render();
}
async function action(name) {
  if (busy || !state || !csrf) return;
  busy = true; disconnect(); render();
  try {
    const response = await fetch(`/hh/api/${name}`, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ revision: state.revision }) });
    const result = await response.json(); if (!result.ok) throw new Error(); state = result.value;
  } catch { state = null; } finally { busy = false; await status(); }
  if (state?.phase === 'active') connect();
}
el('start').addEventListener('click', () => action('start')); el('done').addEventListener('click', () => action('finish'));
el('refresh').addEventListener('click', () => action('start'));
el('connect').addEventListener('click', connect); el('enter').addEventListener('click', () => rfb?.sendKey(0xff0d, 'Enter'));
bindKeyboard(el('keyboard'), () => rfb);
await status();
setInterval(status, 3000);
