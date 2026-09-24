const assert = require('assert');
const { parseIntent } = require('../voice/intentParser');
const { executeIntent } = require('../actions/executeIntent');

async function testParsesTranslateSelectedCommand() {
  const direct = parseIntent('переведи выделенное');
  assert.strictEqual(direct.ok, true);
  assert.strictEqual(direct.action, 'translate_selected');

  const withWake = parseIntent('джарвис переведи выделенное');
  assert.strictEqual(withWake.ok, true);
  assert.strictEqual(withWake.action, 'translate_selected');

  const voskVariant = parseIntent('переведи выделенная джарвис');
  assert.strictEqual(voskVariant.ok, true);
  assert.strictEqual(voskVariant.action, 'translate_selected');

  const shortVariant = parseIntent('переведи выделено');
  assert.strictEqual(shortVariant.ok, true);
  assert.strictEqual(shortVariant.action, 'translate_selected');
}

async function testExecutesTranslateSelectedThroughHandler() {
  let calls = 0;
  const result = await executeIntent(
    { ok: true, action: 'translate_selected', rawText: 'переведи выделенное' },
    {
      translateSelectedText: async () => {
        calls++;
        return {
          ok: true,
          type: 'translate',
          title: 'Перевод выделенного',
          content: 'готовый перевод',
        };
      },
    }
  );

  assert.strictEqual(calls, 1);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.type, 'translate');
  assert.strictEqual(result.content, 'готовый перевод');
}

async function main() {
  await testParsesTranslateSelectedCommand();
  await testExecutesTranslateSelectedThroughHandler();
  console.log('testTranslateSelectedIntent: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
