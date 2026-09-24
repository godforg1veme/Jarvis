const assert = require('assert');
const { validateCandidate, validateAndRank, providerMetadata } = require('../tools/appCandidateValidator');

let id = 0;
const options = { existsSync: () => true, randomId: () => String(++id), systemRoot: 'C:\\Windows' };
const app = validateCandidate({ name: 'Obsidian', type: 'exe', path: 'D:\\Apps\\Obsidian.exe', source: 'disk-scan' }, options);
assert.strictEqual(app.candidateId, 'candidate-1');
assert.strictEqual(app.launch.target, 'D:\\Apps\\Obsidian.exe');
assert.strictEqual(providerMetadata(app).target, undefined);
app.description = 'Installed at D:\\Secret Folder\\Obsidian and contains trailing text';
assert.strictEqual(providerMetadata(app).description, '[redacted]');
app.publisher = 'Hosted at \\\\server\\private share\\Publisher';
assert.strictEqual(providerMetadata(app).publisher, '[redacted]');

const ranked = validateAndRank([
  { name: 'Obsidian Updater', type: 'exe', path: 'D:\\Apps\\Update.exe', source: 'disk-scan' },
  { name: 'Obsidian', type: 'exe', path: 'D:\\Apps\\Obsidian.exe', source: 'disk-scan' },
], 'обсидиан', options);
assert.strictEqual(ranked[0].displayName, 'Obsidian');

const script = validateCandidate({ name: 'Demo', type: 'script', path: 'D:\\Scripts\\demo.ps1' }, options);
assert.strictEqual(script.launch.type, 'script');
assert.strictEqual(script.launch.interpreter.endsWith('powershell.exe'), true);

console.log('testAppCandidateValidator: ok');
