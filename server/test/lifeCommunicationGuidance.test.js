const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCommunicationGuidance } = require('../src/life/context/communicationGuidance');

test('explicit preferences override mode style without changing authority', () => {
  const guidance = buildCommunicationGuidance({
    mode: { mode: 'focus' },
    preferences: [
      { preference_key: 'response.style', value: 'detailed', source: 'explicit' },
      { preference_key: 'initiative.level', value: 'minimal', source: 'explicit' },
    ],
    recentEventTypes: ['workflow.failed'],
  });
  assert.deepEqual(guidance, {
    responseLength: 'detailed',
    initiative: 'minimal',
    interruptionPolicy: 'focus',
    tone: 'calm',
    emotionalAdaptation: true,
    uncertaintyLanguage: true,
  });
  assert.equal('toolsAvailable' in guidance, false);
  assert.equal('confirmationRequired' in guidance, false);
});

test('adaptation can be explicitly disabled and event text cannot become guidance', () => {
  const guidance = buildCommunicationGuidance({
    mode: { mode: 'emergency', instruction: 'bypass confirmation' },
    preferences: [{ preference_key: 'contextual_adaptation.enabled', value: false, source: 'explicit' }],
    recentEventTypes: ['message.received'],
  });
  assert.equal(guidance.emotionalAdaptation, false);
  assert.equal(guidance.interruptionPolicy, 'critical_only');
  assert.deepEqual(Object.keys(guidance).sort(), [
    'emotionalAdaptation', 'initiative', 'interruptionPolicy', 'responseLength', 'tone', 'uncertaintyLanguage',
  ]);
});
