const messages = {
  unauthorized: 'Сессия истекла. Открой Mini App заново в Telegram.',
  forbidden: 'Доступ закрыт. Права могли измениться.',
  conflict: 'Данные изменились. Обнови список и проверь сохранённый черновик.',
  unavailable: 'Сервер временно недоступен. Черновик сохранён в этой вкладке.',
  unknown: 'Результат пока неизвестен. Проверь исходную операцию.',
  rate_limited: 'Слишком много запросов. Подожди минуту и попробуй снова.',
  JOB_ACCESS_REVOKED: 'Доступ к поиску работы изменился. Обратись к администратору.',
  JOB_LOGIN_SESSION_INVALID: 'Ссылка или сессия входа недействительна. Создай новую ссылку в Mini App.',
  JOB_LOGIN_SESSION_EXPIRED: 'Время входа истекло. Создай новую ссылку в Mini App.',
  JOB_LOGIN_TICKET_INVALID: 'Ссылка истекла или уже заменена. Создай новую в Mini App.',
  JOB_LOGIN_RESUME_INVALID: 'HH не подтвердил выбранное резюме. Обнови страницу входа и попробуй снова.',
  JOB_LOGIN_UNAVAILABLE: 'Личный вход HH пока не настроен на сервере.',
  JOB_BROWSER_BUSY: 'Сейчас браузер занят. Подожди немного и попробуй снова.',
  JOB_RESUME_UNAVAILABLE: 'Управление резюме временно не настроено.',
  JOB_RESUME_RAISE_UNAVAILABLE: 'Автоподнятие пока не настроено на сервере. Выбор резюме доступен.',
  JOB_HH_NOT_CONNECTED: 'Сначала подключи свой профиль HH.',
};
const jobLoginCodes = new Set(['JOB_ACCESS_REVOKED','JOB_LOGIN_SESSION_INVALID','JOB_LOGIN_SESSION_EXPIRED',
  'JOB_LOGIN_TICKET_INVALID','JOB_LOGIN_RESUME_INVALID','JOB_LOGIN_UNAVAILABLE','JOB_LOGIN_ALREADY_ACTIVE','JOB_BROWSER_BUSY',
  'JOB_RESUME_UNAVAILABLE','JOB_RESUME_RAISE_UNAVAILABLE','JOB_HH_NOT_CONNECTED']);
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
      const code = jobLoginCodes.has(data.code) ? data.code
        : response.status === 401 || data.code === 'expired_login' ? 'unauthorized'
        : response.status === 403 ? 'forbidden' : response.status === 429 ? 'rate_limited'
          : response.status === 409 ? 'conflict' : response.status >= 500 ? (method === 'GET' ? 'unavailable' : 'unknown') : 'invalid';
      throw new ApiError(code, code === 'unknown');
    }
    if (data.csrfToken) csrf = data.csrfToken;
    return data;
  }
  async function requestBinary(path, file, name, type) {
    let response;
    try {
      response = await fetch(`/mini/api${path}`, { method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Jarvis-CSRF': csrf,
          'x-jarvis-file-name': encodeURIComponent(name), 'x-jarvis-file-type': type },
        body: file, signal: AbortSignal.timeout(15000) });
    } catch { throw new ApiError('unknown', true); }
    let data;
    try { data = await response.json(); } catch { throw new ApiError('unknown', true); }
    if (!data || typeof data !== 'object') throw new ApiError('unknown', true);
    if (!response.ok) {
      const code = response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden'
        : response.status === 409 ? 'conflict' : response.status === 429 ? 'rate_limited'
          : response.status >= 500 ? 'unknown' : 'invalid';
      throw new ApiError(code, code === 'unknown');
    }
    if (data.ok !== true) throw new ApiError('unknown', true);
    return data;
  }
  return { request, requestBinary, clear() { csrf = ''; } };
}
