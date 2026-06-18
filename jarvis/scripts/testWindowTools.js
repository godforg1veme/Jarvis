const assert = require('assert');

const {
  SW_RESTORE,
  buildCloseWindowScript,
  buildListWindowsScript,
  buildMoveResizeScript,
  buildShowWindowScript,
  focusWindow,
  findWindows,
  listWindows,
  multiWindowLayout,
  snapRect,
} = require('../tools/windowTools');

function fakeExec(stdout, calls) {
  return (command, args, options, callback) => {
    calls.push({ command, args, options });
    callback(null, stdout, '');
  };
}

async function run() {
  const listScript = buildListWindowsScript();
  assert(listScript.includes('EnumWindows'));
  assert(listScript.includes('ConvertTo-Json'));

  const showScript = buildShowWindowScript(123, SW_RESTORE);
  assert(showScript.includes('[IntPtr]123'));
  assert(showScript.includes('ShowWindow'));
  assert(showScript.includes('SetForegroundWindow'));

  const moveScript = buildMoveResizeScript(123, { x: 1, y: 2, width: 300, height: 400 });
  assert(moveScript.includes('SetWindowPos'));
  assert(moveScript.includes('300'));

  const closeScript = buildCloseWindowScript(123);
  assert(closeScript.includes('PostMessage'));
  assert(closeScript.includes('0x0010'));

  const workArea = { x: 0, y: 0, width: 1000, height: 800 };
  assert.deepStrictEqual(snapRect('left', workArea), { x: 0, y: 0, width: 500, height: 800 });
  assert.deepStrictEqual(snapRect('bottom-right', workArea), { x: 500, y: 400, width: 500, height: 400 });
  assert.deepStrictEqual(multiWindowLayout('three-columns', { x: 0, y: 0, width: 999, height: 600 })[2], {
    x: 666,
    y: 0,
    width: 333,
    height: 600,
  });

  const calls = [];
  const windows = await listWindows({
    execFile: fakeExec(JSON.stringify([{ hwnd: 1, title: 'Code', processName: 'Code' }]), calls),
  });
  assert.strictEqual(windows[0].title, 'Code');

  const found = await findWindows('code', {
    execFile: fakeExec(JSON.stringify([{ hwnd: 1, title: 'Code', processName: 'Code' }]), calls),
  });
  assert.strictEqual(found.length, 1);

  const focus = await focusWindow(1, { execFile: fakeExec('{"ok":true}', calls) });
  assert.strictEqual(focus.ok, true);
  assert(calls.some((call) => call.args.includes('-WindowStyle')));

  console.log('[testWindowTools] window tool tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
