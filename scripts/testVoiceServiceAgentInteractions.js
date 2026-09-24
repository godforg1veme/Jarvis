const assert = require('assert');
const { VoiceService } = require('../voice/voiceService');

function createService() {
  const spoken = [];
  const actions = [];
  let visible = true;
  const service = new VoiceService({
    ttsService: {
      getSettings: () => ({ speakVoiceResults: true }),
      speak: async (text) => spoken.push(text),
    },
    intentOptions: {
      isAgentTaskWindowVisible: () => visible,
      handleAgentVoiceAction: async (action, payload) => {
        actions.push({ action, payload });
        return { ok: true };
      },
    },
  });
  service._voiceEnabled = true;
  service.broadcastStatus = () => {};
  return { service, spoken, actions, setVisible: (value) => { visible = value; } };
}

function needsInputEvent(taskId = 'voice-input') {
  return {
    type: 'needs_input',
    task_id: taskId,
    payload: {
      state: {
        plan: [{
          id: 'choose',
          action: 'ask_user',
          enabled: true,
          args: { question: 'Куда сохранить?', choices: ['Документы', 'Рабочий стол'] },
        }],
      },
    },
  };
}

function needsConfirmationEvent(strong, taskId = 'voice-confirm') {
  return {
    type: 'needs_confirmation',
    task_id: taskId,
    payload: {
      result: strong ? { requiresStrongConfirmation: true } : { requiresConfirmation: true },
    },
  };
}

async function testNumberedAskUserSelection() {
  const { service, spoken, actions } = createService();
  await service.handleAgentTaskEvent(needsInputEvent());
  assert(spoken[0].includes('Куда сохранить?'));
  assert(spoken[0].includes('2: Рабочий стол'));

  const handled = await service.handlePendingVoiceResponse('выбираю второй');
  assert.strictEqual(handled, true);
  assert.deepStrictEqual(actions[0], {
    action: 'user_choice',
    payload: { taskId: 'voice-input', index: 1, choice: 'Рабочий стол' },
  });
  assert.strictEqual(service.pendingAgentInput, null);
}

async function testAgentWindowMustBeVisible() {
  const { service, actions, setVisible } = createService();
  await service.handleAgentTaskEvent(needsInputEvent('hidden-task'));
  setVisible(false);
  await service.handlePendingVoiceResponse('первый');
  assert.strictEqual(actions.length, 0);
  assert(service.pendingAgentInput);
}

async function testOrdinaryAgentConfirmation() {
  const { service, actions } = createService();
  await service.handleAgentTaskEvent(needsConfirmationEvent(false, 'ordinary-task'));
  await service.handlePendingVoiceResponse('да');
  assert.deepStrictEqual(actions[0], { action: 'confirm', payload: { taskId: 'ordinary-task' } });
}

async function testStrongConfirmationRequiresTwoExactPhrases() {
  const { service, actions } = createService();
  await service.handleAgentTaskEvent(needsConfirmationEvent(true, 'strong-task'));

  await service.handlePendingVoiceResponse('да');
  assert.strictEqual(actions.length, 0);
  assert.strictEqual(service.pendingAgentConfirmation.stage, 'understand');

  await service.handlePendingVoiceResponse('я понимаю');
  assert.strictEqual(actions.length, 0);
  assert.strictEqual(service.pendingAgentConfirmation.stage, 'understand');

  await service.handlePendingVoiceResponse('понимаю');
  assert.strictEqual(actions.length, 0);
  assert.strictEqual(service.pendingAgentConfirmation.stage, 'confirm');

  await service.handlePendingVoiceResponse('точно подтверждаю');
  assert.strictEqual(actions.length, 0);
  assert.strictEqual(service.pendingAgentConfirmation.stage, 'confirm');

  await service.handlePendingVoiceResponse('подтверждаю');
  assert.deepStrictEqual(actions[0], { action: 'strong_confirm', payload: { taskId: 'strong-task' } });
  assert.strictEqual(service.pendingAgentConfirmation, null);
}

async function testCancelAndTerminalCleanup() {
  const first = createService();
  await first.service.handleAgentTaskEvent(needsConfirmationEvent(true, 'cancel-task'));
  await first.service.handlePendingVoiceResponse('отмена');
  assert.deepStrictEqual(first.actions[0], { action: 'reject_confirmation', payload: { taskId: 'cancel-task' } });

  const second = createService();
  await second.service.handleAgentTaskEvent(needsInputEvent('finished-task'));
  await second.service.handleAgentTaskEvent({ type: 'final_report', task_id: 'finished-task', payload: {} });
  assert.strictEqual(second.service.pendingAgentInput, null);
}

async function run() {
  await testNumberedAskUserSelection();
  await testAgentWindowMustBeVisible();
  await testOrdinaryAgentConfirmation();
  await testStrongConfirmationRequiresTwoExactPhrases();
  await testCancelAndTerminalCleanup();
  console.log('[testVoiceServiceAgentInteractions] agent voice interactions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
