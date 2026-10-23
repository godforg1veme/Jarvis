const http = require('node:http');
const { createHash, timingSafeEqual } = require('node:crypto');
const { UUID } = require('./rpcProtocol');
const { parseClosedJson, validCaptchaRequest } = require('./captchaTelegramProtocol');
const { preparationCode } = require('./captchaPreparation');
function createCaptchaBroker({ profiles = null, controller = null, coordinator = null, ownerId, token, run = (_userId, fn) => fn(),
  report = code => process.stderr.write(`${code}\n`) }) {
  if (!UUID.test(ownerId || '') || !/^[\x21-\x7e]{32,256}$/.test(token || '')) throw new Error('JOB_CAPTCHA_CONFIG_INVALID');
  const digest = value => createHash('sha256').update(value).digest(), expected = digest(`Bearer ${token}`);
  let active = 0;
  const reply = (res, status, value) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(value));
  };
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000 }, async (req, res) => {
    const seen = new Set(); let duplicate = false;
    for (let i = 0; i < req.rawHeaders.length; i += 2) { const name = req.rawHeaders[i].toLowerCase(); if (seen.has(name)) duplicate = true; seen.add(name); }
    const credential = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    if (duplicate || req.headers['x-jarvis-owner-id'] !== ownerId || !timingSafeEqual(expected, digest(credential))) {
      req.resume(); return reply(res, 403, { ok: false, code: 'JOB_CAPTCHA_ACCESS_DENIED' });
    }
    if (req.method !== 'POST' || req.url !== '/rpc' || req.headers['content-type'] !== 'application/json'
      || req.headers['content-encoding'] || Number(req.headers['content-length'] || 0) > 8192) {
      req.resume(); return reply(res, 400, { ok: false, code: 'JOB_CAPTCHA_INVALID_REQUEST' });
    }
    if (active >= 2) { req.resume(); return reply(res, 429, { ok: false, code: 'JOB_CAPTCHA_BUSY' }); }
    active++;
    let operation;
    try {
      let length = 0; const chunks = [];
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 8192) { req.resume(); return reply(res, 413, { ok: false, code: 'JOB_CAPTCHA_INVALID_REQUEST' }); }
        chunks.push(chunk);
      }
      let input; try { input = parseClosedJson(Buffer.concat(chunks).toString('utf8')); } catch { return reply(res, 400, { ok: false, code: 'JOB_CAPTCHA_INVALID_REQUEST' }); }
      if (!validCaptchaRequest(input)) return reply(res, 400, { ok: false, code: 'JOB_CAPTCHA_INVALID_REQUEST' });
      operation = input.operation;
      const runtime = profiles ? await profiles.forUser(input.userId)
        : input.userId === ownerId && controller && coordinator ? { manualPage: controller, manual: coordinator } : null;
      if (!runtime.manual || !runtime.manualPage) throw Object.assign(new Error('JOB_CAPTCHA_UNAVAILABLE'), { code: 'JOB_CAPTCHA_UNAVAILABLE' });
      const value = input.operation === 'status' ? runtime.manual.status()
        : await run(input.userId, () => input.operation === 'challenge'
          ? runtime.manualPage.challenge(input.args.refresh) : runtime.manualPage.answer(input.args));
      reply(res, 200, { ok: true, value });
    } catch (error) {
      const code = operation === 'challenge' ? preparationCode(error)
        : operation === 'answer' ? 'JOB_CAPTCHA_ANSWER_FAILED' : 'JOB_CAPTCHA_STATUS_FAILED';
      try { report(code); } catch { /* Reporting must not change the RPC outcome. */ }
      if (!res.writableEnded) reply(res, 503, { ok: false, code: 'JOB_CAPTCHA_UNAVAILABLE' });
    }
    finally { active--; }
  });
  server.maxConnections = 16;
  server.on('upgrade', (_, socket) => socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  server.on('clientError', (_, socket) => socket.destroy());
  return server;
}
module.exports = { createCaptchaBroker };
