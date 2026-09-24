class WorkspacePreparationService {
  constructor(options = {}) {
    this.registry = options.registry;
    this.appResolver = options.appResolver;
    this.launchApp = options.launchApp;
    this.shell = options.shell;
  }

  async prepare({ projectId, capabilityClasses = ['applications', 'files'] }) {
    const workspace = this.registry?.get(projectId);
    if (!workspace) return { ok: false, action: 'workspace.prepare', errorCode: 'WORKSPACE_NOT_REGISTERED', summary: 'Рабочее пространство не зарегистрировано на этом компьютере.', steps: [] };
    const requested = new Set(capabilityClasses);
    const steps = [];
    if (requested.has('applications')) {
      for (const alias of workspace.appAliases) {
        const resolved = this.appResolver?.resolve(alias, { infoOnly: true });
        if (!resolved?.ok || !resolved.app) { steps.push({ type: 'application', label: alias, status: 'ambiguous' }); continue; }
        try {
          const launch = typeof this.launchApp === 'function' ? this.launchApp : this.launchApp?.launch;
          if (!launch) throw new Error('launcher unavailable');
          const result = await launch(resolved.app, {});
          steps.push({ type: 'application', label: alias, status: result?.ok === false ? 'failed' : 'completed' });
        } catch { steps.push({ type: 'application', label: alias, status: 'failed' }); }
      }
    }
    if (requested.has('files')) {
      for (const localPath of workspace.localPaths) {
        try {
          const error = this.shell?.openPath ? await this.shell.openPath(localPath) : 'unavailable';
          steps.push({ type: 'file', label: 'Локальный ресурс', status: error ? 'failed' : 'completed' });
        } catch { steps.push({ type: 'file', label: 'Локальный ресурс', status: 'failed' }); }
      }
      for (const hint of workspace.fileSearchHints) steps.push({ type: 'file_hint', label: hint, status: 'needs_selection' });
    }
    const completed = steps.filter((item) => item.status === 'completed').length;
    const unresolved = steps.filter((item) => ['ambiguous', 'needs_selection'].includes(item.status)).length;
    const failed = steps.filter((item) => item.status === 'failed').length;
    return { ok: failed === 0 && unresolved === 0, action: 'workspace.prepare',
      partial: completed > 0 && (failed > 0 || unresolved > 0), needsSelection: unresolved > 0,
      summary: failed || unresolved ? 'Рабочее пространство подготовлено частично.' : 'Рабочее пространство подготовлено.',
      steps: steps.slice(0, 32) };
  }
}

module.exports = { WorkspacePreparationService };
