const assert = require('assert');

async function loadVoiceServiceWithExecuteStub(executeIntent) {
  const executeIntentPath = require.resolve('../actions/executeIntent');
  const voiceServicePath = require.resolve('../voice/voiceService');

  delete require.cache[voiceServicePath];
  require.cache[executeIntentPath] = {
    id: executeIntentPath,
    filename: executeIntentPath,
    loaded: true,
    exports: { executeIntent },
  };

  return require('../voice/voiceService').VoiceService;
}

async function testVoiceResultIsSpokenWhenEnabled() {
  const VoiceService = await loadVoiceServiceWithExecuteStub(async () => ({
    ok: true,
    message: 'Запускаю Блокнот.',
  }));

  const spoken = [];
  const service = new VoiceService({
    ttsService: {
      getSettings: () => ({ speakVoiceResults: true }),
      speak: async text => spoken.push(text),
    },
  });

  service.broadcastStatus = () => {};
  await service._handleFinalResult('jarvis запусти notepad');

  assert.deepStrictEqual(spoken, ['Запускаю Блокнот.']);
}

async function testVoiceResultIsNotSpokenWhenDisabled() {
  const VoiceService = await loadVoiceServiceWithExecuteStub(async () => ({
    ok: true,
    message: 'Запускаю Блокнот.',
  }));

  const spoken = [];
  const service = new VoiceService({
    ttsService: {
      getSettings: () => ({ speakVoiceResults: false }),
      speak: async text => spoken.push(text),
    },
  });

  service.broadcastStatus = () => {};
  await service._handleFinalResult('jarvis запусти notepad');

  assert.deepStrictEqual(spoken, []);
}

async function testVoiceEnablePreparesTtsWhenVoiceResultsEnabled() {
  const VoiceService = await loadVoiceServiceWithExecuteStub(async () => ({
    ok: true,
    message: 'Р“РѕС‚РѕРІРѕ.',
  }));

  let prepareCalls = 0;
  const service = new VoiceService({
    ttsService: {
      getSettings: () => ({ speakVoiceResults: true }),
      prepare: async () => {
        prepareCalls++;
        return { ok: true };
      },
      speak: async () => {},
    },
  });

  service.broadcastStatus = () => {};
  service.startWorker = () => true;
  service.createAudioCaptureWindow = () => {};
  service.startAudioCapture = () => {};
  service._scheduleAudioCaptureStart = () => {};
  service.notifyStateChange = () => {};

  service.enable();
  await new Promise(resolve => setImmediate(resolve));

  assert.strictEqual(prepareCalls, 1);
}

async function main() {
  await testVoiceResultIsSpokenWhenEnabled();
  await testVoiceResultIsNotSpokenWhenDisabled();
  await testVoiceEnablePreparesTtsWhenVoiceResultsEnabled();
  console.log('testVoiceServiceTts: ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
