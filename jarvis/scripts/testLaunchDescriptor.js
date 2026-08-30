const assert = require('assert');
const { normalizeLaunchDescriptor, canonicalizeLaunchDescriptor } = require('../tools/launchDescriptor');

const exe = normalizeLaunchDescriptor({ type: 'exe', target: 'C:\\Apps\\Demo.exe', args: ['--safe'] });
assert.strictEqual(exe.type, 'exe');
assert.strictEqual(exe.target, 'C:\\Apps\\Demo.exe');
assert.deepStrictEqual(exe.args, ['--safe']);
assert.strictEqual(
  canonicalizeLaunchDescriptor(exe),
  canonicalizeLaunchDescriptor({ type: 'EXE', target: 'c:\\apps\\demo.exe', args: ['--safe'] }),
);
assert.strictEqual(normalizeLaunchDescriptor({ type: 'steam', target: '570' }).target, '570');
assert.strictEqual(normalizeLaunchDescriptor({ type: 'epic', target: 'Fortnite' }).target, 'Fortnite');
assert.strictEqual(normalizeLaunchDescriptor({ type: 'uwp', target: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' }).type, 'uwp');
assert.throws(() => normalizeLaunchDescriptor({ type: 'exe', target: 'demo.exe' }), /absolute local path/);
assert.throws(() => normalizeLaunchDescriptor({ type: 'command', target: '\\\\server\\tool.exe' }), /absolute local path/);
assert.throws(() => normalizeLaunchDescriptor({ type: 'steam', target: '570 & calc' }), /numeric/);
assert.throws(() => normalizeLaunchDescriptor({ type: 'epic', target: 'game?action=evil' }), /unsafe/);

console.log('testLaunchDescriptor: ok');
