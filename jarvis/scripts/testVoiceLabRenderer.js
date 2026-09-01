const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'renderer', 'voice-lab');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

assert(/Content-Security-Policy/.test(html));
assert(/script-src 'self'/.test(html));
assert(html.includes('id="calibration-action"'));
assert(html.includes('id="gemini-deep-button"'));
assert(html.includes('id="q-start-rms"'));
assert(html.includes('id="fw-prompt"'));
assert(html.includes('id="advisor-audio"'));
assert(script.includes('jarvisVoiceLab'));
assert(script.includes('requestGeminiAnalysis'));
assert(script.includes('applyPreview'));
assert(style.includes('.signal-grid'));
assert(style.includes('.advanced-grid'));

console.log('[test] Voice Lab renderer structure OK');
