const assert = require('assert');
const { VoiceService } = require('../voice/voiceService');

function createService() {
  const spoken = [];
  const actions = [];
  const service = new VoiceService({
    ttsService: {
      getSettings: () => ({ speakVoiceResults: true }),
      speak: async text => spoken.push(text),
    },
    intentOptions: {
      selectAppRecovery: async (recoveryId, candidateId) => {
        actions.push({ action: 'select', recoveryId, candidateId });
        return {
          recoveryId, state: 'awaiting_confirmation',
          candidates: [{ candidateId, displayName: 'Obsidian' }],
        };
      },
      confirmAppRecovery: async recoveryId => {
        actions.push({ action: 'confirm', recoveryId });
        return { recoveryId, state: 'completed', result: { message: 'Запустил Obsidian.' } };
      },
      cancelAppRecovery: async recoveryId => {
        actions.push({ action: 'cancel', recoveryId });
        return { recoveryId, state: 'cancelled' };
      },
    },
  });
  service.broadcastStatus = () => {};
  return { service, spoken, actions };
}

(async () => {
  const first = createService();
  first.service.pendingVoiceRecovery = {
    snapshot: {
      recoveryId: 'recovery-1', state: 'awaiting_selection',
      candidates: [
        { candidateId: 'candidate-1', displayName: 'Other' },
        { candidateId: 'candidate-2', displayName: 'Obsidian' },
      ],
    },
  };
  assert.strictEqual(await first.service.handlePendingVoiceResponse('второй'), true);
  assert.deepStrictEqual(first.actions[0], { action: 'select', recoveryId: 'recovery-1', candidateId: 'candidate-2' });
  assert(first.spoken.at(-1).includes('Запустить'));
  assert.strictEqual(await first.service.handlePendingVoiceResponse('да'), true);
  assert.deepStrictEqual(first.actions[1], { action: 'confirm', recoveryId: 'recovery-1' });
  assert.strictEqual(first.service.pendingVoiceRecovery, null);
  assert.strictEqual(first.service.isVoiceConfirm('никогда'), false);
  assert.strictEqual(first.service.isVoiceCancel('интернет'), false);

  const second = createService();
  second.service.pendingVoiceRecovery = {
    snapshot: { recoveryId: 'recovery-2', state: 'awaiting_confirmation', candidates: [{ candidateId: 'candidate-3', displayName: 'Demo' }] },
  };
  await second.service.handlePendingVoiceResponse('нет');
  assert.deepStrictEqual(second.actions[0], { action: 'cancel', recoveryId: 'recovery-2' });

  const third = createService();
  third.service.pendingVoiceRecovery = {
    snapshot: { recoveryId: 'recovery-3', state: 'awaiting_confirmation', candidates: [{ candidateId: 'candidate-4', displayName: 'Demo' }] },
  };
  assert.strictEqual(await third.service.handlePendingVoiceResponse('открой калькулятор'), false);
  assert.deepStrictEqual(third.actions[0], { action: 'cancel', recoveryId: 'recovery-3' });

  const fourth = createService();
  fourth.service.pendingVoiceRecovery = {
    snapshot: { recoveryId: 'recovery-4', state: 'awaiting_confirmation', candidates: [{ candidateId: 'candidate-5', displayName: 'Demo' }] },
  };
  assert.strictEqual(await fourth.service.handlePendingVoiceResponse('запусти'), true);
  assert.deepStrictEqual(fourth.actions[0], { action: 'confirm', recoveryId: 'recovery-4' });

  console.log('testVoiceAppRecovery: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
