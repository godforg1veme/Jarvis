const fs = require('node:fs/promises');
const path = require('node:path');

const STORAGE_KEY_PATTERN = /^[a-f0-9]{2}\/[a-f0-9-]{36}$/;

function storageKeyForId(documentId) {
  const id = String(documentId || '').toLowerCase();
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('invalid document ID');
  return `${id.slice(0, 2)}/${id}`;
}

class DocumentStorage {
  constructor(options = {}) {
    this.root = path.resolve(options.root || '/srv/jarvis/documents');
  }

  pathFor(storageKey) {
    const key = String(storageKey || '');
    if (!STORAGE_KEY_PATTERN.test(key)) throw new Error('invalid document storage key');
    const target = path.resolve(this.root, key);
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new Error('document storage path escapes root');
    return target;
  }

  async write(storageKey, data) {
    if (!Buffer.isBuffer(data) || data.length === 0) throw new Error('document data is required');
    const target = this.pathFor(storageKey);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const handle = await fs.open(target, 'wx', 0o600);
    try {
      await handle.writeFile(data);
    } finally {
      await handle.close();
    }
    return target;
  }

  async read(storageKey) {
    return fs.readFile(this.pathFor(storageKey));
  }

  async remove(storageKey) {
    await fs.rm(this.pathFor(storageKey), { force: true });
  }
}

module.exports = {
  DocumentStorage,
  STORAGE_KEY_PATTERN,
  storageKeyForId,
};
