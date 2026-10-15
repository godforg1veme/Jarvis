const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
function validRequest(value, ownerId) {
  if (!exact(value, ['userId', 'operation', 'args']) || !UUID.test(value.userId) || value.userId !== ownerId) return false;
  const args = value.args;
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
const SAFE_CODES = new Set(['JOB_HH_DOM_CHANGED', 'JOB_COLLECTION_WINDOW_SATURATED', 'JOB_COLLECTION_WINDOW_EXPIRED',
  'JOB_INVALID_SEARCH', 'JOB_INVALID_VACANCY', 'JOB_HH_CAPTCHA_REQUIRED', 'JOB_HH_RATE_LIMIT', 'JOB_HH_ACCESS_DENIED',
  'JOB_HH_LOGIN_REQUIRED', 'JOB_HH_NOT_FOUND', 'JOB_HH_UNAVAILABLE', 'JOB_HH_RESUME_UNAVAILABLE']);
module.exports = { UUID, validRequest, SAFE_CODES };
