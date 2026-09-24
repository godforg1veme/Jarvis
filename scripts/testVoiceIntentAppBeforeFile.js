const assert = require('assert');
const { parseIntent } = require('../voice/intentParser');

assert.deepStrictEqual(parseIntent('джарвис открой браузер'), {
  ok: true,
  action: 'launch_app',
  appId: 'browser',
  confidence: 0.95,
  source: 'regex',
  rawText: 'джарвис открой браузер',
});

assert.deepStrictEqual(parseIntent('джарвис открой файр фокс'), {
  ok: true,
  action: 'launch_app',
  appId: 'firefox',
  confidence: 0.95,
  source: 'regex',
  rawText: 'джарвис открой файр фокс',
});

assert.deepStrictEqual(parseIntent('джарвис открой фйар фокс'), {
  ok: true,
  action: 'launch_app',
  appId: 'firefox',
  confidence: 0.95,
  source: 'regex',
  rawText: 'джарвис открой фйар фокс',
});

const fileIntent = parseIntent('джарвис открой файл report.pdf в документах');
assert.strictEqual(fileIntent.ok, true);
assert.strictEqual(fileIntent.action, 'open_file');
assert.strictEqual(fileIntent.query, 'report.pdf');

console.log('[test] voice app intents win before generic file open OK');
