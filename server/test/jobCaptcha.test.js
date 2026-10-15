const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { JobBrowserClient } = require('../src/jobs/jobBrowserClient');
const ownerId = randomUUID();
function client(result) {
  return new JobBrowserClient({ ownerId, token: 'fixture-read-credential-'.repeat(3),
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, ...result }), { status: 502 }) });
}
test('captcha transport carries only bounded delay or typed incident identity', async () => {
  await assert.rejects(client({ code: 'JOB_HH_CAPTCHA_WAITING', retryAfterMs: 120000 }).request(ownerId, 'resumes', {}),
    (e) => e.code === 'JOB_HH_CAPTCHA_WAITING' && e.retryAfterMs === 120000);
  for (const retryAfterMs of [-1, 0, 120001, '120000']) await assert.rejects(client({ code: 'JOB_HH_CAPTCHA_WAITING', retryAfterMs }).request(ownerId, 'resumes', {}), { code: 'JOB_HH_UNAVAILABLE' });
  const recoveryId = randomUUID();
  await assert.rejects(client({ code: 'JOB_HH_CAPTCHA_MANUAL_REQUIRED', recoveryId, message: 'untrusted instruction' }).request(ownerId, 'resumes', {}),
    (e) => e.code === 'JOB_HH_CAPTCHA_MANUAL_REQUIRED' && e.recoveryId === recoveryId && e.message === e.code);
});
