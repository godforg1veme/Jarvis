const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkspaceRegistry, validateWorkspace } = require('../tools/workspaceRegistry');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-workspaces-'));
const filePath = path.join(root, 'workspaces.local.json');
try {
  const registry = new WorkspaceRegistry({ filePath });
  const projectId = '11111111-1111-4111-8111-111111111111';
  assert.strictEqual(registry.get(projectId), null);
  assert.ok(registry.save({ projectId, label: 'Life OS', appAliases: ['VS Code'], fileSearchHints: ['Life OS'], localPaths: ['C:\\Work\\Life OS'] }));
  assert.strictEqual(registry.get(projectId).label, 'Life OS');
  assert.throws(() => validateWorkspace({ projectId, label: 'x', command: 'powershell' }), /field/);
  assert.doesNotMatch(fs.readFileSync(filePath, 'utf8'), /ownerId|token|credential/);
  const denied = new WorkspaceRegistry({ filePath: 'x', fs: { readFileSync() { throw new Error('missing'); }, mkdirSync() { throw Object.assign(new Error('denied'), { code: 'EPERM' }); } } });
  assert.strictEqual(denied.save({ projectId, label: 'Life OS' }), null);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('[testWorkspaceRegistry] workspace registry tests passed');
