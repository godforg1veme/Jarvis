const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readCaptureSettings, saveCaptureSettings, captureSettingsForEditor } = require('./cloudCaptureSettings');
test('capture settings store only closed booleans, survive reload and reject corrupt state', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-capture-settings-'));
  const file = path.join(directory, 'settings.json');
  try {
    const value = { echoCancellation: false, noiseSuppression: true, autoGainControl: true };
    assert.deepEqual(saveCaptureSettings(value, file), value);
    assert.deepEqual(readCaptureSettings({}, file), value);
    assert.throws(() => saveCaptureSettings({ ...value, command: 'not-allowed' }, file));
    assert.throws(() => saveCaptureSettings({ ...value, noiseSuppression: 'true' }, file));
    assert.deepEqual(readCaptureSettings({}, file), value);
    fs.writeFileSync(file, 'invalid');
    assert.throws(() => readCaptureSettings({}, file), { code: 'unavailable' });
    const repair = captureSettingsForEditor(value, file);
    assert.equal(repair.needsRepair, true);
    assert.deepEqual(repair.settings, value);
    saveCaptureSettings(repair.settings, file);
    assert.equal(captureSettingsForEditor({}, file).needsRepair, false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
