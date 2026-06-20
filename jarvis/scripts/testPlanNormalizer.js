const assert = require('assert');

const {
  normalizePlanDraft,
  normalizePlanEvent,
  policyForPlanAction,
} = require('../agents/planNormalizer');
const { POLICY } = require('../agents/toolGateway');

function run() {
  assert.strictEqual(policyForPlanAction('file.move', 'observe'), POLICY.CONFIRM);
  assert.strictEqual(policyForPlanAction('file.create_text_file', 'observe'), POLICY.CONFIRM);
  assert.strictEqual(policyForPlanAction('ask_user', ''), POLICY.OBSERVE);

  const normalized = normalizePlanDraft([
    { id: 'search', title: 'Search', action: 'file.search' },
    { id: 'move', title: 'Move', action: 'file.move_batch', depends_on: ['search'] },
    { id: 'bad', title: 'Bad', action: 'file.move', dependsOn: ['missing'] },
  ]);

  assert.strictEqual(normalized.plan.length, 3);
  assert.strictEqual(normalized.plan[0].policy, POLICY.OBSERVE);
  assert.strictEqual(normalized.plan[1].policy, POLICY.STRONG);
  assert.strictEqual(normalized.plan[1].requiresStrongConfirmation, true);
  assert.strictEqual(normalized.plan[2].enabled, false);
  assert(normalized.dependencyErrors.some((error) => error.dependencyId === 'missing'));

  const limited = normalizePlanDraft(
    Array.from({ length: 12 }, (_, index) => ({ id: `s${index}`, action: 'report' })),
    { maxSteps: 10 },
  );
  assert.strictEqual(limited.plan.length, 10);
  assert.strictEqual(limited.warnings.length, 1);

  const event = normalizePlanEvent({
    type: 'plan_draft',
    payload: {
      state: { plan: [{ id: 'x', action: 'ask_user' }] },
    },
  });
  assert.strictEqual(event.payload.plan[0].policy, POLICY.OBSERVE);
  assert.strictEqual(event.payload.state.plan[0].action, 'ask_user');

  console.log('[testPlanNormalizer] plan normalizer tests passed');
}

run();
