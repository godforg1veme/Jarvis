const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseEnv, loadEnvFile } = require('../tools/loadEnv');

function run() {
  assert.deepStrictEqual(parseEnv([
    '# comment',
    'PLAIN=value',
    'QUOTED="line\\nnext"',
    "SINGLE='literal # value'",
    'export WITH_COMMENT=kept # ignored',
    'INVALID-NAME=nope',
  ].join('\n')), {
    PLAIN: 'value',
    QUOTED: 'line\nnext',
    SINGLE: 'literal # value',
    WITH_COMMENT: 'kept',
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-env-'));
  const envPath = path.join(root, '.env');
  try {
    fs.writeFileSync(envPath, 'EXISTING=from-file\nNEW_VALUE=loaded\n', 'utf8');
    const target = { EXISTING: 'from-process' };
    assert.deepStrictEqual(loadEnvFile(envPath, target), { ok: true, loaded: 1 });
    assert.deepStrictEqual(target, { EXISTING: 'from-process', NEW_VALUE: 'loaded' });
    assert.deepStrictEqual(loadEnvFile(path.join(root, 'missing.env'), target), { ok: true, loaded: 0 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('[testLoadEnv] local env loading passed');
}

run();
