const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ProfileManager, resolveProfilePath, readPrivateState, validateStorageState, MAX_MEMBER_CONTEXTS } = require('../src/profileManager');

test('member profile paths are isolated beneath the profile root and reject invalid identities', () => {
  const ownerId = randomUUID(), memberId = randomUUID(), root = path.resolve(os.tmpdir(), 'jarvis-profile-fixture');
  assert.equal(resolveProfilePath(ownerId, { ownerId, root }), root);
  assert.equal(resolveProfilePath(memberId, { ownerId, root }), path.join(root, 'members', memberId));
  for (const userId of ['../../owner', '', 'not-a-uuid']) {
    assert.throws(() => resolveProfilePath(userId, { ownerId, root }), { code: 'JOB_BROWSER_PROFILE_DENIED' });
  }
  assert.throws(() => resolveProfilePath(memberId, { ownerId, root: 'relative/path' }), { code: 'JOB_BROWSER_PROFILE_DENIED' });
});

test('storage state accepts only bounded cookie and origin collections', () => {
  const valid = { cookies: [{ name: 'hh', value: 'fixture', domain: '.hh.ru', path: '/' }], origins: [] };
  assert.equal(validateStorageState(valid), valid);
  assert.throws(() => validateStorageState({ cookies: 'not-an-array', origins: [] }), { code: 'JOB_BROWSER_PROFILE_DENIED' });
  assert.throws(() => validateStorageState({ cookies: [{ name: 'x', value: 'x', domain: '.hh.ru' }], origins: [] }), { code: 'JOB_BROWSER_PROFILE_DENIED' });
  assert.throws(() => validateStorageState({ cookies: [], origins: [{ origin: 'https://hh.ru', localStorage: 'invalid' }] }), { code: 'JOB_BROWSER_PROFILE_DENIED' });
});

test('real member directories keep separate durable state and close after manager shutdown', { skip: process.platform !== 'linux' }, async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-profile-manager-'));
  const root = path.join(base, 'owner'); await fs.mkdir(root, { mode: 0o700 }); await fs.chmod(root, 0o700);
  const ownerId = randomUUID(), memberA = randomUUID(), memberB = randomUUID();
  const contexts = [];
  const ownerRuntime = { browser: { owner: true } };
  const browser = { async newContext(options) {
    const context = { options, closed: false, async storageState() {
      return { cookies: [{ name: 'account', value: context.cookieValue, domain: '.hh.ru', path: '/' }], origins: [] };
    }, async close() { context.closed = true; } };
    contexts.push(context); return context;
  } };
  const manager = new ProfileManager({ root, ownerId, ownerRuntime, browser, maxMemberContexts: MAX_MEMBER_CONTEXTS,
    async createRuntime({ userId, root: profileRoot, context }) {
      context.cookieValue = userId;
      return { userId, root: profileRoot, context, browser: { tail: Promise.resolve(), isBusy: () => false, hasLoginSession: () => false }, async close() {} };
    } });
  try {
    assert.equal(await manager.forUser(ownerId), ownerRuntime);
    const runtimeA = await manager.forUser(memberA), runtimeB = await manager.forUser(memberB);
    assert.notEqual(runtimeA.context, runtimeB.context);
    assert.notEqual(runtimeA.root, runtimeB.root);
    assert.equal(runtimeA.context.options.storageState.cookies.length, 0);
    assert.equal(runtimeB.context.options.storageState.cookies.length, 0);
    assert.equal((await manager.forUser(memberA)), runtimeA);
    await manager.close();
    assert.equal(runtimeA.context.closed, true);
    assert.equal(runtimeB.context.closed, true);
    const stateA = await readPrivateState(runtimeA.root), stateB = await readPrivateState(runtimeB.root);
    assert.equal(stateA.cookies[0].value, memberA);
    assert.equal(stateB.cookies[0].value, memberB);
    for (const runtime of [runtimeA, runtimeB]) {
      const stat = await fs.stat(path.join(runtime.root, 'state.json'));
      assert.equal(stat.uid, process.getuid());
      assert.equal(stat.mode & 0o777, 0o600);
    }
  } finally { await manager.close(); await fs.rm(base, { recursive: true, force: true }); }
});

test('real member state reader rejects symlinked profile roots', { skip: process.platform !== 'linux' }, async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-profile-symlink-'));
  const target = path.join(base, 'target'), link = path.join(base, 'link');
  try {
    await fs.mkdir(target, { mode: 0o700 }); await fs.chmod(target, 0o700);
    await fs.symlink(target, link, 'dir');
    await assert.rejects(readPrivateState(link), { code: 'JOB_BROWSER_PROFILE_DENIED' });
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});
