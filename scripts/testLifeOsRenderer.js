const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'renderer', 'cloud-chat', 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'renderer', 'life-os', 'life-os.js'), 'utf8');
const viewModel = fs.readFileSync(path.join(root, 'renderer', 'life-os', 'life-os-view-model.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'renderer', 'life-os', 'life-os.css'), 'utf8');

assert.match(html, /id="life-os"[^>]+aria-hidden="true"/);
assert.match(html, /aria-label="Разделы Life OS"/);
for (const view of ['mission', 'timeline', 'projects', 'people', 'system']) assert.match(html, new RegExp(`data-life-view="${view}"`));
assert.match(html, /role="status"/);
assert.match(script, /textContent/);
assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML/);
assert.doesNotMatch(script, /fetch\(|Authorization|Bearer|child_process|require\(/);
assert.match(script, /createLifeRecoveryPlan/);
assert.match(script, /proposal\.risk === 'changing' && !online\(\)/);
assert.match(script, /getLifePreferences/);
assert.match(viewModel, /smart_home/);
assert.match(viewModel, /notifications\.max_proactive_per_day/);
assert.match(css, /@media \(max-width: 520px\)/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(css, /:focus-visible/);
assert.match(css, /min-width: 320px/);
console.log('[test] Life OS renderer contract OK');
