const { jobError } = require('./jobSchemas');

async function readBoundedJson(response, maxBytes = 1024 * 1024) {
  if (Number(response.headers.get('content-length') || 0) > maxBytes) {
    await response.body?.cancel(); throw jobError('JOB_RESPONSE_TOO_LARGE');
  }
  if (!response.body) throw jobError('JOB_INVALID_RESPONSE');
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw jobError('JOB_RESPONSE_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks, total).toString('utf8')); }
    catch { throw jobError('JOB_INVALID_RESPONSE'); }
  } finally { reader.releaseLock(); }
}

function safeTestBase(value, defaultValue, allowTestHttp) {
  const url = new URL(value || defaultValue);
  if (url.username || url.password || url.search || url.hash
    || (url.href !== defaultValue && !(allowTestHttp === true && url.protocol === 'http:' && url.hostname === '127.0.0.1'))) {
    throw jobError('JOB_INVALID_API_ORIGIN');
  }
  return url.href.replace(/\/$/, '');
}

module.exports = { readBoundedJson, safeTestBase };
