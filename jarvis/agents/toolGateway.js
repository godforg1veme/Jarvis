const fs = require('fs');
const path = require('path');
const { searchFiles } = require('../tools/fileSearch');
const { isDangerousFile, toFileCandidate } = require('../tools/fileSafety');

const POLICY = {
  OBSERVE: 'observe',
  LOW_RISK: 'low_risk',
  CONFIRM: 'requires_confirmation',
  STRONG: 'requires_strong_confirmation',
};

const ACTION_POLICIES = {
  'file.search': POLICY.OBSERVE,
  'file.list_directory': POLICY.OBSERVE,
  'app.resolve': POLICY.OBSERVE,
  'window.list': POLICY.OBSERVE,

  'file.open': POLICY.LOW_RISK,
  'file.reveal': POLICY.LOW_RISK,
  'window.focus': POLICY.LOW_RISK,
  'window.restore': POLICY.LOW_RISK,

  'file.create_folder': POLICY.CONFIRM,
  'file.rename': POLICY.CONFIRM,
  'file.move': POLICY.CONFIRM,
  'file.copy': POLICY.CONFIRM,
  'file.delete': POLICY.CONFIRM,
  'app.launch': POLICY.CONFIRM,
  'app.close': POLICY.CONFIRM,
  'window.close': POLICY.CONFIRM,
  'window.move': POLICY.CONFIRM,
  'window.resize': POLICY.CONFIRM,
  'window.layout': POLICY.CONFIRM,

  'file.permanent_delete': POLICY.STRONG,
  'file.overwrite': POLICY.STRONG,
  'file.move_batch': POLICY.STRONG,
  'file.copy_batch': POLICY.STRONG,
  'file.rename_batch': POLICY.STRONG,
  'file.delete_batch': POLICY.STRONG,
};

function normalizeAction(action) {
  return String(action || '').trim();
}

function policyForAction(action) {
  return ACTION_POLICIES[normalizeAction(action)] || '';
}

function normalizePath(inputPath, options = {}) {
  const raw = String(inputPath || '').trim();
  if (!raw) throw new Error('path is required');

  const resolved = path.resolve(raw);
  const allowRoots = Array.isArray(options.allowRoots) ? options.allowRoots.filter(Boolean) : [];
  if (allowRoots.length > 0) {
    const lowerResolved = resolved.toLowerCase();
    const allowed = allowRoots.some((root) => {
      const lowerRoot = path.resolve(root).toLowerCase();
      return lowerResolved === lowerRoot || lowerResolved.startsWith(`${lowerRoot}${path.sep}`);
    });
    if (!allowed) {
      throw new Error(`path is outside allowed roots: ${resolved}`);
    }
  }

  return resolved;
}

function validateToolRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('tool request must be an object');
  }

  const action = normalizeAction(request.action);
  if (!action) throw new Error('tool request action is required');

  const policy = policyForAction(action);
  if (!policy) throw new Error(`unknown tool action: ${action}`);

  const args = request.args || {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('tool request args must be an object');
  }

  return {
    action,
    policy,
    args,
    requestId: request.requestId || request.id || '',
  };
}

function confirmationBlock(action, policy, args) {
  return {
    ok: false,
    action,
    policy,
    requiresConfirmation: policy === POLICY.CONFIRM,
    requiresStrongConfirmation: policy === POLICY.STRONG,
    args,
    message: policy === POLICY.STRONG
      ? 'Для этого действия нужно усиленное подтверждение.'
      : 'Для этого действия нужно подтверждение.',
  };
}

function listDirectory(args, options = {}) {
  const dir = normalizePath(args.path, options);
  const limit = Math.min(Math.max(Number(args.limit || 50), 1), 200);

  if (!fs.existsSync(dir)) {
    return { ok: false, error: 'directory does not exist', path: dir };
  }

  const stats = fs.statSync(dir);
  if (!stats.isDirectory()) {
    return { ok: false, error: 'path is not a directory', path: dir };
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true }).slice(0, limit).map((entry) => {
    const fullPath = path.join(dir, entry.name);
    let entryStats = null;
    try {
      entryStats = fs.statSync(fullPath);
    } catch {
      entryStats = null;
    }

    return {
      name: entry.name,
      path: fullPath,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      size: entryStats && entryStats.isFile() ? entryStats.size : 0,
      modifiedAt: entryStats ? entryStats.mtime.toISOString() : '',
      dangerous: entry.isFile() ? isDangerousFile(entry.name) : false,
    };
  });

  return { ok: true, action: 'file.list_directory', policy: POLICY.OBSERVE, path: dir, entries };
}

function searchFilesForGateway(args, options = {}) {
  const result = searchFiles({
    query: args.query,
    location: args.location || 'computer',
  }, {
    ...options,
    maxResults: args.limit || options.maxResults || 20,
    enableDiskScan: args.enableDiskScan === true,
  });

  return {
    ok: result.ok,
    action: 'file.search',
    policy: POLICY.OBSERVE,
    reason: result.reason,
    query: result.query || args.query,
    location: result.location || args.location || 'computer',
    results: result.results || [],
  };
}

async function openOrReveal(action, args, options = {}) {
  const shell = options.shell;
  const targetPath = normalizePath(args.path, options);
  if (!fs.existsSync(targetPath)) {
    return { ok: false, action, policy: POLICY.LOW_RISK, error: 'path does not exist', path: targetPath };
  }

  const stats = fs.statSync(targetPath);
  const candidate = stats.isFile()
    ? toFileCandidate(targetPath, stats, 'gateway', 100)
    : {
      type: 'directory',
      name: path.basename(targetPath),
      path: targetPath,
      directory: path.dirname(targetPath),
      dangerous: false,
    };

  if (action === 'file.open' && candidate.dangerous && !options.confirmed) {
    return confirmationBlock(action, POLICY.CONFIRM, { path: targetPath });
  }

  if (!shell) {
    return { ok: true, dryRun: true, action, policy: POLICY.LOW_RISK, target: candidate };
  }

  if (action === 'file.reveal') {
    if (typeof shell.showItemInFolder !== 'function') {
      return { ok: false, action, policy: POLICY.LOW_RISK, error: 'shell.showItemInFolder unavailable' };
    }
    shell.showItemInFolder(targetPath);
    return { ok: true, action, policy: POLICY.LOW_RISK, target: candidate };
  }

  if (typeof shell.openPath !== 'function') {
    return { ok: false, action, policy: POLICY.LOW_RISK, error: 'shell.openPath unavailable' };
  }
  const error = await shell.openPath(targetPath);
  return error
    ? { ok: false, action, policy: POLICY.LOW_RISK, error }
    : { ok: true, action, policy: POLICY.LOW_RISK, target: candidate };
}

async function executeToolRequest(request, options = {}) {
  let normalized;
  try {
    normalized = validateToolRequest(request);
  } catch (error) {
    return { ok: false, error: error.message };
  }

  const { action, policy, args } = normalized;
  if (policy === POLICY.CONFIRM && !options.confirmed) {
    return confirmationBlock(action, policy, args);
  }
  if (policy === POLICY.STRONG && !options.strongConfirmed) {
    return confirmationBlock(action, policy, args);
  }

  try {
    if (action === 'file.search') return searchFilesForGateway(args, options);
    if (action === 'file.list_directory') return listDirectory(args, options);
    if (action === 'file.open' || action === 'file.reveal') return await openOrReveal(action, args, options);

    return {
      ok: false,
      action,
      policy,
      error: 'tool action is validated but not implemented yet',
    };
  } catch (error) {
    return { ok: false, action, policy, error: error.message };
  }
}

module.exports = {
  POLICY,
  ACTION_POLICIES,
  policyForAction,
  validateToolRequest,
  normalizePath,
  executeToolRequest,
};
