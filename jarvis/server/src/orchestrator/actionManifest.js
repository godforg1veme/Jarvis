const { ACTION_POLICIES, policyForAction, validateActionArgs } = require('../commands/commandSchemas');
const { validateLifeActionArgs } = require('./lifeActionSchemas');

const MANIFEST_VERSION = 1;

const ACTION_DETAILS = Object.freeze({
  'file.search': { description: 'Search files and folders on a Windows device by name or phrase.', idempotency: 'read', timeoutMs: 15000 },
  'file.list_directory': { description: 'List a known directory on a Windows device.', idempotency: 'read', timeoutMs: 10000 },
  'file.open': { description: 'Open a known safe file or an opaque file candidate on a Windows device.', idempotency: 'repeatable', timeoutMs: 10000 },
  'file.open_folder': { description: 'Open a known directory or an opaque directory candidate in Explorer.', idempotency: 'repeatable', timeoutMs: 10000 },
  'file.reveal': { description: 'Reveal a known path or opaque candidate in Explorer.', idempotency: 'repeatable', timeoutMs: 10000 },
  'file.create_folder': { description: 'Create a directory.', idempotency: 'conditional', timeoutMs: 10000 },
  'file.create_text_file': { description: 'Create a text file.', idempotency: 'conditional', timeoutMs: 10000 },
  'file.rename': { description: 'Rename a file or directory.', idempotency: 'non_idempotent', timeoutMs: 10000 },
  'file.move': { description: 'Move a file or directory.', idempotency: 'non_idempotent', timeoutMs: 20000 },
  'file.copy': { description: 'Copy a file or directory.', idempotency: 'conditional', timeoutMs: 20000 },
  'file.delete': { description: 'Move a file or directory to the recycle bin.', idempotency: 'non_idempotent', timeoutMs: 20000 },
  'file.permanent_delete': { description: 'Permanently delete a file or directory.', idempotency: 'non_idempotent', timeoutMs: 20000 },
  'file.move_batch': { description: 'Move several files or directories.', idempotency: 'non_idempotent', timeoutMs: 30000 },
  'file.copy_batch': { description: 'Copy several files or directories.', idempotency: 'conditional', timeoutMs: 30000 },
  'file.rename_batch': { description: 'Rename several files or directories.', idempotency: 'non_idempotent', timeoutMs: 30000 },
  'file.delete_batch': { description: 'Delete several files or directories.', idempotency: 'non_idempotent', timeoutMs: 30000 },
  'app.resolve': { description: 'Find an installed application and return opaque candidates.', idempotency: 'read', timeoutMs: 15000 },
  'app.launch': { description: 'Launch an application selected by opaque candidate ID.', idempotency: 'repeatable', timeoutMs: 15000 },
  'app.close': { description: 'Close a known application.', idempotency: 'repeatable', timeoutMs: 15000 },
  'window.list': { description: 'List visible windows.', idempotency: 'read', timeoutMs: 10000 },
  'window.focus': { description: 'Focus a visible window.', idempotency: 'repeatable', timeoutMs: 10000 },
  'window.restore': { description: 'Restore a minimized window.', idempotency: 'repeatable', timeoutMs: 10000 },
  'window.close': { description: 'Close a visible window.', idempotency: 'repeatable', timeoutMs: 10000 },
  'window.move': { description: 'Move and size a visible window.', idempotency: 'repeatable', timeoutMs: 10000 },
  'window.resize': { description: 'Resize a visible window.', idempotency: 'repeatable', timeoutMs: 10000 },
  'window.layout': { description: 'Apply a layout to visible windows.', idempotency: 'repeatable', timeoutMs: 15000 },
  'vision.capture': { description: 'Observe camera and/or screens only through an already active local Vision Lease. Never starts a camera remotely.', idempotency: 'read', timeoutMs: 120000 },
});

const LIFE_ACTIONS = Object.freeze({
  'reminder.create': { executorType: 'server', policy: 'requires_confirmation', description: 'Create an owner-scoped reminder from a confirmed proposal.', idempotency: 'conditional' },
  'reminder.reschedule': { executorType: 'server', policy: 'requires_confirmation', description: 'Reschedule an owner-scoped reminder.', idempotency: 'conditional' },
  'life.commitment.reschedule': { executorType: 'server', policy: 'requires_confirmation', description: 'Reschedule an owner-scoped commitment.', idempotency: 'conditional' },
  'life.task.create': { executorType: 'server', policy: 'requires_confirmation', description: 'Create an owner-scoped Life OS task.', idempotency: 'conditional' },
  'project.show_documents': { executorType: 'server', policy: 'observe', description: 'Show safe metadata for documents linked to a project.', idempotency: 'read' },
  'device.status.request': { executorType: 'server', policy: 'observe', description: 'Read the current safe state of an owned device.', idempotency: 'read' },
  'workflow.continue': { executorType: 'server', policy: 'requires_confirmation', description: 'Continue an owner-scoped paused workflow.', idempotency: 'conditional' },
  'workspace.prepare': { executorType: 'device', policy: 'requires_confirmation', description: 'Prepare a registered local workspace through Desktop.', idempotency: 'conditional', capability: 'workspace.prepare' },
});

function createActionManifest() {
  const actions = Object.entries(ACTION_POLICIES).map(([name, policy]) => {
    const details = ACTION_DETAILS[name] || {};
    return Object.freeze({
      name,
      version: MANIFEST_VERSION,
      executorType: 'device',
      capability: name,
      policy,
      description: details.description || name,
      idempotency: details.idempotency || 'unknown',
      timeoutMs: details.timeoutMs || 10000,
      maxResultBytes: 128 * 1024,
      validateArgs(args) { return validateActionArgs(name, args); },
      policyForArgs(args) { return policyForAction(name, args); },
    });
  });
  for (const [name, details] of Object.entries(LIFE_ACTIONS)) actions.push(Object.freeze({
    name, version: MANIFEST_VERSION, executorType: details.executorType,
    capability: details.capability || name, policy: details.policy,
    description: details.description, idempotency: details.idempotency,
    timeoutMs: details.timeoutMs || 10000, maxResultBytes: 128 * 1024,
    proposalOnly: true,
    validateArgs(args) { return validateLifeActionArgs(name, args); },
    policyForArgs() { return details.policy; },
  }));
  const byName = new Map(actions.map((action) => [action.name, action]));
  return Object.freeze({
    version: MANIFEST_VERSION,
    list() { return [...actions]; },
    get(name) { return byName.get(String(name || '')) || null; },
    require(name) {
      const action = byName.get(String(name || ''));
      if (!action) throw new Error(`unknown orchestrator action: ${name}`);
      return action;
    },
  });
}

module.exports = { ACTION_DETAILS, LIFE_ACTIONS, MANIFEST_VERSION, createActionManifest };
