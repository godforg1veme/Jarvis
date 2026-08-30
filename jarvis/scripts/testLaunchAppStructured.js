const assert = require('assert');
const { EventEmitter } = require('events');
const launchApp = require('../tools/launchApp');

function fakeSpawn(calls, outcome = 'spawn') {
  return (executable, args, options) => {
    calls.push({ executable, args, options });
    const child = new EventEmitter();
    child.unref = () => {};
    process.nextTick(() => {
      if (outcome === 'error') child.emit('error', new Error('spawn failed'));
      else if (outcome === 'exit1') {
        child.emit('spawn');
        child.emit('exit', 1);
      } else child.emit('spawn');
    });
    return child;
  };
}

(async () => {
  const calls = [];
  const exe = await launchApp.launchDescriptor(
    { type: 'exe', target: 'C:\\Apps\\Demo.exe', args: ['--safe'] },
    { name: 'Demo', existsSync: () => true, spawn: fakeSpawn(calls), observeMs: 0 },
  );
  assert.strictEqual(exe.ok, true);
  assert.deepStrictEqual(calls[0].args, ['--safe']);
  assert.strictEqual(calls[0].options.shell, false);

  const scriptCalls = [];
  await launchApp.launchDescriptor(
    { type: 'script', target: 'C:\\Scripts\\demo.ps1', interpreter: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', args: ['-NoProfile'] },
    { name: 'Script', existsSync: () => true, spawn: fakeSpawn(scriptCalls), observeMs: 0 },
  );
  assert.deepStrictEqual(scriptCalls[0].args.slice(0, 4), ['-NoProfile', '-NonInteractive', '-File', 'C:\\Scripts\\demo.ps1']);
  assert.strictEqual(scriptCalls[0].options.shell, false);

  const steam = launchApp.descriptorCommand({ type: 'steam', target: '570', args: [] });
  assert.deepStrictEqual(steam, {
    executable: launchApp.windowsSystemPath('explorer.exe'),
    args: ['steam://rungameid/570'],
  });
  const epic = launchApp.descriptorCommand({ type: 'epic', target: 'Fortnite', args: [] });
  assert.strictEqual(epic.args[0], 'com.epicgames.launcher://apps/Fortnite?action=launch&silent=true');

  const failed = await launchApp.launchDescriptor(
    { type: 'exe', target: 'C:\\Apps\\Demo.exe', args: [] },
    { name: 'Demo', existsSync: () => true, spawn: fakeSpawn([], 'exit1'), observeMs: 0 },
  );
  assert.strictEqual(failed.ok, false);

  const missing = await launchApp.launchDescriptor(
    { type: 'exe', target: 'C:\\Apps\\Missing.exe', args: [] },
    { name: 'Missing', existsSync: () => false, spawn: fakeSpawn([]), observeMs: 0 },
  );
  assert.strictEqual(missing.ok, false);

  const commandCalls = [];
  const command = await launchApp.launch(
    { name: 'Demo command', type: 'command', command: 'demo' },
    {
      execFileSync: () => 'C:\\Tools\\demo.exe\r\n',
      existsSync: () => true,
      spawn: fakeSpawn(commandCalls),
      observeMs: 0,
    },
  );
  assert.strictEqual(command.ok, true);
  assert.strictEqual(commandCalls[0].executable, 'C:\\Tools\\demo.exe');
  assert.strictEqual(commandCalls[0].options.shell, false);

  const unsafeBatch = await launchApp.launchDescriptor(
    {
      type: 'script',
      target: 'C:\\Scripts\\demo.cmd',
      interpreter: 'C:\\Windows\\System32\\cmd.exe',
      args: ['safe&calc.exe'],
    },
    { name: 'Unsafe batch', existsSync: () => true, spawn: fakeSpawn([]), observeMs: 0 },
  );
  assert.strictEqual(unsafeBatch.ok, false);
  assert.match(unsafeBatch.error, /unsafe cmd\.exe metacharacters/);

  console.log('testLaunchAppStructured: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
