const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { CaptchaJournal } = require('../src/captchaJournal');
test('Linux captcha journal preserves unknown attempts and rejects foreign, unsafe and oversized files', { skip: process.platform !== 'linux' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'captcha-journal-')), ownerId = randomUUID();
  const journal = new CaptchaJournal({ root, ownerId });
  const state = { version: 1, ownerId, operationId: randomUUID(), phase: 'initializing', detectedAt: 1000, retryAt: 121000, targetHash: 'a'.repeat(64) };
  const file = path.join(root, 'state.json');
  try {
    await journal.write(state);
    assert.deepEqual(await new CaptchaJournal({ root, ownerId }).read(), state);
    await assert.rejects(new CaptchaJournal({ root, ownerId: randomUUID() }).read(), { code: 'JOB_HH_CAPTCHA_MANUAL_REQUIRED' });
    await fs.chmod(file, 0o644); await assert.rejects(journal.read(), { code: 'JOB_HH_CAPTCHA_MANUAL_REQUIRED' });
    await fs.chmod(file, 0o600); await fs.writeFile(file, Buffer.alloc(2049));
    await assert.rejects(journal.read(), { code: 'JOB_HH_CAPTCHA_MANUAL_REQUIRED' });
    await fs.unlink(file); await fs.symlink(path.join(root, 'other'), file);
    await assert.rejects(journal.read(), { code: 'JOB_HH_CAPTCHA_MANUAL_REQUIRED' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
