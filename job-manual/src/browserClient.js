'use strict';
const http = require('node:http');
const { WebSocket } = require('ws');
const CODES = new Set(['JOB_HH_MANUAL_ACTIVE', 'JOB_HH_MANUAL_STALE', 'JOB_HH_MANUAL_UNAVAILABLE',
  'JOB_HH_CAPTCHA_MANUAL_REQUIRED', 'JOB_HH_MANUAL_INVALID', 'JOB_HH_MANUAL_BUSY', 'JOB_BROWSER_UNAVAILABLE',
  'JOB_MANUAL_ACCESS_DENIED', 'JOB_MANUAL_REVISION_CONFLICT', 'JOB_MANUAL_INVALID_REQUEST',
  'JOB_MANUAL_BUSY', 'JOB_MANUAL_CONFIG_INVALID']);
const phases = new Set(['idle', 'pending', 'active', 'checking']);
function validStatus(value) {
  return value && Object.keys(value).sort().join(',') === 'phase,revision'
    && phases.has(value.phase) && Number.isSafeInteger(value.revision) && value.revision >= 0;
}
function createBrowserClient({ brokerUrl = 'http://job-browser:8082', ownerId, token, testAllowLoopback = false }) {
  const url = new URL(brokerUrl);
  const testHost = testAllowLoopback && ['127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || (!testHost && brokerUrl !== 'http://job-browser:8082')
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(ownerId || '')
      || typeof token !== 'string' || token.length < 32 || token.length > 512 || /[\x00-\x20\x7f]/.test(token)) {
    throw new Error('MANUAL_CONFIG_INVALID');
  }
  const headers = { authorization: `Bearer ${token}`, 'x-jarvis-owner-id': ownerId };
  async function control(action, revision) {
    return new Promise(resolve => {
      let done = false;
      const finish = value => { if (!done) { done = true; resolve(value); } };
      const body = action === 'status' ? null : Buffer.from(JSON.stringify({ revision }));
      const req = http.request(new URL(`/${action}`, url), {
        method: body ? 'POST' : 'GET', headers: { ...headers, ...(body ? { 'content-type': 'application/json', 'content-length': body.length } : {}) },
        timeout: action === 'status' ? 5000 : 60000, maxHeaderSize: 8192,
      }, res => {
        let size = 0; const chunks = [];
        res.on('data', chunk => { size += chunk.length; if (size > 4096) { res.destroy(); finish({ ok: false, code: 'JOB_HH_MANUAL_UNAVAILABLE' }); } else chunks.push(chunk); });
        res.on('error', () => finish({ ok: false, code: 'JOB_HH_MANUAL_UNAVAILABLE' }));
        res.on('end', () => {
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (res.statusCode === 200 && value.ok === true && Object.keys(value).sort().join(',') === 'ok,value' && validStatus(value.value)) return finish(value);
            if (value.ok === false && CODES.has(value.code)) return finish({ ok: false, code: value.code });
          } catch { /* Never expose broker payloads or exception text. */ }
          finish({ ok: false, code: 'JOB_HH_MANUAL_UNAVAILABLE' });
        });
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => finish({ ok: false, code: 'JOB_HH_MANUAL_UNAVAILABLE' }));
      req.end(body);
    });
  }
  function transport(revision) {
    const endpoint = new URL(`/transport?revision=${revision}`, url); endpoint.protocol = 'ws:';
    return new WebSocket(endpoint, 'binary', { headers, perMessageDeflate: false, maxPayload: 65536, handshakeTimeout: 10000 });
  }
  return { control, transport };
}
module.exports = { createBrowserClient, validStatus };
