const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { UUID } = require('./rpcProtocol');

const MAX_MEMBER_CONTEXTS = 2;
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const fail = (code = 'JOB_BROWSER_PROFILE_DENIED') => Object.assign(new Error(code), { code });

function resolveProfilePath(userId, { ownerId, root }) {
  if (!UUID.test(userId || '') || !UUID.test(ownerId || '') || !path.isAbsolute(root || '')) throw fail();
  return userId === ownerId ? root : path.join(root, 'members', userId);
}

async function assertPrivateDirectory(directory, { create = false } = {}) {
  if (create) {
    try { await fs.mkdir(directory, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw fail(); }
  }
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw fail();
  return stat;
}

function validateStorageState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Array.isArray(value.cookies) || !Array.isArray(value.origins)
    || value.cookies.length > 5000 || value.origins.length > 100) throw fail();
  for (const cookie of value.cookies) {
    if (!cookie || typeof cookie !== 'object' || typeof cookie.name !== 'string' || cookie.name.length > 4096
      || typeof cookie.value !== 'string' || cookie.value.length > 65536 || typeof cookie.domain !== 'string'
      || typeof cookie.path !== 'string') throw fail();
  }
  for (const origin of value.origins) {
    if (!origin || typeof origin !== 'object' || typeof origin.origin !== 'string'
      || !Array.isArray(origin.localStorage) || origin.localStorage.length > 10000
      || (origin.indexedDB !== undefined && (!Array.isArray(origin.indexedDB) || origin.indexedDB.length > 100))) throw fail();
  }
  return value;
}

async function readPrivateState(root) {
  await assertPrivateDirectory(root);
  const file = path.join(root, 'state.json');
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > MAX_STATE_BYTES) throw fail();
    const buffer = Buffer.alloc(MAX_STATE_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_STATE_BYTES) throw fail();
    return validateStorageState(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return { cookies: [], origins: [] };
    throw fail();
  } finally { await handle?.close(); }
}

async function savePrivateStateAtomically(root, state) {
  await assertPrivateDirectory(root);
  const body = JSON.stringify(validateStorageState(state));
  if (Buffer.byteLength(body) > MAX_STATE_BYTES) throw fail('JOB_BROWSER_PROFILE_STATE_TOO_LARGE');
  const temporary = path.join(root, `.state-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(body, 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    await fs.rename(temporary, path.join(root, 'state.json'));
    const directory = await fs.open(root, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
  } catch { throw fail(); }
  finally { await handle?.close(); await fs.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw fail(); }); }
}

async function removePrivateFile(root, name) {
  if (!['state.json', 'jarvis-primary-resume.json'].includes(name)) throw fail();
  await assertPrivateDirectory(root);
  const file = path.join(root, name);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw fail();
    await fs.unlink(file);
    const directory = await fs.open(root, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) { if (error.code !== 'ENOENT') throw fail(); }
}

class ProfileManager {
  constructor({ root, ownerId, ownerRuntime, browser, createRuntime, maxMemberContexts = MAX_MEMBER_CONTEXTS, now = Date.now }) {
    if (process.platform !== 'linux' || !path.isAbsolute(root || '') || !UUID.test(ownerId || '')
      || !ownerRuntime?.browser || !browser || typeof browser.newContext !== 'function'
      || typeof createRuntime !== 'function' || maxMemberContexts !== MAX_MEMBER_CONTEXTS) throw fail('JOB_BROWSER_CONFIG_INVALID');
    Object.assign(this, { root, ownerId, ownerRuntime, browser, createRuntime, maxMemberContexts, now });
    this.members = new Map();
    this.creating = new Map();
    this.creationTail = Promise.resolve();
  }

  async prepareMemberRoot(userId) {
    await assertPrivateDirectory(this.root);
    const members = path.join(this.root, 'members');
    await assertPrivateDirectory(members, { create: true });
    const memberRoot = resolveProfilePath(userId, { ownerId: this.ownerId, root: this.root });
    await assertPrivateDirectory(memberRoot, { create: true });
    return memberRoot;
  }

  async forUser(userId) {
    if (!UUID.test(userId || '')) throw fail('JOB_BROWSER_ACCESS_DENIED');
    if (userId === this.ownerId) return this.ownerRuntime;
    let active = this.members.get(userId);
    if (active) { active.lastUsed = this.now(); return active.runtime; }
    if (this.creating.has(userId)) return this.creating.get(userId);
    const pending = Promise.resolve().then(() => this.createMember(userId));
    this.creating.set(userId, pending);
    try { return await pending; }
    finally { this.creating.delete(userId); }
  }

  async createMember(userId) {
    const previous = this.creationTail;
    let release;
    this.creationTail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      while (this.members.size >= this.maxMemberContexts) {
        const idle = [...this.members.entries()].filter(([, item]) => !item.runtime.browser.isBusy()
          && !item.runtime.browser.hasLoginSession())
          .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
        if (!idle) throw fail('JOB_BROWSER_BUSY');
        await this.closeUser(idle[0]);
      }
      const root = await this.prepareMemberRoot(userId);
      const state = await readPrivateState(root);
      const context = await this.browser.newContext({ storageState: state, acceptDownloads: false,
        serviceWorkers: 'block', locale: 'ru-RU' });
      try {
        const runtime = await this.createRuntime({ userId, root, context });
        const active = { userId, root, context, runtime, lastUsed: this.now() };
        this.members.set(userId, active);
        return runtime;
      } catch (error) { await context.close().catch(() => {}); throw error; }
    } finally { release(); }
  }

  async selectPrimaryResume(userId, resumeId) {
    if (!UUID.test(userId || '') || !/^[a-zA-Z0-9]{1,100}$/.test(resumeId || '')) throw fail('JOB_BROWSER_ACCESS_DENIED');
    const runtime = await this.forUser(userId);
    const resumes = await runtime.browser.listResumes();
    if (resumes.filter((resume) => resume.id === resumeId).length !== 1) throw fail('JOB_HH_RESUME_UNAVAILABLE');
    const manifest = { id: resumeId };
    const targetRoot = userId === this.ownerId ? this.root : await this.prepareMemberRoot(userId);
    const target = path.join(targetRoot, 'jarvis-primary-resume.json');
    const temporary = path.join(targetRoot, `.resume-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(JSON.stringify(manifest), 'utf8'); await handle.sync(); await handle.close(); handle = null;
      await fs.rename(temporary, target);
      const directory = await fs.open(targetRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
    } catch { throw fail(); }
    finally { await handle?.close(); await fs.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw fail(); }); }
    if (typeof runtime.setPrimaryResume === 'function') await runtime.setPrimaryResume(resumeId);
    else runtime.browser.primaryResumeId = resumeId;
    return { ok: true };
  }

  async closeUser(userId, { force = false } = {}) {
    const active = this.members.get(userId);
    if (!active) return false;
    if (!force && (active.runtime.browser.isBusy() || active.runtime.browser.hasLoginSession())) throw fail('JOB_BROWSER_BUSY');
    this.members.delete(userId);
    const loginUnconfirmed = active.runtime.browser.loginSessionId
      && ['waiting','captcha','authenticated','closed','expired'].includes(active.runtime.browser.loginState);
    const busyAtClose = active.runtime.browser.isBusy();
    if (!loginUnconfirmed && !(force && busyAtClose)) {
      await active.runtime.browser.tail;
      try { await savePrivateStateAtomically(active.root, await active.context.storageState({ indexedDB: true })); }
      catch { this.members.set(userId, active); throw fail(); }
    }
    try { await active.runtime.close?.(); } finally { await active.context.close(); }
    return true;
  }

  async saveUser(userId) {
    if (userId === this.ownerId) return true;
    const active = this.members.get(userId);
    if (!active) return false;
    await savePrivateStateAtomically(active.root, await active.context.storageState({ indexedDB: true }));
    return true;
  }

  async discardUnconfirmedUser(userId, sessionId) {
    if (!UUID.test(userId || '') || userId === this.ownerId || !UUID.test(sessionId || '')) throw fail('JOB_BROWSER_ACCESS_DENIED');
    const active = this.members.get(userId);
    if (active) {
      const browser = active.runtime.browser;
      if (browser.loginSessionId && browser.loginSessionId !== sessionId && browser.hasLoginSession()) throw fail('JOB_BROWSER_BUSY');
      if (browser.loginSessionId === sessionId) await browser.closeLogin({ sessionId });
      await browser.tail;
      this.members.delete(userId);
      try { await active.runtime.close?.(); } finally { await active.context.close(); }
    }
    const root = await this.prepareMemberRoot(userId);
    await removePrivateFile(root, 'state.json');
    await removePrivateFile(root, 'jarvis-primary-resume.json');
    return { ok: true };
  }

  async close() {
    for (const userId of [...this.members.keys()]) await this.closeUser(userId, { force: true });
  }
}

module.exports = { ProfileManager, resolveProfilePath, readPrivateState, savePrivateStateAtomically,
  validateStorageState, MAX_MEMBER_CONTEXTS, MAX_STATE_BYTES };
