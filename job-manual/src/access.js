'use strict';
const { randomBytes, timingSafeEqual } = require('node:crypto');
const COOKIE = '__Secure-jarvis-hh';
function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b)
    && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function single(req, name) {
  const values = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === name);
  return values.length === 1 && typeof req.headers[name] === 'string' ? req.headers[name] : null;
}
function createAccess({ origin, ownerLogin, maxSessions = 8, onEvict = () => {} }) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || !/^[a-z0-9][a-z0-9.-]*\.ts\.net$/.test(url.hostname)
      || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || origin !== url.origin || typeof ownerLogin !== 'string' || !ownerLogin || ownerLogin.length > 254
      || /[\x00-\x20\x7f]/.test(ownerLogin)) throw new Error('MANUAL_CONFIG_INVALID');
  const sessions = new Map();
  const owner = req => equal(single(req, 'host'), url.host)
    && equal(single(req, 'tailscale-user-login'), ownerLogin);
  const sameOrigin = req => equal(single(req, 'origin'), origin);
  function session(req) {
    const raw = single(req, 'cookie');
    if (!raw || raw.length > 4096) return null;
    const entries = raw.split(';').map(v => v.trim()).filter(v => v.startsWith(`${COOKIE}=`));
    if (entries.length !== 1) return null;
    const id = entries[0].slice(COOKIE.length + 1);
    return /^[a-f0-9]{64}$/.test(id) ? sessions.get(id) || null : null;
  }
  function issue(res) {
    if (sessions.size >= maxSessions) {
      const oldest = sessions.keys().next().value;
      sessions.delete(oldest);
      onEvict(oldest);
    }
    const id = randomBytes(32).toString('hex');
    const value = { id, csrf: randomBytes(32).toString('hex'), requests: [], controls: [], transports: [] };
    sessions.set(id, value);
    res.setHeader('Set-Cookie', `${COOKIE}=${id}; Secure; HttpOnly; SameSite=Strict; Path=/hh`);
    return value;
  }
  function rate(sessionValue, key, limit, windowMs = 60000) {
    const now = Date.now();
    sessionValue[key] = sessionValue[key].filter(t => now - t < windowMs);
    if (sessionValue[key].length >= limit) return false;
    sessionValue[key].push(now);
    return true;
  }
  return { owner, sameOrigin, session, issue, rate, sessions };
}
module.exports = { createAccess, equal, single, COOKIE };
