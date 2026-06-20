const assert = require('assert');
const fs = require('fs');
const path = require('path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

const lockIndex = main.indexOf('app.requestSingleInstanceLock()');
const readyIndex = main.indexOf('app.whenReady().then');
const shortcutIndex = main.indexOf("globalShortcut.register('Ctrl+Alt+J'");

assert(lockIndex >= 0, 'main.js must request a single instance lock');
assert(readyIndex >= 0, 'main.js must have an app.whenReady handler');
assert(shortcutIndex >= 0, 'main.js must register the global shortcut');
assert(lockIndex < readyIndex, 'single instance lock must be requested before app.whenReady work starts');
assert(readyIndex < shortcutIndex, 'global shortcut must be registered from app.whenReady');

console.log('[test] main single-instance order OK');
