const messages = {
  unauthorized: 'Сессия истекла. Открой Mini App заново в Telegram.',
  forbidden: 'Доступ закрыт. Права могли измениться.',
  conflict: 'Данные изменились. Обнови список и проверь сохранённый черновик.',
  unavailable: 'Сервер временно недоступен. Черновик сохранён в этой вкладке.',
  unknown: 'Результат пока неизвестен. Проверь исходную операцию.',
  rate_limited: 'Слишком много запросов. Подожди минуту и попробуй снова.',
};
export class ApiError extends Error {
  constructor(code, uncertain = false) { super(messages[code] || 'Не удалось выполнить запрос. Проверь данные и повтори.'); this.code = code; this.uncertain = uncertain; }
}
function pendingKey(actor, kind) { return `jarvis-pending:${kind}:${actor.telegramId}`; }
export function readPending(actor, kind) {
  try {
    const value = JSON.parse(sessionStorage.getItem(pendingKey(actor, kind)) || 'null');
    return value?.actor === actor.telegramId && value?.kind === kind && /^[a-f0-9-]{36}$/.test(value.id) ? value.id : null;
  } catch { return null; }
}
export function savePending(actor, kind, id) {
  try { sessionStorage.setItem(pendingKey(actor, kind), JSON.stringify({ actor: actor.telegramId, kind, id })); }
  catch { throw new ApiError('unavailable'); }
}
export function clearPending(actor, kind, id) {
  if (readPending(actor, kind) === id) sessionStorage.removeItem(pendingKey(actor, kind));
}
export function createApi() {
  let csrf = '';
  async function request(path, method = 'GET', body) {
    let response;
    try { response = await fetch(`/mini/api${path}`, { method, credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' && path !== '/session' ? { 'X-Jarvis-CSRF': csrf } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) }); }
    catch { throw new ApiError(method === 'GET' ? 'unavailable' : 'unknown', method !== 'GET'); }
    let data;
    try { data = await response.json(); } catch { throw new ApiError(method === 'GET' ? 'unavailable' : 'unknown', method !== 'GET'); }
    if (!data || typeof data !== 'object') throw new ApiError(method === 'GET' ? 'unavailable' : 'unknown', method !== 'GET');
    if (response.ok && data.ok !== true) throw new ApiError(method === 'GET' ? 'unavailable' : 'unknown', method !== 'GET');
    if (!response.ok) {
      const code = response.status === 401 || data.code === 'expired_login' ? 'unauthorized' : response.status === 403 ? 'forbidden' : response.status === 429 ? 'rate_limited' : response.status === 409 ? 'conflict' : response.status >= 500 ? (method === 'GET' ? 'unavailable' : 'unknown') : 'invalid';
      throw new ApiError(code, code === 'unknown');
    }
    if (data.csrfToken) csrf = data.csrfToken;
    return data;
  }
  return { request, clear() { csrf = ''; } };
}
