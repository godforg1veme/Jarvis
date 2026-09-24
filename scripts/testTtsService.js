const assert = require('assert');
const path = require('path');

const { createPiperService, resolveSettings } = require('../tts/piperService');

function createSpawnStub(exitCode = 0) {
  const calls = [];

  function spawn(command, args, options) {
    const handlers = {};
    const stdinChunks = [];
    const child = {
      stdin: {
        writable: true,
        end(value) {
          stdinChunks.push(value);
        },
      },
      stdout: { on() {} },
      stderr: { on() {} },
      on(event, handler) {
        handlers[event] = handler;
        if (event === 'exit') {
          setImmediate(() => handler(exitCode));
        }
      },
    };

    calls.push({ command, args, options, stdinChunks, child });
    return child;
  }

  return { spawn, calls };
}

async function testResolveSettingsUsesProjectDefaults() {
  const settings = resolveSettings({}, {
    projectRoot: 'C:\\jarvis',
  });

  assert.strictEqual(settings.enabled, true);
  assert.strictEqual(settings.provider, 'piper');
  assert.strictEqual(settings.command, 'py');
  assert.deepStrictEqual(settings.args, ['-m', 'piper']);
  assert.strictEqual(settings.voice, 'ru_RU-irina-medium');
  assert.strictEqual(settings.modelPath, path.join('C:\\jarvis', 'voices', 'piper', 'ru_RU-irina-medium.onnx'));
  assert.strictEqual(settings.configPath, path.join('C:\\jarvis', 'voices', 'piper', 'ru_RU-irina-medium.onnx.json'));
}

async function testSpeakSynthesizesThenPlaysWav() {
  const synthSpawn = createSpawnStub(0);
  const playSpawn = createSpawnStub(0);
  const writtenFiles = [];
  const removedFiles = [];

  const service = createPiperService({
    projectRoot: 'C:\\jarvis',
    settings: {
      enabled: true,
      command: 'py',
      args: ['-m', 'piper'],
      voice: 'ru_RU-irina-medium',
      outputDir: 'data/tts-cache',
    },
    spawn: (command, args, options) => {
      if (command === 'powershell.exe') return playSpawn.spawn(command, args, options);
      return synthSpawn.spawn(command, args, options);
    },
    fs: {
      existsSync: () => true,
      mkdirSync: () => {},
      statSync: () => ({ size: 12000 }),
      unlinkSync: filePath => removedFiles.push(filePath),
    },
    writeFileSync: (filePath, content) => writtenFiles.push({ filePath, content }),
    now: () => 1234567890,
  });

  const result = await service.speak('Запускаю браузер.');

  assert.strictEqual(result.ok, true);
  assert.strictEqual(synthSpawn.calls.length, 1);
  assert.strictEqual(playSpawn.calls.length, 1);
  assert.deepStrictEqual(synthSpawn.calls[0].args.slice(0, 2), ['-m', 'piper']);
  assert(synthSpawn.calls[0].args.includes('-m'));
  assert(synthSpawn.calls[0].args.includes(path.join('C:\\jarvis', 'voices', 'piper', 'ru_RU-irina-medium.onnx')));
  assert(synthSpawn.calls[0].args.includes('-c'));
  assert(synthSpawn.calls[0].args.includes(path.join('C:\\jarvis', 'voices', 'piper', 'ru_RU-irina-medium.onnx.json')));
  assert(synthSpawn.calls[0].args.includes('-f'));
  assert.deepStrictEqual(synthSpawn.calls[0].stdinChunks, ['Запускаю браузер.']);
  assert.strictEqual(writtenFiles.length, 0);
  assert.strictEqual(removedFiles.length, 1);
}

async function testSpeakSkipsWhenDisabled() {
  const synthSpawn = createSpawnStub(0);
  const service = createPiperService({
    settings: { enabled: false },
    spawn: synthSpawn.spawn,
  });

  const result = await service.speak('Не говори это.');

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(synthSpawn.calls.length, 0);
}

async function main() {
  await testResolveSettingsUsesProjectDefaults();
  await testSpeakSynthesizesThenPlaysWav();
  await testSpeakSkipsWhenDisabled();
  console.log('testTtsService: ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
