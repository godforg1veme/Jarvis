const { UUID } = require('./rpcProtocol');
const { validAnswer } = require('./captchaProtocol');
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
function normalizeAnswer(text) {
  if (typeof text !== 'string' || text.length > 256 || /[\x00-\x1f\x7f]/u.test(text)) return null;
  const normalized = text.trim().toLowerCase().replace(/ +/gu, ' ');
  return validAnswer(normalized) ? normalized : null;
}
function validCaptchaRequest(value) {
  if (!exact(value, ['operation', 'args'])) return false;
  if (value.operation === 'status') return exact(value.args, []);
  if (value.operation === 'challenge') return exact(value.args, ['refresh']) && typeof value.args.refresh === 'boolean';
  return value.operation === 'answer' && exact(value.args, ['challengeId', 'revision', 'operationId', 'text'])
    && UUID.test(value.args.challengeId || '') && UUID.test(value.args.operationId || '')
    && Number.isSafeInteger(value.args.revision) && value.args.revision >= 0
    && typeof value.args.text === 'string' && value.args.text.length <= 256;
}
// JSON.parse alone accepts duplicate keys. This bounded parser checks each
// decoded property name, including escaped aliases, before any operation.
function parseClosedJson(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 8192) throw new Error('invalid');
  let at = 0;
  const ws = () => { while (/[ \t\r\n]/.test(text[at] || '') && at < text.length) at++; };
  function string() {
    const begin = at++;
    while (at < text.length) {
      if (text[at] === '\\') { at += 2; continue; }
      if (text[at++] === '"') return JSON.parse(text.slice(begin, at));
    }
    throw new Error('invalid');
  }
  function value(depth) {
    if (depth > 8) throw new Error('invalid'); ws();
    if (text[at] === '"') return string();
    if (text[at] === '{') {
      at++; ws(); const result = Object.create(null), keys = new Set();
      if (text[at] === '}') { at++; return result; }
      while (at < text.length) {
        ws(); if (text[at] !== '"') throw new Error('invalid');
        const key = string(); if (keys.has(key)) throw new Error('invalid'); keys.add(key);
        ws(); if (text[at++] !== ':') throw new Error('invalid'); result[key] = value(depth + 1); ws();
        if (text[at] === '}') { at++; return result; } if (text[at++] !== ',') throw new Error('invalid');
      }
      throw new Error('invalid');
    }
    // Arrays are not used by this RPC, and rejecting them also caps complexity.
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));
    if (!match) throw new Error('invalid'); at += match[0].length; return JSON.parse(match[0]);
  }
  const result = value(0); ws(); if (at !== text.length) throw new Error('invalid'); return result;
}
module.exports = { normalizeAnswer, validCaptchaRequest, parseClosedJson };
