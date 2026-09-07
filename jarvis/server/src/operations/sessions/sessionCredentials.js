const crypto = require('node:crypto');
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
function createCredential() { return crypto.randomBytes(32).toString('base64url'); }
function credentialHash(value) {
  const token = String(value || '');
  if (!TOKEN_RE.test(token)) throw new Error('panel credential is invalid');
  return crypto.createHash('sha256').update(token).digest();
}
module.exports = { createCredential, credentialHash };
