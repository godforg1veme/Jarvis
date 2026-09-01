const assert = require('assert');
const path = require('path');
const {
  findExecutable,
  buildSearchExpression,
  buildEsArgs,
  decodeEsBuffer,
  parseEverythingCsv,
  searchEverything,
} = require('../tools/everythingSearch');

function encodedCsv(prefix, encodedName, suffix) {
  return Buffer.concat([
    Buffer.from(prefix, 'ascii'),
    Buffer.from(encodedName, 'hex'),
    Buffer.from(suffix, 'ascii'),
  ]);
}

function testQueryConstruction() {
  assert.strictEqual(buildSearchExpression({ query: 'Test', targetType: 'directory' }), 'folder:regex:^Test$');
  assert.strictEqual(buildSearchExpression({ query: 'report.pdf', targetType: 'file', exact: false }), 'file:regex:report\\.pdf');
  assert.strictEqual(buildSearchExpression({ query: 'a & b | c', targetType: 'any' }), 'regex:^a\\x20&\\x20b\\x20\\|\\x20c$');

  const args = buildEsArgs({
    query: 'Test',
    targetType: 'directory',
    locationPath: 'D:\\Projects',
    maxResults: 20,
  });
  assert.deepStrictEqual(args.slice(-3), ['-path', 'D:\\Projects', 'folder:regex:^Test$']);
  assert.strictEqual(args.includes('&'), false);
  assert.throws(() => buildEsArgs({ query: 'x', locationPath: '\\\\server\\share' }), /absolute local path/);
}

function testDiscovery() {
  const explicit = path.resolve('C:\\Tools\\es.exe');
  const found = findExecutable('es.exe', {
    esPath: explicit,
    env: { PATH: '', ProgramFiles: 'C:\\Program Files' },
    existsSync: (candidate) => candidate === explicit,
  });
  assert.strictEqual(found, explicit);

  const local = path.resolve('C:\\Users\\Tester\\AppData\\Local\\Everything\\es.exe');
  const localFound = findExecutable('es.exe', {
    env: { PATH: '', LOCALAPPDATA: 'C:\\Users\\Tester\\AppData\\Local' },
    existsSync: (candidate) => candidate === local,
  });
  assert.strictEqual(localFound, local);
}

function testCsv() {
  const csv = [
    'Filename,Size,Date Modified,Attributes',
    '"C:\\Users\\Макс\\Desktop\\Test",0,2026-08-31T10:00:00.000Z,16',
    '"D:\\Docs\\report, final.pdf",42,2026-08-30T10:00:00.000Z,A',
  ].join('\r\n');
  const results = parseEverythingCsv(csv);
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].type, 'directory');
  assert.strictEqual(results[0].name, 'Test');
  assert.strictEqual(results[1].type, 'file');
  assert.strictEqual(results[1].name, 'report, final.pdf');
  assert.strictEqual(results[1].size, 42);
  assert.deepStrictEqual(parseEverythingCsv(''), []);
  assert.throws(() => parseEverythingCsv('Size\r\n10'), /filename column/);
}

function testOutputDecoding() {
  const utf8 = Buffer.from('Filename\r\n"C:\\Users\\maxob\\Desktop\\бз доки\\"\r\n', 'utf8');
  assert.match(decodeEsBuffer(utf8, { query: 'бз доки' }), /бз доки/);

  const prefix = 'Filename\r\n"C:\\Users\\maxob\\Desktop\\';
  const suffix = '\\"\r\n';
  const cp866 = encodedCsv(prefix, 'a1a720a4aeaaa8', suffix);
  const windows1251 = encodedCsv(prefix, 'e1e720e4eeeae8', suffix);
  assert.match(decodeEsBuffer(cp866, { query: 'бз доки' }), /бз доки/);
  assert.match(decodeEsBuffer(windows1251, { query: 'бз доки' }), /бз доки/);
  assert.strictEqual(decodeEsBuffer(Buffer.from('Filename\r\n', 'ascii')), 'Filename\r\n');
}

async function testInvalidBufferedOutput() {
  const result = await searchEverything({ query: 'бз доки', targetType: 'directory' }, {
    esPath: path.resolve('C:\\Tools\\es.exe'),
    existsSync: () => true,
    execFile: async () => ({
      ok: true,
      code: 0,
      stdout: Buffer.from([0xa1, 0xa7]),
      stderr: Buffer.alloc(0),
    }),
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'everything_output_invalid');
}

async function testAutoStartAndRetry() {
  const esPath = path.resolve('C:\\Program Files\\Everything\\es.exe');
  const everythingPath = path.resolve('C:\\Program Files\\Everything\\Everything.exe');
  let calls = 0;
  let starts = 0;
  const result = await searchEverything({ query: 'Test', targetType: 'directory' }, {
    esPath,
    everythingPath,
    existsSync: () => true,
    delay: async () => {},
    startEverything: async (target) => {
      starts++;
      assert.strictEqual(target, everythingPath);
    },
    execFile: async (_file, args) => {
      calls++;
      if (calls === 1) return { ok: false, code: 8, stdout: '', stderr: '' };
      if (args.includes('file:')) return { ok: true, code: 0, stdout: '', stderr: '' };
      return {
        ok: true,
        code: 0,
        stdout: 'Filename,Size,Date Modified,Attributes\r\n"C:\\Users\\maxob\\Desktop\\Test",0,2026-08-31T10:00:00.000Z,D',
        stderr: '',
      };
    },
  });
  assert.strictEqual(starts, 1);
  assert.strictEqual(calls, 3);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.results[0].type, 'directory');
}

async function run() {
  testQueryConstruction();
  testDiscovery();
  testCsv();
  testOutputDecoding();
  await testInvalidBufferedOutput();
  await testAutoStartAndRetry();
  console.log('[testEverythingSearch] tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
