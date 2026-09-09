const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const BLOB_KEY = /^[a-f0-9]{2}\/[a-f0-9-]{36}\.jvs$/;
const MAGIC = Buffer.from('JVS1');

function parseMasterKey(value) {
  const text = String(value || '').trim();
  const key = /^[a-f0-9]{64}$/iu.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64url');
  if (key.length !== 32) throw new Error('JARVIS_VISION_MEMORY_KEY must encode exactly 32 bytes');
  return key;
}

function aadFor(metadata) {
  return Buffer.from(`${metadata.userId}:${metadata.frameId}:${metadata.sourceId}`, 'utf8');
}

class VisualMemoryStorage {
  constructor({ root, key, randomBytes = crypto.randomBytes }) {
    this.root = path.resolve(root);
    this.key = Buffer.isBuffer(key) ? Buffer.from(key) : parseMasterKey(key);
    this.randomBytes = randomBytes;
  }

  createBlobKey(id = crypto.randomUUID()) { return `${id.slice(0, 2)}/${id}.jvs`; }

  pathFor(blobKey) {
    if (!BLOB_KEY.test(String(blobKey || ''))) throw new Error('invalid visual memory blob key');
    const target = path.resolve(this.root, blobKey);
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new Error('visual memory path escapes root');
    return target;
  }

  encrypt(payload, metadata) {
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const nonce = this.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(aadFor(metadata));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), ciphertext]);
  }

  decrypt(blob, metadata) {
    if (!Buffer.isBuffer(blob) || blob.length < 33 || !blob.subarray(0, 4).equals(MAGIC)) throw new Error('invalid visual memory blob');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, blob.subarray(4, 16));
    decipher.setAAD(aadFor(metadata));
    decipher.setAuthTag(blob.subarray(16, 32));
    return JSON.parse(Buffer.concat([decipher.update(blob.subarray(32)), decipher.final()]).toString('utf8'));
  }

  async write(blobKey, payload, metadata) {
    const target = this.pathFor(blobKey);
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(temporary, this.encrypt(payload, metadata), { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async read(blobKey, metadata) { return this.decrypt(await fs.readFile(this.pathFor(blobKey)), metadata); }
  async remove(blobKey) { if (blobKey) await fs.rm(this.pathFor(blobKey), { force: true }); }
}

module.exports = { BLOB_KEY, MAGIC, VisualMemoryStorage, aadFor, parseMasterKey };
