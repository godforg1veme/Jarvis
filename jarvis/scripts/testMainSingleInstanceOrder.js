const assert = require('assert');
const fs = require('fs');
const path = require('path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

const lockIndex = main.indexOf('app.requestSingleInstanceLock()');
const readyIndex = main.indexOf('app.whenReady().then');
const shortcutIndex = main.indexOf("globalShortcut.register('Ctrl+Alt+J'");
const willQuitIndex = main.indexOf("app.on('will-quit'", readyIndex);

assert(lockIndex >= 0, 'main.js must request a single instance lock');
assert(readyIndex >= 0, 'main.js must have an app.whenReady handler');
assert(shortcutIndex >= 0, 'main.js must register the global shortcut');
assert(willQuitIndex >= 0, 'main.js must have a will-quit handler after app.whenReady');
assert(lockIndex < readyIndex, 'single instance lock must be requested before app.whenReady work starts');
assert(readyIndex < shortcutIndex, 'global shortcut must be registered from app.whenReady');

const readySection = main.slice(readyIndex, willQuitIndex);
const countCalls = (name) => (readySection.match(new RegExp(`\\b${name}\\(\\);`, 'g')) || []).length;

assert.strictEqual(countCalls('createWindow'), 1, 'app.whenReady must create the main window exactly once');
assert.strictEqual(countCalls('createTray'), 1, 'app.whenReady must create the tray exactly once');
assert(main.includes("data', 'ui-state.local.json'"), 'local UI state must use data/ui-state.local.json');
assert(!main.includes('settings.showTranscriptionBar'), 'tracked settings.json must not store transcription UI state');

console.log('[test] main startup wiring OK');
