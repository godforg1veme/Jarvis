const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const coreManifest = require('./coreTestManifest.json');

const root = path.resolve(__dirname, '..');
const MAX_OUTPUT = 16 * 1024 * 1024;
const EXCLUDED = ['PostgreSQL acceptance', 'Linux host/runtime', 'browser UI', 'live service and device'];

function manifest() {
  if (!Array.isArray(coreManifest) || coreManifest.length === 0) {
    throw new Error('Core test manifest must contain suites');
  }
  return coreManifest.map((suite) => {
    if (!suite || typeof suite.name !== 'string' || !suite.name.trim()
      || !['.', 'server'].includes(suite.cwd)
      || !Array.isArray(suite.files) || suite.files.length === 0) {
      throw new Error('Invalid core test suite');
    }
    const cwd = path.join(root, suite.cwd);
    for (const file of suite.files) {
      if (typeof file !== 'string' || !/^[\w./-]+\.test\.(?:js|cjs)$/.test(file)
        || file.includes('..') || path.isAbsolute(file) || !existsSync(path.join(cwd, file))) {
        throw new Error(`Invalid or missing core test file: ${file}`);
      }
    }
    if (new Set(suite.files).size !== suite.files.length) {
      throw new Error(`Duplicate core test file in ${suite.name}`);
    }
    return { name: suite.name, cwd, files: suite.files.slice() };
  });
}

function parseTotals(output) {
  const totals = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...output.matchAll(new RegExp(`^# ${key} (\\d+)\\r?$`, 'gm'))];
    if (matches.length !== 1) return null;
    totals[key] = Number(matches[0][1]);
  }
  if (!/^1\.\.\d+\r?$/m.test(output)) return null;
  return totals;
}

function runSuite(suite) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', ...suite.files], {
      cwd: suite.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env,
    });
    let output = '';
    let size = 0;
    let overflow = false;
    const append = (chunk) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) {
        overflow = true;
        child.kill();
      } else output += chunk.toString('utf8');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', (error) => resolve({ ok: false, reason: error.message, totals: null }));
    child.once('close', (code, signal) => {
      const totals = parseTotals(output);
      const fileOnly = (output.match(/^# Subtest: .*\.test\.(?:cjs|mjs|js)\r?$/gm) || []).length;
      const ok = !overflow && code === 0 && !signal && totals && totals.tests > fileOnly
        && totals.pass > 0 && totals.fail === 0 && totals.cancelled === 0
        && totals.skipped === 0 && totals.todo === 0 && totals.pass === totals.tests;
      resolve({ ok: Boolean(ok), totals,
        reason: overflow ? 'output limit exceeded' : `exit=${code}, signal=${signal || 'none'}`,
        detail: ok ? '' : output.slice(-4000) });
    });
  });
}

async function main() {
  let failed = false;
  for (const suite of manifest()) {
    const result = await runSuite(suite);
    const counts = result.totals ? JSON.stringify(result.totals) : 'no valid TAP totals';
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${suite.name}: ${counts} (${result.reason})`);
    if (!result.ok) {
      failed = true;
      if (result.detail) console.error(result.detail);
    }
  }
  console.log(`Excluded environments: ${EXCLUDED.join('; ')}.`);
  if (failed) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = { manifest, parseTotals, runSuite };
