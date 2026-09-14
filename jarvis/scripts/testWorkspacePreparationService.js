const assert = require('assert');
const { WorkspacePreparationService } = require('../tools/workspacePreparationService');

const PROJECT = '11111111-1111-4111-8111-111111111111';
async function run() {
  const service = new WorkspacePreparationService({
    registry: { get: () => ({ projectId: PROJECT, label: 'Life OS', appAliases: ['VS Code', 'Unknown'], fileSearchHints: ['spec'], localPaths: ['C:\\private\\project'] }) },
    appResolver: { resolve: (alias) => alias === 'VS Code' ? { ok: true, app: { name: alias, type: 'exe', path: 'C:\\Code.exe' } } : { ok: false } },
    launchApp: { launch: async () => ({ ok: true }) }, shell: { openPath: async () => '' },
  });
  const result = await service.prepare({ projectId: PROJECT, capabilityClasses: ['applications', 'files'] });
  assert.strictEqual(result.partial, true);
  assert.strictEqual(result.needsSelection, true);
  assert.ok(result.steps.some((step) => step.status === 'completed'));
  assert.doesNotMatch(JSON.stringify(result), /private|Code\.exe/);
  const absent = await new WorkspacePreparationService({ registry: { get: () => null } }).prepare({ projectId: PROJECT });
  assert.strictEqual(absent.errorCode, 'WORKSPACE_NOT_REGISTERED');
}
run().then(() => console.log('[testWorkspacePreparationService] workspace preparation tests passed')).catch((error) => { console.error(error); process.exit(1); });
