const assert = require('assert');
const { buildWindowsAutoStartSettings } = require('../startup/windowsAutoStart');

const execPath = 'C:\\Jarvis\\electron.exe';
const appPath = 'C:\\Jarvis App';

assert.deepStrictEqual(
  buildWindowsAutoStartSettings({ isPackaged: false, execPath, appPath }),
  {
    openAtLogin: true,
    path: execPath,
    args: [appPath, '--hidden'],
  },
  'development autostart must pass the Jarvis application path to Electron',
);

assert.deepStrictEqual(
  buildWindowsAutoStartSettings({ isPackaged: true, execPath, appPath }),
  {
    openAtLogin: true,
    path: execPath,
    args: ['--hidden'],
  },
  'packaged autostart must launch the packaged executable directly',
);

assert.throws(
  () => buildWindowsAutoStartSettings({ isPackaged: false, execPath, appPath: '' }),
  /Application path is required/,
);

console.log('[test] Windows autostart settings OK');
