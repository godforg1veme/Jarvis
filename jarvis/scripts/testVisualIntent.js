const assert = require('node:assert/strict');
const { parseIntent } = require('../voice/intentParser');
const { executeIntent } = require('../actions/executeIntent');
const {
  isVisualAnalyzeCommand,
  isVisualContinuationCommand,
  isClearVisualContextCommand,
} = require('../tools/visualCommandMatcher');
const { classifyVisualIntent } = require('../vision/visualIntent');

assert.deepEqual(classifyVisualIntent('Привет, как дела?'), { visual: false });
assert.deepEqual(classifyVisualIntent('Что ты видишь?'), { visual: true, target: 'all', kind: 'short' });
assert.deepEqual(classifyVisualIntent('Посмотри в камеру'), { visual: true, target: 'camera', kind: 'short' });
assert.deepEqual(classifyVisualIntent('Посмотри на оба монитора'), { visual: true, target: 'screen', kind: 'short' });
assert.deepEqual(classifyVisualIntent('Следи за камерой и экраном'), { visual: true, target: 'all', kind: 'active' });
assert.deepEqual(classifyVisualIntent('Я купил новую камеру'), { visual: false });

async function main() {
  assert.equal(isVisualAnalyzeCommand('посмотри сюда'), true);
  assert.equal(isVisualAnalyzeCommand('что за ошибка'), true);
  assert.equal(isVisualContinuationCommand('как исправить'), true);
  assert.equal(isVisualContinuationCommand('переведи это'), true);
  assert.equal(isClearVisualContextCommand('забудь экран'), true);

  const analyzeIntent = parseIntent('джарвис посмотри сюда');
  assert.equal(analyzeIntent.ok, true);
  assert.equal(analyzeIntent.action, 'visual_analyze');
  const continueIntent = parseIntent('что делать');
  assert.equal(continueIntent.ok, true);
  assert.equal(continueIntent.action, 'visual_continue');
  const clearIntent = parseIntent('очисти визуальный контекст');
  assert.equal(clearIntent.ok, true);
  assert.equal(clearIntent.action, 'clear_visual_context');

  let analyzeCalls = 0; let continueCalls = 0; let clearCalls = 0;
  const analyzed = await executeIntent(
    { ok: true, action: 'visual_analyze', rawText: 'посмотри сюда' },
    { analyzeVisualArea: async (command) => { analyzeCalls += 1; return { ok: true, type: 'visual', content: command }; } },
  );
  assert.equal(analyzeCalls, 1);
  assert.equal(analyzed.ok, true);
  const continued = await executeIntent(
    { ok: true, action: 'visual_continue', rawText: 'что делать' },
    { continueVisualDialog: async (command) => { continueCalls += 1; return { ok: true, type: 'visual', content: command }; } },
  );
  assert.equal(continueCalls, 1);
  assert.equal(continued.ok, true);
  const cleared = await executeIntent(
    { ok: true, action: 'clear_visual_context', rawText: 'забудь экран' },
    { clearVisualContext: async () => { clearCalls += 1; return { ok: true, type: 'visual' }; } },
  );
  assert.equal(clearCalls, 1);
  assert.equal(cleared.ok, true);
  console.log('Visual intent tests passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
