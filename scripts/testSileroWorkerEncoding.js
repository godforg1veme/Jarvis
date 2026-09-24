const assert = require('assert');
const fs = require('fs');
const path = require('path');

const workerPath = path.join(__dirname, 'sileroWorker.py');
const source = fs.readFileSync(workerPath, 'utf8');

assert(
  source.includes('sys.stdin.buffer'),
  'sileroWorker.py must read stdin bytes to avoid Windows text-mode codepage decoding'
);
assert(
  source.includes('encoding="utf-8"'),
  'sileroWorker.py must decode stdin as UTF-8'
);
assert(
  source.includes('ensure_ascii=True'),
  'sileroWorker.py must write ASCII-only JSON so stdout codepages cannot corrupt protocol messages'
);

console.log('testSileroWorkerEncoding: ok');
