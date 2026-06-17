const assert = require('assert');
const { EventEmitter } = require('events');
const path = require('path');

const { createSileroService, resolveSettings } = require('../tts/sileroService');

function createSpawnStub(exitCode = 0) {
  const calls = [];

  function spawn(command, args, options) {
    const child = {
      stdin: {
        writable: true,
        end(value) {
          child.stdinChunks.push(value);
        },
      },
      stdinChunks: [],
      stdout: { on() {} },
      stderr: { on() {} },
      on(event, handler) {
        if (event === 'exit') setImmediate(() => handler(exitCode));
      },
    };

    calls.push({ command, args, options, child });
    return child;
  }

  return { spawn, calls };
}

async function testResolveSettingsUsesBayaDefaults() {
  const settings = resolveSettings({}, {
    projectRoot: 'C:\\jarvis',
  });

  assert.strictEqual(settings.provider, 'silero');
  assert.strictEqual(settings.command, 'py');
  assert.strictEqual(settings.speaker, 'baya');
  assert.strictEqual(settings.sampleRate, 48000);
  assert.strictEqual(settings.persistentWorker, true);
  assert.strictEqual(settings.modelPath, path.join('C:\\jarvis', 'voices', 'silero', 'v5_ru.pt'));
}

async function testSpeakRunsSileroScriptAndPlaysWav() {
  const synthSpawn = createSpawnStub(0);
  const playSpawn = createSpawnStub(0);
  const removedFiles = [];

  const service = createSileroService({
    projectRoot: 'C:\\jarvis',
    settings: {
      enabled: true,
      provider: 'silero',
      command: 'py',
      speaker: 'baya',
      outputDir: 'data/tts-cache',
      persistentWorker: false,
    },
    spawn: (command, args, options) => {
      if (command === 'powershell.exe') return playSpawn.spawn(command, args, options);
      return synthSpawn.spawn(command, args, options);
    },
    fs: {
      existsSync: () => true,
      mkdirSync: () => {},
      statSync: () => ({ size: 16000 }),
      unlinkSync: filePath => removedFiles.push(filePath),
    },
    now: () => 222,
  });

  const result = await service.speak('Запускаю приложение.');

  assert.strictEqual(result.ok, true);
  assert.strictEqual(synthSpawn.calls.length, 1);
  assert.strictEqual(playSpawn.calls.length, 1);
  assert.strictEqual(synthSpawn.calls[0].command, 'py');
  assert(synthSpawn.calls[0].args.includes(path.join('C:\\jarvis', 'scripts', 'sileroSpeak.py')));
  assert(synthSpawn.calls[0].args.includes('--model-path'));
  assert(synthSpawn.calls[0].args.includes(path.join('C:\\jarvis', 'voices', 'silero', 'v5_ru.pt')));
  assert(synthSpawn.calls[0].args.includes('--speaker'));
  assert(synthSpawn.calls[0].args.includes('baya'));
  assert(synthSpawn.calls[0].args.includes('--sample-rate'));
  assert(synthSpawn.calls[0].args.includes('48000'));
  assert.deepStrictEqual(synthSpawn.calls[0].child.stdinChunks, ['Запускаю приложение.']);
  assert.strictEqual(removedFiles.length, 1);
}

async function testSpeakReusesPersistentSileroWorker() {
  const synthCalls = [];
  const playSpawn = createSpawnStub(0);
  const removedFiles = [];
  let nowValue = 1000;

  function spawn(command, args, options) {
    if (command === 'powershell.exe') return playSpawn.spawn(command, args, options);

    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = new EventEmitter();
    child.stdout = stdout;
    child.stderr = stderr;
    child.stdin = {
      writable: true,
      write(value) {
        for (const line of String(value).trim().split('\n')) {
          if (!line) continue;
          const request = JSON.parse(line);
          setImmediate(() => {
            stdout.emit('data', `${JSON.stringify({ id: request.id, ok: true, outputFile: request.outputFile })}\n`);
          });
        }
        return true;
      },
    };
    child.kill = () => {};
    synthCalls.push({ command, args, options, child });
    setImmediate(() => {
      stdout.emit('data', `${JSON.stringify({ type: 'ready' })}\n`);
    });
    return child;
  }

  const service = createSileroService({
    projectRoot: 'C:\\jarvis',
    settings: {
      enabled: true,
      provider: 'silero',
      command: 'py',
      speaker: 'baya',
      outputDir: 'data/tts-cache',
      persistentWorker: true,
    },
    spawn,
    fs: {
      existsSync: () => true,
      mkdirSync: () => {},
      statSync: () => ({ size: 16000 }),
      unlinkSync: filePath => removedFiles.push(filePath),
    },
    now: () => nowValue++,
  });

  await service.speak('РџРµСЂРІР°СЏ С„СЂР°Р·Р°.');
  await service.speak('Р’С‚РѕСЂР°СЏ С„СЂР°Р·Р°.');

  assert.strictEqual(synthCalls.length, 1);
  assert.strictEqual(playSpawn.calls.length, 2);
  assert(synthCalls[0].args.includes(path.join('C:\\jarvis', 'scripts', 'sileroWorker.py')));
  assert.strictEqual(removedFiles.length, 2);
}

async function testPrepareRunsSilentWorkerWarmup() {
  const requests = [];
  const synthCalls = [];

  function spawn(command, args, options) {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = new EventEmitter();
    child.stdout = stdout;
    child.stderr = stderr;
    child.stdin = {
      writable: true,
      write(value) {
        for (const line of String(value).trim().split('\n')) {
          if (!line) continue;
          const request = JSON.parse(line);
          requests.push(request);
          setImmediate(() => {
            stdout.emit('data', `${JSON.stringify({ id: request.id, ok: true, outputFile: request.outputFile })}\n`);
          });
        }
        return true;
      },
    };
    child.kill = () => {};
    synthCalls.push({ command, args, options, child });
    setImmediate(() => {
      stdout.emit('data', `${JSON.stringify({ type: 'ready' })}\n`);
    });
    return child;
  }

  const removedFiles = [];
  const service = createSileroService({
    projectRoot: 'C:\\jarvis',
    settings: {
      enabled: true,
      provider: 'silero',
      command: 'py',
      outputDir: 'data/tts-cache',
      persistentWorker: true,
      warmupText: 'warmup',
    },
    spawn,
    fs: {
      existsSync: () => true,
      mkdirSync: () => {},
      statSync: () => ({ size: 16000 }),
      unlinkSync: filePath => removedFiles.push(filePath),
    },
    now: () => 333,
  });

  const result = await service.prepare();

  assert.strictEqual(result.ok, true);
  assert.strictEqual(synthCalls.length, 1);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].text, 'warmup');
  assert(requests[0].outputFile.endsWith(path.join('data', 'tts-cache', '333-silero-warmup.wav')));
  assert.strictEqual(removedFiles.length, 1);
}

async function testSpeakSkipsWhenProviderIsNotSilero() {
  const synthSpawn = createSpawnStub(0);
  const service = createSileroService({
    settings: { provider: 'piper' },
    spawn: synthSpawn.spawn,
  });

  const result = await service.speak('Не говорить.');

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(synthSpawn.calls.length, 0);
}

async function main() {
  await testResolveSettingsUsesBayaDefaults();
  await testSpeakRunsSileroScriptAndPlaysWav();
  await testSpeakReusesPersistentSileroWorker();
  await testPrepareRunsSilentWorkerWarmup();
  await testSpeakSkipsWhenProviderIsNotSilero();
  console.log('testSileroService: ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
