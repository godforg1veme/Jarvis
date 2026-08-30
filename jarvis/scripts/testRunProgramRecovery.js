const assert = require('assert');
const appResolver = require('../tools/appResolver');

const originalResolve = appResolver.resolve;
appResolver.resolve = () => ({ ok: false, notFound: true, message: 'not found' });
delete require.cache[require.resolve('../tools/runProgram')];
const runProgram = require('../tools/runProgram');

(async () => {
  const result = await runProgram.execute({ app: 'открой Obscure Portable App' });
  assert.strictEqual(result.needsRecovery, true);
  assert.strictEqual(result.inputChannel, 'text');
  assert.strictEqual(result.query, 'открой Obscure Portable App');
  assert.strictEqual(runProgram.isExplicitLaunchRequest('запусти demo'), true);
  assert.strictEqual(runProgram.isExplicitLaunchRequest('расскажи о demo'), false);
  console.log('testRunProgramRecovery: ok');
})().finally(() => {
  appResolver.resolve = originalResolve;
  delete require.cache[require.resolve('../tools/runProgram')];
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
