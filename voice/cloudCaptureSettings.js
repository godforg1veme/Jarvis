const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getWritableDataPath } = require('../runtimeDataPath');
const KEYS = ['echoCancellation', 'noiseSuppression', 'autoGainControl'];
function settingsPath() { return getWritableDataPath(path.join(__dirname, '..', 'data', 'cloud-capture-settings.json')); }
function defaults(fallback = {}) {
  return { echoCancellation: fallback.echoCancellation !== false, noiseSuppression: fallback.noiseSuppression !== false,
    autoGainControl: fallback.autoGainControl === true };
}
function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== KEYS.length
    || KEYS.some((key) => typeof value[key] !== 'boolean') || Object.keys(value).some((key) => !KEYS.includes(key))) {
    throw Object.assign(new Error('Invalid capture settings'), { code: 'invalid_request' });
  }
  return Object.fromEntries(KEYS.map((key) => [key, value[key]]));
}
function readCaptureSettings(fallback = {}, filePath = settingsPath()) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw Object.assign(new Error('Capture settings unavailable'), { code: 'unavailable' });
    return defaults(fallback);
  }
  try { return validate(JSON.parse(raw)); }
  catch { throw Object.assign(new Error('Capture settings unavailable'), { code: 'unavailable' }); }
}
function captureSettingsForEditor(fallback, filePath = settingsPath()) {
  try { return { settings: readCaptureSettings(fallback, filePath), needsRepair: false }; }
  catch { return { settings: defaults(fallback), needsRepair: true }; }
}
function saveCaptureSettings(value, filePath = settingsPath()) {
  const settings = validate(value);
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(settings) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, filePath);
    return settings;
  } catch { throw Object.assign(new Error('Capture settings unavailable'), { code: 'unavailable' }); }
  finally { try { fs.unlinkSync(temporary); } catch (_) {} }
}
module.exports = { readCaptureSettings, saveCaptureSettings, captureSettingsForEditor, validate };
