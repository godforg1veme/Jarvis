const assert = require('node:assert/strict');
const test = require('node:test');
const { createWindowsSapiService } = require('./windowsSapiService');

test('Windows SAPI keeps user text out of the PowerShell command source', async () => {
  const calls = [];
  const child = {
    once(name, callback) {
      if (name === 'exit') setImmediate(() => callback(0));
      return this;
    },
  };
  const service = createWindowsSapiService({
    platform: 'win32',
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return child;
    },
  });
  await service.speak("текст; Remove-Item 'C:\\\\' ");
  assert.equal(calls[0].command, 'powershell.exe');
  assert.equal(calls[0].args.some((value) => String(value).includes('Remove-Item')), false);
  assert.equal(calls[0].options.windowsHide, true);
});
