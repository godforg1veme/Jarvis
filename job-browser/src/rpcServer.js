const http = require('node:http');
const { createHash, timingSafeEqual } = require('node:crypto');
const { UUID, validRequest, SAFE_CODES } = require('./rpcProtocol');

function createRpcServer({ browser, profiles = null, ownerId, token, connectToken = null, resumeToken = null, submissions = null, applyToken = null, health = async () => true }) {
  if (resumeToken !== null && (!/^[\x21-\x7e]{32,256}$/.test(resumeToken) || [token,connectToken,applyToken].includes(resumeToken))) throw new Error('JOB_BROWSER_CONFIG_INVALID');
  if (!UUID.test(ownerId || '') || typeof token !== 'string' || token.length < 32 || token.length > 256
    || !/^[\x21-\x7e]+$/.test(token)) throw new Error('JOB_BROWSER_CONFIG_INVALID');
  if (connectToken !== null && (typeof connectToken !== 'string' || !/^[\x21-\x7e]{32,256}$/.test(connectToken)
    || connectToken === token || connectToken === applyToken)) throw new Error('JOB_BROWSER_CONFIG_INVALID');
  if ((submissions || applyToken) && (!submissions || typeof applyToken !== 'string'
    || !/^[\x21-\x7e]{32,256}$/.test(applyToken) || applyToken === token)) throw new Error('JOB_BROWSER_CONFIG_INVALID');
  const digest = (value) => createHash('sha256').update(value).digest();
  const expected = digest(`Bearer ${token}`);
  const expectedConnect = connectToken ? digest(`Bearer ${connectToken}`) : Buffer.alloc(32);
  const expectedApply = applyToken ? digest(`Bearer ${applyToken}`) : Buffer.alloc(32);
  const expectedResume = resumeToken ? digest(`Bearer ${resumeToken}`) : Buffer.alloc(32);
  let active = 0;
  const respond = (res, status, value) => {
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > 1024 * 1024) return respond(res, 502, { ok: false, code: 'JOB_BROWSER_RESPONSE_TOO_LARGE' });
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(body);
  };
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000 }, async (req, res) => {
    const auth = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const credential = digest(auth), readAuthenticated = timingSafeEqual(expected, credential);
    const connectAuthenticated = timingSafeEqual(expectedConnect, credential) && Boolean(connectToken);
    const applyAuthenticated = timingSafeEqual(expectedApply, credential) && Boolean(submissions && applyToken);
    const resumeAuthenticated = timingSafeEqual(expectedResume, credential) && Boolean(resumeToken);
    if (!readAuthenticated && !connectAuthenticated && !applyAuthenticated && !resumeAuthenticated) { respond(res, 401, { ok: false, code: 'JOB_BROWSER_ACCESS_DENIED' }); req.resume(); return; }
    if (req.method === 'GET' && req.url === '/health') {
      let healthy = false; try { healthy = await health() === true; } catch {}
      respond(res, healthy ? 200 : 503, healthy ? { ok: true } : { ok: false, code: 'JOB_BROWSER_UNHEALTHY' }); return;
    }
    if (req.method !== 'POST' || req.url !== '/rpc' || req.headers['content-type'] !== 'application/json') {
      respond(res, 400, { ok: false, code: 'JOB_BROWSER_INVALID_REQUEST' }); req.resume(); return;
    }
    if (active >= 4) { respond(res, 503, { ok: false, code: 'JOB_BROWSER_BUSY' }); req.resume(); return; }
    active++;
    try {
      const chunks = []; let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > (applyAuthenticated ? 65536 : 8192)) { respond(res, 413, { ok: false, code: 'JOB_BROWSER_REQUEST_TOO_LARGE' }); req.resume(); return; }
        chunks.push(chunk);
      }
      let input; try { input = JSON.parse(Buffer.concat(chunks, length).toString('utf8')); } catch {
        respond(res, 400, { ok: false, code: 'JOB_BROWSER_INVALID_REQUEST' }); return;
      }
      if (!validRequest(input, profiles ? null : ownerId)) { respond(res, 403, { ok: false, code: 'JOB_BROWSER_ACCESS_DENIED' }); return; }
      const connecting = ['login_start','login_frame','login_input','login_status','login_close','login_discard','select_resume'].includes(input.operation);
      const writing = ['submit','reconcile'].includes(input.operation);
      const raising = ['raise_resume','raise_resume_status'].includes(input.operation);
      if ((connecting && !connectAuthenticated) || (writing && !applyAuthenticated)
        || (raising && !resumeAuthenticated) || (!connecting && !writing && !raising && !readAuthenticated)) {
        respond(res, 403, { ok: false, code: 'JOB_BROWSER_ACCESS_DENIED' }); return;
      }
      let value;
      if (input.operation === 'login_discard') {
        if (!profiles) throw Object.assign(new Error('JOB_BROWSER_ACCESS_DENIED'), { code: 'JOB_BROWSER_ACCESS_DENIED' });
        value = await profiles.discardUnconfirmedUser(input.userId, input.args.sessionId);
      } else {
        if(['connection','raise_resume'].includes(input.operation)) await profiles?.waitSelection?.(input.userId);
        const profile = profiles ? await profiles.forUser(input.userId) : { browser, submissions };
        const activeBrowser = profile.browser;
        value = input.operation === 'search' ? await activeBrowser.search(input.args)
        : input.operation === 'history' ? await activeBrowser.history(input.args)
        : input.operation === 'vacancy' ? await activeBrowser.getVacancy(input.args)
        : input.operation === 'inspect' ? await activeBrowser.inspect(input.args)
        : input.operation === 'submit' ? await profile.submissions?.submit({ userId: input.userId, ...input.args })
        : input.operation === 'reconcile' ? await profile.submissions?.reconcile({ userId: input.userId, ...input.args })
        : input.operation === 'raise_resume' ? await profile.raiseResume?.({ userId: input.userId, ...input.args })
        : input.operation === 'raise_resume_status' ? await profile.raiseResumeStatus?.({ userId: input.userId, ...input.args })
        : input.operation === 'connection' ? await activeBrowser.connection()
        : input.operation === 'resumes' ? await activeBrowser.listResumes()
        : input.operation === 'resume_content' ? await activeBrowser.resumeContent(input.args)
        : input.operation === 'login_start' ? await activeBrowser.startLogin(input.args)
        : input.operation === 'login_frame' ? await activeBrowser.loginFrame(input.args)
        : input.operation === 'login_input' ? await activeBrowser.loginInput(input.args)
        : input.operation === 'login_status' ? await activeBrowser.loginStatus(input.args)
        : input.operation === 'login_close' ? await activeBrowser.closeLogin(input.args)
        : input.operation === 'select_resume' ? await (async () => {
          const result = await profiles.selectPrimaryResume(input.userId, input.args.resumeId);
          await profiles.saveUser(input.userId); return result;
        })()
        : await activeBrowser.listResumes();
      }
      if (value === undefined) throw Object.assign(new Error('JOB_BROWSER_ACCESS_DENIED'), { code: 'JOB_BROWSER_ACCESS_DENIED' });
      respond(res, 200, { ok: true, value });
    } catch (error) {
      if (!res.writableEnded) respond(res, 502, { ok: false, code: SAFE_CODES.has(error.code) ? error.code : 'JOB_HH_UNAVAILABLE',
        ...(error.code === 'JOB_HH_CAPTCHA_WAITING' && Number.isInteger(error.retryAfterMs) && error.retryAfterMs >= 1000 && error.retryAfterMs <= 120000 ? { retryAfterMs: error.retryAfterMs } : {}),
        ...(error.code === 'JOB_HH_CAPTCHA_MANUAL_REQUIRED' && UUID.test(error.recoveryId || '') ? { recoveryId: error.recoveryId } : {}) });
    } finally { active--; }
  });
  server.maxConnections = 16;
  return server;
}
module.exports = { createRpcServer };
