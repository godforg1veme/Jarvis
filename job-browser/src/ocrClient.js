const http = require('node:http');
const { validAnswer } = require('./captchaProtocol');
const failure = () => Object.assign(new Error('JOB_OCR_UNAVAILABLE'), { code: 'JOB_OCR_UNAVAILABLE' });
function parseOcrResult(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 512) throw failure();
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw failure(); }
  if (!value || Object.keys(value).join(',') !== 'answer' || !validAnswer(value.answer)) throw failure();
  return value.answer;
}
function recognizePng(bytes, { socketPath = '/run/job-ocr/ocr.sock', timeoutMs = 10000, frozen = false } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 8 || bytes.length > 262144
    || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return Promise.reject(failure());
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error, value) => { if (!finished) { finished = true; clearTimeout(timer); error ? reject(failure()) : resolve(value); } };
    const request = http.request({ socketPath, path: frozen ? '/ocr/frozen' : '/ocr', method: 'POST', headers: {
      'content-type': 'image/png', 'content-length': bytes.length, connection: 'close' } }, (response) => {
      let size = 0; const parts = [];
      if (response.statusCode !== 200 || response.headers['content-type'] !== 'application/json') { response.destroy(); return finish(true); }
      response.on('data', (part) => { size += part.length; if (size > 512) { response.destroy(); finish(true); } else parts.push(part); });
      response.on('error', () => finish(true));
      response.on('end', () => { try { finish(false, parseOcrResult(Buffer.concat(parts))); } catch { finish(true); } });
    });
    const timer = setTimeout(() => { request.destroy(); finish(true); }, timeoutMs);
    request.on('error', () => finish(true));
    request.end(bytes);
  });
}
const recognizeFrozenPng = (bytes) => recognizePng(bytes, { frozen: true });
module.exports = { recognizePng, recognizeFrozenPng, parseOcrResult };
