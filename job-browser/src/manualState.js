const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { UUID } = require('./rpcProtocol');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const fail = (code = 'JOB_MANUAL_STATE_DENIED') => Object.assign(new Error(code), { code });
function validTarget(value) {
  try {
    if (typeof value !== 'string' || value.length > 8192) return false;
    const u = new URL(value);
    if (u.origin !== 'https://hh.ru' || u.username || u.password || u.hash) return false;
    if (/^\/vacancy\/\d{1,20}$/.test(u.pathname)) return !u.search;
    const q = u.searchParams;
    return u.pathname === '/search/vacancy' && q.size === 5
      && ['text', 'search_period', 'order_by', 'items_on_page', 'page'].every((n) => q.getAll(n).length === 1)
      && q.get('text').trim().length > 0 && q.get('text').length <= 200
      && /^(?:[1-9]|[12]\d|30)$/.test(q.get('search_period')) && q.get('order_by') === 'publication_time'
      && q.get('items_on_page') === '20' && /^(?:0|[1-9]\d{0,2})$/.test(q.get('page'));
  } catch { return false; }
}
function initial(ownerId) {
  return { version: 1, ownerId, phase: 'idle', recoveryId: null, target: null, revision: 0,
    claims: [], seedRequired: false, lastAction: 'none', lastRevision: 0 };
}
function validate(value, ownerId) {
  if (!exact(value, ['version', 'ownerId', 'phase', 'recoveryId', 'target', 'revision', 'claims', 'seedRequired', 'lastAction', 'lastRevision'])
    || value.version !== 1 || value.ownerId !== ownerId || !UUID.test(ownerId || '')
    || !['idle', 'pending', 'active', 'checking'].includes(value.phase)
    || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !Number.isSafeInteger(value.lastRevision) || value.lastRevision < 0 || value.lastRevision > value.revision
    || !['none', 'start', 'finish'].includes(value.lastAction)
    || typeof value.seedRequired !== 'boolean' || value.phase === 'idle' && value.seedRequired
    || !Array.isArray(value.claims) || value.claims.length > 64 || new Set(value.claims).size !== value.claims.length
    || !value.claims.every((v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))
    || (value.phase === 'idle' ? value.recoveryId !== null || value.target !== null || value.claims.length !== 0
      : !UUID.test(value.recoveryId || '') || !validTarget(value.target))) throw fail();
  return value;
}
class ManualState {
  constructor({ root, ownerId }) {
    if (process.platform !== 'linux' || !path.isAbsolute(root || '') || !UUID.test(ownerId || '')) throw fail();
    Object.assign(this, { root, ownerId });
  }
  async directory() {
    await fs.mkdir(this.root, { mode: 0o700 }).catch((e) => { if (e.code !== 'EEXIST') throw fail(); });
    const s = await fs.lstat(this.root);
    if (!s.isDirectory() || s.uid !== process.getuid() || s.mode & 0o077) throw fail();
  }
  async read() {
    await this.directory(); let handle;
    try {
      handle = await fs.open(path.join(this.root, 'state.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
      const s = await handle.stat();
      if (!s.isFile() || s.uid !== process.getuid() || s.mode & 0o077 || s.size > 16384) throw fail();
      const bytes = Buffer.alloc(16385), r = await handle.read(bytes, 0, bytes.length, 0);
      if (r.bytesRead > 16384) throw fail();
      let value = JSON.parse(bytes.subarray(0, r.bytesRead).toString('utf8'));
      // First manual release omitted seedRequired. Preserve its claims/incident
      // and conservatively bar the first observed key before any human submit.
      if (exact(value, ['version', 'ownerId', 'phase', 'recoveryId', 'target', 'revision', 'claims', 'lastAction', 'lastRevision'])) {
        value = { ...value, seedRequired: value.phase !== 'idle' };
      }
      return validate(value, this.ownerId);
    } catch (e) { if (e.code === 'ENOENT') return initial(this.ownerId); throw fail(); }
    finally { await handle?.close(); }
  }
  async write(value) {
    validate(value, this.ownerId); await this.directory();
    const file = path.join(this.root, `.pending-${randomUUID()}`); let handle;
    try {
      handle = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(JSON.stringify(value)); await handle.sync(); await handle.close(); handle = null;
      await fs.rename(file, path.join(this.root, 'state.json'));
      const directory = await fs.open(this.root, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
    } catch { throw fail(); }
    finally { await handle?.close(); await fs.unlink(file).catch((e) => { if (e.code !== 'ENOENT') throw fail(); }); }
    return value;
  }
}
async function assertInactiveWhenDisabled({ root, ownerId }) {
  try { await fs.lstat(path.join(root, 'state.json')); }
  catch (e) { if (e.code === 'ENOENT') return; throw fail(); }
  const state = await new ManualState({ root, ownerId }).read();
  if (state.phase !== 'idle') throw fail('JOB_HH_MANUAL_ACTIVE');
}
module.exports = { ManualState, validTarget, initial, validate, fail, assertInactiveWhenDisabled };
