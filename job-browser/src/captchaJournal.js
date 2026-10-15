const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { UUID } = require('./rpcProtocol');
const failure = () => Object.assign(new Error('JOB_HH_CAPTCHA_MANUAL_REQUIRED'), { code: 'JOB_HH_CAPTCHA_MANUAL_REQUIRED' });
class CaptchaJournal {
  constructor({ root, ownerId }) {
    if (process.platform !== 'linux' || !path.isAbsolute(root || '') || !UUID.test(ownerId || '')) throw failure();
    this.root = root; this.ownerId = ownerId;
  }
  async directory() {
    await fs.mkdir(this.root, { mode: 0o700 }).catch((e) => { if (e.code !== 'EEXIST') throw failure(); });
    const s = await fs.lstat(this.root);
    if (!s.isDirectory() || s.uid !== process.getuid() || (s.mode & 0o077)) throw failure();
  }
  validate(value) {
    if (!value || Object.keys(value).sort().join(',') !== 'detectedAt,operationId,ownerId,phase,retryAt,targetHash,version'
      || value.version !== 1 || value.ownerId !== this.ownerId || !UUID.test(value.operationId || '')
      || !['waiting', 'initializing', 'attempted', 'blocked', 'resolved'].includes(value.phase) || !/^[a-f0-9]{64}$/.test(value.targetHash || '')
      || !Number.isSafeInteger(value.detectedAt) || value.detectedAt < 0 || value.retryAt !== value.detectedAt + 120000) throw failure();
    return value;
  }
  async read() {
    await this.directory(); let handle;
    try {
      handle = await fs.open(path.join(this.root, 'state.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > 2048) throw failure();
      const bytes = Buffer.alloc(2049), result = await handle.read(bytes, 0, bytes.length, 0);
      if (result.bytesRead > 2048) throw failure();
      return this.validate(JSON.parse(bytes.subarray(0, result.bytesRead).toString('utf8')));
    } catch (e) { if (e.code === 'ENOENT') return null; throw failure(); }
    finally { await handle?.close(); }
  }
  async write(value) {
    this.validate(value); await this.directory();
    const file = path.join(this.root, `.pending-${randomUUID()}`); let handle;
    try {
      handle = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(JSON.stringify(value)); await handle.sync(); await handle.close(); handle = null;
      await fs.rename(file, path.join(this.root, 'state.json'));
      const directory = await fs.open(this.root, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
    } catch { throw failure(); }
    finally { await handle?.close(); await fs.unlink(file).catch((e) => { if (e.code !== 'ENOENT') throw failure(); }); }
    return value;
  }
}
module.exports = { CaptchaJournal };
