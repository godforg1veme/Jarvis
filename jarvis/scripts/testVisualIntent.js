const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseIntent } = require('../voice/intentParser');
const { executeIntent } = require('../actions/executeIntent');
const {
  analyzeVisualArea,
  continueVisualDialog,
  clearVisualContext,
  getVisualContext,
  buildVisionMessages,
} = require('../tools/screenVisionAnalyzer');
const {
  isVisualAnalyzeCommand,
  isVisualContinuationCommand,
  isClearVisualContextCommand,
} = require('../tools/visualCommandMatcher');

function makeTempPng() {
  const filePath = path.join(os.tmpdir(), `jarvis-visual-test-${Date.now()}.png`);
  fs.writeFileSync(filePath, Buffer.from('fake-png'));
  return filePath;
}

async function testParsesVisualCommands() {
  assert.strictEqual(isVisualAnalyzeCommand('посмотри сюда'), true);
  assert.strictEqual(isVisualAnalyzeCommand('что за ошибка'), true);
  assert.strictEqual(isVisualContinuationCommand('как исправить'), true);
  assert.strictEqual(isVisualContinuationCommand('переведи это'), true);
  assert.strictEqual(isClearVisualContextCommand('забудь экран'), true);

  const analyze = parseIntent('джарвис посмотри сюда');
  assert.strictEqual(analyze.ok, true);
  assert.strictEqual(analyze.action, 'visual_analyze');

  const followup = parseIntent('что делать');
  assert.strictEqual(followup.ok, true);
  assert.strictEqual(followup.action, 'visual_continue');

  const clear = parseIntent('очисти визуальный контекст');
  assert.strictEqual(clear.ok, true);
  assert.strictEqual(clear.action, 'clear_visual_context');
}

async function testExecutesVisualHandlers() {
  let analyzeCalls = 0;
  let continueCalls = 0;
  let clearCalls = 0;

  const analyze = await executeIntent(
    { ok: true, action: 'visual_analyze', rawText: 'посмотри сюда' },
    {
      analyzeVisualArea: async (command) => {
        analyzeCalls += 1;
        return { ok: true, type: 'visual', content: command };
      },
    }
  );
  assert.strictEqual(analyzeCalls, 1);
  assert.strictEqual(analyze.ok, true);
  assert.strictEqual(analyze.type, 'visual');

  const followup = await executeIntent(
    { ok: true, action: 'visual_continue', rawText: 'что делать' },
    {
      continueVisualDialog: async (command) => {
        continueCalls += 1;
        return { ok: true, type: 'visual', content: command };
      },
    }
  );
  assert.strictEqual(continueCalls, 1);
  assert.strictEqual(followup.ok, true);

  const clear = await executeIntent(
    { ok: true, action: 'clear_visual_context', rawText: 'забудь экран' },
    {
      clearVisualContext: async () => {
        clearCalls += 1;
        return { ok: true, type: 'visual' };
      },
    }
  );
  assert.strictEqual(clearCalls, 1);
  assert.strictEqual(clear.ok, true);
}

async function testVisualContextFlow() {
  clearVisualContext({ warn() {}, log() {} });

  let chatCalls = 0;
  const cropPath = makeTempPng();
  const chatVision = async (messages) => {
    chatCalls += 1;
    assert.strictEqual(messages[0].role, 'system');
    const userMessage = messages[messages.length - 1];
    assert.strictEqual(userMessage.role, 'user');
    assert.ok(Array.isArray(userMessage.content));
    assert.ok(userMessage.content.some(part => part.type === 'image_url'));
    return chatCalls === 1 ? 'На изображении видна ошибка.' : 'Попробуйте прочитать текст ошибки.';
  };

  const result = await analyzeVisualArea('посмотри сюда', {
    captureScreenCrop: async () => ({
      cropPath,
      imageBytes: 128,
      imageSize: { width: 900, height: 600 },
      dataUrl: 'data:image/png;base64,ZmFrZQ==',
    }),
    chatVision,
    logger: { log() {}, error() {}, warn() {} },
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.type, 'visual');
  assert.ok(getVisualContext());

  const followup = await continueVisualDialog('что делать', {
    chatVision,
    logger: { log() {}, error() {}, warn() {} },
  });

  assert.strictEqual(followup.ok, true);
  assert.strictEqual(chatCalls, 2);
  assert.ok(getVisualContext().messages.length <= 3);

  clearVisualContext({ warn() {}, log() {} });
  assert.strictEqual(getVisualContext(), null);
}

function testBuildVisionMessages() {
  const messages = buildVisionMessages('что тут', 'data:image/png;base64,abc', [
    { role: 'user', content: 'посмотри сюда' },
    { role: 'assistant', content: 'Вижу окно.' },
  ]);
  assert.strictEqual(messages[0].role, 'system');
  assert.strictEqual(messages[messages.length - 1].role, 'user');
  assert.ok(messages[messages.length - 1].content.some(part => part.type === 'image_url'));
}

async function main() {
  await testParsesVisualCommands();
  await testExecutesVisualHandlers();
  await testVisualContextFlow();
  testBuildVisionMessages();
  console.log('testVisualIntent: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
