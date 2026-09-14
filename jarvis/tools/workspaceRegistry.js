const fs = require('fs');
const path = require('path');
const { getWritableDataPath, WORKSPACE_REGISTRY_FILE } = require('../runtimeDataPath');

const DEFAULT_PATH = path.join(__dirname, '..', 'data', WORKSPACE_REGISTRY_FILE);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedStrings(value, maximum, length) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error('workspace registry list is invalid');
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
    .map((item) => { if (item.length > length) throw new Error('workspace registry value is too long'); return item; });
}

function validateWorkspace(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !UUID.test(String(input.projectId || ''))) throw new Error('workspace project id is invalid');
  const allowed = new Set(['projectId', 'label', 'appAliases', 'fileSearchHints', 'localPaths']);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error('workspace registry field is invalid');
  const label = String(input.label || '').trim();
  if (!label || label.length > 160) throw new Error('workspace label is invalid');
  return { projectId: input.projectId, label,
    appAliases: boundedStrings(input.appAliases || [], 12, 160),
    fileSearchHints: boundedStrings(input.fileSearchHints || [], 20, 300),
    localPaths: boundedStrings(input.localPaths || [], 20, 2048) };
}

class WorkspaceRegistry {
  constructor(options = {}) {
    this.filePath = options.filePath || getWritableDataPath(DEFAULT_PATH, options);
    this.fs = options.fs || fs;
  }

  list() {
    try {
      const parsed = JSON.parse(this.fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.workspaces) || parsed.workspaces.length > 100) return [];
      return parsed.workspaces.map(validateWorkspace);
    } catch { return []; }
  }

  get(projectId) { return this.list().find((item) => item.projectId === projectId) || null; }

  save(input) {
    const workspace = validateWorkspace(input);
    const workspaces = this.list().filter((item) => item.projectId !== workspace.projectId);
    workspaces.push(workspace);
    if (workspaces.length > 100) throw new Error('workspace registry is full');
    try {
      this.fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp`;
      this.fs.writeFileSync(temporary, JSON.stringify({ version: 1, workspaces }, null, 2), { encoding: 'utf8', mode: 0o600 });
      this.fs.renameSync(temporary, this.filePath);
      return workspace;
    } catch { return null; }
  }
}

module.exports = { DEFAULT_PATH, WorkspaceRegistry, validateWorkspace };
