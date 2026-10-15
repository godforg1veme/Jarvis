const http = require('node:http');
const { createHash, timingSafeEqual } = require('node:crypto');
const { UUID, validRequest, SAFE_CODES } = require('./rpcProtocol');

function createRpcServer({ browser, ownerId, token }) {
  if (!UUID.test(ownerId || '') || typeof token !== 'string' || token.length < 32 || token.length > 256
    || !/^[\x21-\x7e]+$/.test(token)) throw new Error('JOB_BROWSER_CONFIG_INVALID');
  const digest = (value) => createHash('sha256').update(value).digest();
  const expected = digest(`Bearer ${token}`);
  let active = 0;
  const respond = (res, status, value) => {
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > 1024 * 1024) return respond(res, 502, { ok: false, code: 'JOB_BROWSER_RESPONSE_TOO_LARGE' });
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(body);
  };
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000 }, async (req, res) => {
    const auth = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    if (!timingSafeEqual(expected, digest(auth))) { respond(res, 401, { ok: false, code: 'JOB_BROWSER_ACCESS_DENIED' }); req.resume(); return; }
    if (req.method === 'GET' && req.url === '/health') { respond(res, 200, { ok: true }); return; }
    if (req.method !== 'POST' || req.url !== '/rpc' || req.headers['content-type'] !== 'application/json') {
      respond(res, 400, { ok: false, code: 'JOB_BROWSER_INVALID_REQUEST' }); req.resume(); return;
    }
    if (active >= 4) { respond(res, 503, { ok: false, code: 'JOB_BROWSER_BUSY' }); req.resume(); return; }
    active++;
    try {
      const chunks = []; let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 8192) { respond(res, 413, { ok: false, code: 'JOB_BROWSER_REQUEST_TOO_LARGE' }); req.resume(); return; }
        chunks.push(chunk);
      }
      let input; try { input = JSON.parse(Buffer.concat(chunks, length).toString('utf8')); } catch {
        respond(res, 400, { ok: false, code: 'JOB_BROWSER_INVALID_REQUEST' }); return;
      }
      if (!validRequest(input, ownerId)) { respond(res, 403, { ok: false, code: 'JOB_BROWSER_ACCESS_DENIED' }); return; }
      const value = input.operation === 'search' ? await browser.search(input.args)
        : input.operation === 'vacancy' ? await browser.getVacancy(input.args)
          : input.operation === 'inspect' ? await browser.inspect(input.args) : await browser.listResumes();
      respond(res, 200, { ok: true, value });
    } catch (error) {
      if (!res.writableEnded) respond(res, 502, { ok: false, code: SAFE_CODES.has(error.code) ? error.code : 'JOB_HH_UNAVAILABLE' });
    } finally { active--; }
  });
  server.maxConnections = 16;
  return server;
}
module.exports = { createRpcServer };
