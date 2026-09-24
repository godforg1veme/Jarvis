const assert = require('assert');
const path = require('path');

const { ensureTts } = require('./ensureTts');

function createFs(existing = []) {
  const files = new Set(existing);
  const dirs = [];

  return {
    existsSync(filePath) {
      return files.has(filePath);
    },
    mkdirSync(dirPath) {
      dirs.push(dirPath);
      files.add(dirPath);
    },
    readFileSync(filePath) {
      if (filePath.endsWith('tts-settings.json')) {
        return JSON.stringify({
          provider: 'silero',
          fallbackProvider: 'piper',
          model: 'v5_ru',
          modelDir: 'voices/silero',
          modelUrl: 'https://example.test/v5_ru.pt',
          speaker: 'baya',
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

async function testEnsuresSileroAndPiperFallback() {
  const projectRoot = 'C:\\jarvis';
  const sileroModel = path.join(projectRoot, 'voices', 'silero', 'v5_ru.pt');
  const piperModel = path.join(projectRoot, 'voices', 'piper', 'ru_RU-irina-medium.onnx');
  const piperConfig = `${piperModel}.json`;
  const fs = createFs([
    path.join(projectRoot, 'data', 'tts-settings.json'),
    piperModel,
    piperConfig,
  ]);
  const runner = createRunStub([
    { status: 0 },
    {
      status: 0,
      after: () => fs._files.add(sileroModel),
    },
    { status: 0 },
  ]);

  const result = ensureTts({ projectRoot, fs, run: runner.run, log: () => {} });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.provider, 'silero');
  assert.strictEqual(result.silero.downloaded, true);
  assert.strictEqual(result.piper.downloaded, false);
  assert.deepStrictEqual(runner.calls, [
    { command: 'py', args: ['-c', 'import torch, scipy'] },
    { command: 'py', args: ['-c', `import torch, pathlib; torch.hub.download_url_to_file('https://example.test/v5_ru.pt', r'${sileroModel}')`] },
    { command: 'py', args: ['-m', 'piper', '--help'] },
  ]);
}

async function main() {
  await testEnsuresSileroAndPiperFallback();
  console.log('testEnsureTts: ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
