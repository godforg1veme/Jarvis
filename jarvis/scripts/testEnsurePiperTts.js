const assert = require('assert');
const path = require('path');

const { ensurePiperTts } = require('./ensurePiperTts');

function createFs(existing = []) {
  const files = new Set(existing);
  const dirs = [];

  return {
    existsSync(filePath) {
      return files.has(filePath);
    },
    mkdirSync(dirPath) {
      dirs.push(dirPath);
    },
    readFileSync(filePath) {
      if (filePath.endsWith('tts-settings.json')) {
        return JSON.stringify({
          voice: 'ru_RU-irina-medium',
          voiceDir: 'voices/piper',
        });
      }
      throw new Error(`Unexpected read: ${filePath}`);
    },
    _files: files,
    _dirs: dirs,
  };
}

function createRunStub(results = []) {
  const calls = [];

  function run(command, args) {
    calls.push({ command, args });
    const result = results.length ? results.shift() : { status: 0 };
    if (result.after) result.after();
    return result;
  }

  return { run, calls };
}

async function testSkipsInstallAndDownloadWhenReady() {
  const projectRoot = 'C:\\jarvis';
  const voiceDir = path.join(projectRoot, 'voices', 'piper');
  const fs = createFs([
    path.join(projectRoot, 'data', 'tts-settings.json'),
    path.join(voiceDir, 'ru_RU-irina-medium.onnx'),
    path.join(voiceDir, 'ru_RU-irina-medium.onnx.json'),
  ]);
  const runner = createRunStub([{ status: 0 }]);

  const result = ensurePiperTts({ projectRoot, fs, run: runner.run, log: () => {} });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.installed, false);
  assert.strictEqual(result.downloaded, false);
  assert.deepStrictEqual(runner.calls, [
    { command: 'py', args: ['-m', 'piper', '--help'] },
  ]);
}

async function testInstallsAndDownloadsWhenMissing() {
  const projectRoot = 'C:\\jarvis';
  const voiceDir = path.join(projectRoot, 'voices', 'piper');
  const modelPath = path.join(voiceDir, 'ru_RU-irina-medium.onnx');
  const configPath = path.join(voiceDir, 'ru_RU-irina-medium.onnx.json');
  const fs = createFs([
    path.join(projectRoot, 'data', 'tts-settings.json'),
  ]);
  const runner = createRunStub([
    { status: 1 },
    { status: 0 },
    {
      status: 0,
      after: () => {
        fs._files.add(modelPath);
        fs._files.add(configPath);
      },
    },
  ]);

  const result = ensurePiperTts({ projectRoot, fs, run: runner.run, log: () => {} });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.installed, true);
  assert.strictEqual(result.downloaded, true);
  assert.deepStrictEqual(runner.calls, [
    { command: 'py', args: ['-m', 'piper', '--help'] },
    { command: 'py', args: ['-m', 'pip', 'install', '--user', 'piper-tts'] },
    { command: 'py', args: ['-m', 'piper.download_voices', '--download-dir', voiceDir, 'ru_RU-irina-medium'] },
  ]);
}

async function main() {
  await testSkipsInstallAndDownloadWhenReady();
  await testInstallsAndDownloadsWhenMissing();
  console.log('testEnsurePiperTts: ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
