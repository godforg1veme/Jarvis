const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { executeToolRequest } = require('../agents/toolGateway');
const { WorkspaceRegistry } = require('../tools/workspaceRegistry');
const { WorkspacePreparationService } = require('../tools/workspacePreparationService');

const PROJECT = '11111111-1111-4111-8111-111111111111';

async function run() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-life-e2e-'));
  try {
    const workspacePath = path.join(temporaryRoot, 'workspace');
    fs.mkdirSync(workspacePath);
    const registry = new WorkspaceRegistry({ filePath: path.join(temporaryRoot, 'workspaces.local.json') });
    assert.ok(registry.save({ projectId: PROJECT, label: 'Life OS acceptance', appAliases: ['Fixture Editor'], fileSearchHints: [], localPaths: [workspacePath] }));

    let launches = 0; let opens = 0;
    const service = new WorkspacePreparationService({
      registry,
      appResolver: { resolve(alias) { return alias === 'Fixture Editor' ? { ok: true, app: { name: alias, type: 'fixture', path: path.join(temporaryRoot, 'editor.exe') } } : { ok: false }; } },
      launchApp: { async launch() { launches += 1; return { ok: true }; } },
      shell: { async openPath(target) { assert.equal(path.resolve(target), path.resolve(workspacePath)); opens += 1; return ''; } },
    });
    const request = { action: 'workspace.prepare', args: { projectId: PROJECT, recoveryPlanId: '22222222-2222-4222-8222-222222222222', capabilityClasses: ['applications', 'files'] } };
    const blocked = await executeToolRequest(request, { workspacePreparationService: service });
    assert.equal(blocked.requiresConfirmation, true);
    assert.equal(launches, 0); assert.equal(opens, 0);

    const result = await executeToolRequest(request, { workspacePreparationService: service, confirmed: true });
    assert.equal(result.ok, true); assert.equal(result.partial, false);
    assert.equal(launches, 1); assert.equal(opens, 1);
    assert.deepEqual(result.steps.map((step) => step.status), ['completed', 'completed']);
    assert.doesNotMatch(JSON.stringify(result), /jarvis-life-e2e|editor\.exe|workspaces\.local/);
    assert.match(fs.readFileSync(path.join(temporaryRoot, 'workspaces.local.json'), 'utf8'), /workspace/);
    console.log('[testLifeOsDesktopAcceptance] confirmed workspace executed once with redacted result');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
