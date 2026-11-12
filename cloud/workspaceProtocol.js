// Closed native transport. The renderer can never choose an arbitrary server URL.
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const CURSOR = '[A-Za-z0-9_%.-]{1,4096}';
const SECTIONS = '(?:memory|documents|devices|life|jobs|vpn|operations)';
const PERSONAL = '(?:documents|devices|life)';
const ACTION = '(?:delete|revoke|pair\\.cancel|reminder\\.reschedule|reminder\\.cancel|commitment\\.complete|commitment\\.dismiss|project\\.pin|project\\.hide|project\\.restore)';
const routes = [
  ['GET', '/me'],
  ['GET', `/sections/${SECTIONS}(?:/page/${CURSOR})?`],
  ['POST', '/memory/operations'], ['GET', `/memory/operations/${UUID}`],
  ['POST', `/memory/operations/${UUID}/cancel`],
  ['GET', `/sections/${PERSONAL}/actions`],
  ['GET', `/sections/${PERSONAL}/actions/${ACTION}/${UUID}`],
  ['POST', `/sections/${PERSONAL}/operations`],
  ['GET', `/sections/${PERSONAL}/operations/${UUID}`],
  ['POST', `/sections/${PERSONAL}/operations/${UUID}/cancel`],
  ['GET', '/jobs/(?:connection|resumes|automation)'],
  ['POST', '/jobs/resumes/(?:refresh|settings)'], ['POST', '/jobs/automation'],
  ['GET', `/jobs/resumes/operations/${UUID}(?:/inspection)?`],
  ['POST', `/jobs/resumes/operations/${UUID}/confirm-inspection`],
  ['POST', '/jobs/login'], ['POST', '/jobs/login/(?:confirm|cancel)'],
  ['GET', `/jobs/login/owned/status/${UUID}`],
  ['GET', `/(?:assistant|desktop)/messages(?:/page/${CURSOR})?`],
].map(([method, pattern]) => ({ method, pattern: new RegExp(`^(?:${pattern})$`, 'i') }));

function invalid() { return Object.assign(new Error('Invalid workspace request'), { code: 'invalid_request' }); }
function requestInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((k) => !['path', 'method', 'body'].includes(k))) throw invalid();
  const method = input.method === undefined ? 'GET' : input.method;
  if (typeof input.path !== 'string' || !['GET', 'POST'].includes(method)
    || !routes.some((route) => route.method === method && route.pattern.test(input.path))) throw invalid();
  // Encoded routing separators and traversal are never a cursor or an action ID.
  let decoded;
  try { decoded = decodeURIComponent(input.path); } catch { throw invalid(); }
  if (/[?#\\\x00-\x1f]/.test(decoded) || decoded.includes('..')
    || decoded.split('/').length !== input.path.split('/').length) throw invalid();
  if (method === 'GET' && input.body !== undefined) throw invalid();
  let body;
  if (input.body !== undefined) {
    if (!input.body || typeof input.body !== 'object' || Array.isArray(input.body)) throw invalid();
    try { body = JSON.stringify(input.body); } catch { throw invalid(); }
    if (Buffer.byteLength(body, 'utf8') > 64 * 1024) throw invalid();
  }
  return { path: input.path, method, body };
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
function uploadInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((k) => !['operationId', 'name', 'type', 'data'].includes(k))
    || !new RegExp(`^${UUID}$`, 'i').test(input.operationId || '')
    || typeof input.name !== 'string' || input.name.length < 1 || input.name.length > 255
    || /[\\/\x00-\x1f]/.test(input.name)
    || !['application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(input.type)) throw invalid();
  const raw = input.data;
  if (!(raw instanceof ArrayBuffer) && !ArrayBuffer.isView(raw)) throw invalid();
  if (raw.byteLength < 1 || raw.byteLength > MAX_UPLOAD_BYTES) throw invalid();
  const data = raw instanceof ArrayBuffer ? Buffer.from(raw) : Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  return { operationId: input.operationId, name: input.name, type: input.type, data };
}

function externalUrl(href, serverUrl, telegramLinks = []) {
  if (typeof href !== 'string' || href.length > 2048) throw invalid();
  let url, server;
  try { url = new URL(href); server = new URL(serverUrl); } catch { throw invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password) throw invalid();
  const botLink = url.origin === 'https://t.me' && /^\/[A-Za-z][A-Za-z0-9_]{4,31}$/.test(url.pathname)
    && !url.hash && [...url.searchParams].length === 1
    && /^(?:mini_(?:memory|documents|devices|life|jobs|vpn|operations)|start)$/.test(url.searchParams.get('start') || '')
    && telegramLinks.includes(url.href);
  const ownLink = url.origin === server.origin && !url.search && (
    (url.pathname === '/ops/' && !url.hash)
    || (url.pathname === '/mini/job-connect/' && /^#ticket=[a-f0-9]{64}$/i.test(url.hash)));
  if (!botLink && !ownLink) throw invalid();
  return url.href;
}
module.exports = { requestInput, uploadInput, externalUrl, MAX_UPLOAD_BYTES };
