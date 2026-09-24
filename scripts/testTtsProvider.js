const assert = require('assert');

const { createTtsService, resolveSettings } = require('../tts/ttsService');

async function testResolveSettingsDefaultsToSileroBayaWithPiperFallback() {
  const settings = resolveSettings({});

  assert.strictEqual(settings.enabled, true);
  assert.strictEqual(settings.provider, 'silero');
  assert.strictEqual(settings.fallbackProvider, 'piper');
  assert.strictEqual(settings.speakVoiceResults, true);
}

async function testSpeakUsesSileroProvider() {
  const calls = [];
  const service = createTtsService({
    settings: { enabled: true, provider: 'silero', fallbackProvider: 'piper' },
    sileroService: {
      speak: async text => {
        calls.push(['silero', text]);
        return { ok: true, provider: 'silero' };
      },
    },
    piperService: {
      speak: async text => {
        calls.push(['piper', text]);
        return { ok: true, provider: 'piper' };
      },
    },
  });

  const result = await service.speak('Привет');

  assert.deepStrictEqual(calls, [['silero', 'Привет']]);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.provider, 'silero');
}

async function testSpeakFallsBackToPiperWhenSileroFails() {
  const calls = [];
  const service = createTtsService({
    settings: { enabled: true, provider: 'silero', fallbackProvider: 'piper' },
    sileroService: {
      speak: async text => {
        calls.push(['silero', text]);
        throw new Error('silero failed');
      },
    },
    piperService: {
      speak: async text => {
        calls.push(['piper', text]);
        return { ok: true, provider: 'piper' };
      },
    },
  });

  const result = await service.speak('Привет');

  assert.deepStrictEqual(calls, [['silero', 'Привет'], ['piper', 'Привет']]);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.provider, 'piper');
  assert.strictEqual(result.fallbackFrom, 'silero');
}

async function testSpeakReusesCreatedProviderService() {
  let factoryCalls = 0;
  const spoken = [];
  const service = createTtsService({
    settings: { enabled: true, provider: 'silero', fallbackProvider: false },
    createSileroService: () => {
      factoryCalls++;
      return {
        speak: async text => {
          spoken.push(text);
          return { ok: true };
        },
      };
    },
  });

  await service.speak('РџРµСЂРІС‹Р№');
  await service.speak('Р’С‚РѕСЂРѕР№');

  assert.strictEqual(factoryCalls, 1);
  assert.deepStrictEqual(spoken, ['РџРµСЂРІС‹Р№', 'Р’С‚РѕСЂРѕР№']);
}

async function testPrepareWarmsCurrentProviderAndSpeakReusesIt() {
  let factoryCalls = 0;
  let prepareCalls = 0;
  const spoken = [];
  const service = createTtsService({
    settings: { enabled: true, provider: 'silero', fallbackProvider: false },
    createSileroService: () => {
      factoryCalls++;
      return {
        prepare: async () => {
          prepareCalls++;
          return { ok: true, warmed: true };
        },
        speak: async text => {
          spoken.push(text);
          return { ok: true };
        },
      };
    },
  });

  const prepareResult = await service.prepare();
  await service.speak('Р“РѕС‚РѕРІРѕ');

  assert.strictEqual(prepareResult.ok, true);
  assert.strictEqual(factoryCalls, 1);
  assert.strictEqual(prepareCalls, 1);
  assert.deepStrictEqual(spoken, ['Р“РѕС‚РѕРІРѕ']);
}

async function testSpeakSkipsWhenDisabled() {
  const service = createTtsService({
    settings: { enabled: false },
    sileroService: {
      speak: async () => {
        throw new Error('should not speak');
      },
    },
  });

  const result = await service.speak('Привет');

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.skipped, true);
}

async function main() {
  await testResolveSettingsDefaultsToSileroBayaWithPiperFallback();
  await testSpeakUsesSileroProvider();
  await testSpeakFallsBackToPiperWhenSileroFails();
  await testSpeakReusesCreatedProviderService();
  await testPrepareWarmsCurrentProviderAndSpeakReusesIt();
  await testSpeakSkipsWhenDisabled();
  console.log('testTtsProvider: ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
