const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
function validEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  if (event.type === 'pointer') return exact(event, ['type','action','button','x','y'])
    && ['move','down','up','click'].includes(event.action) && ['left','middle','right'].includes(event.button)
    && Number.isFinite(event.x) && event.x >= 0 && event.x <= 1024
    && Number.isFinite(event.y) && event.y >= 0 && event.y <= 768;
  if (event.type === 'wheel') return exact(event, ['type','x','y','deltaX','deltaY'])
    && Number.isFinite(event.x) && event.x >= 0 && event.x <= 1024
    && Number.isFinite(event.y) && event.y >= 0 && event.y <= 768
    && Number.isFinite(event.deltaX) && Math.abs(event.deltaX) <= 1000
    && Number.isFinite(event.deltaY) && Math.abs(event.deltaY) <= 1000;
  if (event.type === 'key') return exact(event, ['type','action','key'])
    && ['press','down','up'].includes(event.action) && typeof event.key === 'string' && event.key.length >= 1 && event.key.length <= 24
    && /^[A-Za-z0-9_+\-]+$/.test(event.key)
    && ['Enter','Tab','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Shift','Control','Alt','Meta',
      '0','1','2','3','4','5','6','7','8','9'].includes(event.key);
  return event.type === 'text' && exact(event, ['type','value']) && typeof event.value === 'string'
    && event.value.length > 0 && event.value.length <= 64 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(event.value);
}

function validRequest(value, ownerId = null) {
  if (!exact(value, ['userId', 'operation', 'args']) || !UUID.test(value.userId)
    || (ownerId && value.userId !== ownerId)) return false;
  const args = value.args;
  if (['raise_resume','raise_resume_status'].includes(value.operation)) return exact(args, ['operationId','resumeId']) && UUID.test(args.operationId || '')
    && typeof args.resumeId === 'string' && /^[a-zA-Z0-9]{1,100}$/.test(args.resumeId);
  if (value.operation === 'login_start' || value.operation === 'login_frame' || value.operation === 'login_status')
    return exact(args, ['sessionId']) && UUID.test(args.sessionId || '');
  if (value.operation === 'login_input') return exact(args, ['sessionId','sequence','event'])
    && UUID.test(args.sessionId || '') && Number.isSafeInteger(args.sequence) && args.sequence >= 1 && args.sequence <= 1000000000
    && validEvent(args.event);
  if (value.operation === 'login_close') return exact(args, ['sessionId','preserveProfile','complete'])
    && UUID.test(args.sessionId || '') && typeof args.preserveProfile === 'boolean' && typeof args.complete === 'boolean'
    && !(args.complete && !args.preserveProfile);
  if (value.operation === 'login_discard') return exact(args, ['sessionId']) && UUID.test(args.sessionId || '');
  if (value.operation === 'select_resume' || value.operation === 'resume_content') return exact(args, ['resumeId'])
    && typeof args.resumeId === 'string' && /^[a-zA-Z0-9]{1,100}$/.test(args.resumeId);
  if (value.operation === 'history') return exact(args, ['section','page']) && ['active','archived'].includes(args.section)
    && Number.isInteger(args.page) && args.page >= 0 && args.page < 1000;
  if (['submit', 'reconcile'].includes(value.operation)) return exact(args, ['operationId', 'externalId', 'resumeId', 'letter'])
    && UUID.test(args.operationId || '') && typeof args.externalId === 'string' && /^\d{1,20}$/.test(args.externalId)
    && typeof args.resumeId === 'string' && /^[a-zA-Z0-9]{1,100}$/.test(args.resumeId)
    && typeof args.letter === 'string' && args.letter.trim().length > 0 && args.letter.length <= 10000;
  if (['resumes', 'connection'].includes(value.operation)) return exact(args, []);
  if (value.operation === 'inspect') return exact(args, ['externalId', 'resumeId'])
    && typeof args.externalId === 'string' && /^\d{1,20}$/.test(args.externalId)
    && typeof args.resumeId === 'string' && /^[a-zA-Z0-9]{1,100}$/.test(args.resumeId);
  if (value.operation === 'vacancy') return exact(args, ['externalId']) && typeof args.externalId === 'string' && /^\d{1,20}$/.test(args.externalId);
  if (value.operation !== 'search' || !exact(args, ['query', 'publishedFrom', 'publishedTo', 'page'])) return false;
  const date = (input) => typeof input === 'string' && input.length <= 40 && /^\d{4}-\d\d-\d\dT/.test(input) && Number.isFinite(Date.parse(input));
  return typeof args.query === 'string' && args.query.trim().length > 0 && args.query.length <= 200
    && date(args.publishedFrom) && date(args.publishedTo) && Date.parse(args.publishedFrom) <= Date.parse(args.publishedTo)
    && Number.isInteger(args.page) && args.page >= 0 && args.page < 1000;
}
const SAFE_CODES = new Set(['JOB_HH_MANUAL_ACTIVE', 'JOB_HH_CAPTCHA_WAITING', 'JOB_HH_CAPTCHA_MANUAL_REQUIRED', 'JOB_HH_DOM_CHANGED', 'JOB_COLLECTION_WINDOW_SATURATED', 'JOB_COLLECTION_WINDOW_EXPIRED',
  'JOB_INVALID_SEARCH', 'JOB_INVALID_VACANCY', 'JOB_HH_CAPTCHA_REQUIRED', 'JOB_HH_RATE_LIMIT', 'JOB_HH_ACCESS_DENIED',
  'JOB_HH_LOGIN_REQUIRED', 'JOB_HH_NOT_FOUND', 'JOB_HH_UNAVAILABLE', 'JOB_HH_RESUME_UNAVAILABLE',
  'JOB_BROWSER_ACCESS_DENIED', 'JOB_BROWSER_BUSY', 'JOB_BROWSER_INVALID_REQUEST', 'JOB_BROWSER_RESPONSE_TOO_LARGE',
  'JOB_LOGIN_SESSION_INVALID', 'JOB_LOGIN_TICKET_INVALID', 'JOB_HH_DOM_CHANGED']);
module.exports = { UUID, validRequest, validEvent, SAFE_CODES };
