const fs = require('fs');
const path = require('path');
const { searchFiles } = require('../tools/fileSearch');
const { isDangerousFile, toFileCandidate } = require('../tools/fileSafety');
const defaultWindowTools = require('../tools/windowTools');
const defaultAppResolver = require('../tools/appResolver');
const defaultLaunchApp = require('../tools/launchApp');
const { apps: defaultRegistryApps } = require('../actions/appRegistry');
const { closeAppProcesses: defaultCloseAppProcesses } = require('../actions/processKiller');

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
  'file.create_text_file': POLICY.CONFIRM,
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
  'file.move_batch': POLICY.STRONG,
  'file.copy_batch': POLICY.STRONG,
  'file.rename_batch': POLICY.STRONG,
  'file.delete_batch': POLICY.STRONG,
};

const OVERWRITE_CAPABLE_ACTIONS = new Set([
  'file.create_folder',
  'file.create_text_file',
  'file.move',
  'file.copy',
]);

function normalizeAction(action) {
  return String(action || '').trim();
}

function policyForAction(action, args = {}) {
  const normalizedAction = normalizeAction(action);
  const basePolicy = ACTION_POLICIES[normalizedAction] || '';
  if (basePolicy && args.overwrite === true && OVERWRITE_CAPABLE_ACTIONS.has(normalizedAction)) {
    return POLICY.STRONG;
  }
  return basePolicy;
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

  const args = request.args || {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('tool request args must be an object');
  }
  if (Object.prototype.hasOwnProperty.call(args, 'overwrite') && typeof args.overwrite !== 'boolean') {
    throw new Error('overwrite must be a boolean');
  }

  const policy = policyForAction(action, args);
  if (!policy) throw new Error(`unknown tool action: ${action}`);

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

function ensureParentDir(targetPath) {
  const parent = path.dirname(targetPath);
  if (!fs.existsSync(parent)) {
    throw new Error(`destination parent does not exist: ${parent}`);
  }
}

function nextAvailablePath(targetPath) {
  if (!fs.existsSync(targetPath)) return targetPath;

  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);

  for (let index = 1; index <= 999; index += 1) {
    const candidate = path.join(dir, `${base} (${index})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`cannot find available name for ${targetPath}`);
}

function enforceBatchLimit(paths, limit = 20) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('batch paths are required');
  }
  if (paths.length > limit) {
    throw new Error(`batch limit exceeded: ${paths.length} > ${limit}`);
  }
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

function createFolder(args, options = {}) {
  const targetPath = normalizePath(args.path, options);
  const finalPath = args.overwrite ? targetPath : nextAvailablePath(targetPath);
  fs.mkdirSync(finalPath, { recursive: true });
  return { ok: true, action: 'file.create_folder', policy: POLICY.CONFIRM, path: finalPath };
}

function createTextFile(args, options = {}) {
  const targetPath = normalizePath(args.path, options);
  const parent = path.dirname(targetPath);
  if (!fs.existsSync(parent)) {
    return {
      ok: false,
      action: 'file.create_text_file',
      policy: POLICY.CONFIRM,
      error: 'parent path does not exist',
      path: targetPath,
      parent,
    };
  }
  if (!fs.statSync(parent).isDirectory()) {
    return {
      ok: false,
      action: 'file.create_text_file',
      policy: POLICY.CONFIRM,
      error: 'parent path is not a directory',
      path: targetPath,
      parent,
    };
  }

  const finalPath = args.overwrite ? targetPath : nextAvailablePath(targetPath);
  const content = typeof args.content === 'string' ? args.content : '';
  fs.writeFileSync(finalPath, content, { encoding: 'utf8', flag: args.overwrite ? 'w' : 'wx' });
  return { ok: true, action: 'file.create_text_file', policy: POLICY.CONFIRM, path: finalPath };
}

function renamePath(args, options = {}) {
  const from = normalizePath(args.from || args.path, options);
  const newName = String(args.newName || '').trim();
  if (!newName) throw new Error('newName is required');
  if (newName.includes('/') || newName.includes('\\')) throw new Error('newName must be a name, not a path');
  if (!fs.existsSync(from)) throw new Error(`source does not exist: ${from}`);

  const to = nextAvailablePath(path.join(path.dirname(from), newName));
  fs.renameSync(from, to);
  return { ok: true, action: 'file.rename', policy: POLICY.CONFIRM, from, to };
}

function movePath(args, options = {}) {
  const from = normalizePath(args.from || args.path, options);
  const rawTo = args.to || args.destination;
  const toInput = normalizePath(rawTo, options);
  if (!fs.existsSync(from)) throw new Error(`source does not exist: ${from}`);

  const destination = fs.existsSync(toInput) && fs.statSync(toInput).isDirectory()
    ? path.join(toInput, path.basename(from))
    : toInput;
  ensureParentDir(destination);
  const to = args.overwrite ? destination : nextAvailablePath(destination);
  fs.renameSync(from, to);
  return { ok: true, action: 'file.move', policy: POLICY.CONFIRM, from, to };
}

function copyPath(args, options = {}) {
  const from = normalizePath(args.from || args.path, options);
  const rawTo = args.to || args.destination;
  const toInput = normalizePath(rawTo, options);
  if (!fs.existsSync(from)) throw new Error(`source does not exist: ${from}`);

  const destination = fs.existsSync(toInput) && fs.statSync(toInput).isDirectory()
    ? path.join(toInput, path.basename(from))
    : toInput;
  ensureParentDir(destination);
  const to = args.overwrite ? destination : nextAvailablePath(destination);
  fs.cpSync(from, to, { recursive: true, force: !!args.overwrite, errorOnExist: !args.overwrite });
  return { ok: true, action: 'file.copy', policy: POLICY.CONFIRM, from, to };
}

async function deleteToRecycleBin(args, options = {}) {
  const targetPath = normalizePath(args.path, options);
  if (!fs.existsSync(targetPath)) throw new Error(`path does not exist: ${targetPath}`);

  const shell = options.shell;
  if (!shell || typeof shell.trashItem !== 'function') {
    throw new Error('shell.trashItem unavailable; refusing to permanently delete without strong confirmation');
  }

  await shell.trashItem(targetPath);
  return { ok: true, action: 'file.delete', policy: POLICY.CONFIRM, path: targetPath, recycled: true };
}

function permanentDelete(args, options = {}) {
  const targetPath = normalizePath(args.path, options);
  if (!fs.existsSync(targetPath)) throw new Error(`path does not exist: ${targetPath}`);
  fs.rmSync(targetPath, { recursive: true, force: true });
  return { ok: true, action: 'file.permanent_delete', policy: POLICY.STRONG, path: targetPath, permanent: true };
}

async function executeBatch(action, args, options = {}) {
  const paths = args.paths || args.items;
  enforceBatchLimit(paths, options.maxBatchItems || 20);

  const results = [];
  for (const item of paths) {
    if (action === 'file.delete_batch') {
      results.push(await deleteToRecycleBin({ path: item.path || item }, options));
    } else if (action === 'file.move_batch') {
      results.push(movePath({ from: item.path || item.from || item, to: item.to || args.to || args.destination }, options));
    } else if (action === 'file.copy_batch') {
      results.push(copyPath({ from: item.path || item.from || item, to: item.to || args.to || args.destination }, options));
    } else if (action === 'file.rename_batch') {
      results.push(renamePath({ from: item.path || item.from, newName: item.newName }, options));
    } else {
      throw new Error(`unsupported batch action: ${action}`);
    }
  }

  return { ok: true, action, policy: POLICY.STRONG, results };
}

function normalizeHwnd(value) {
  const hwnd = Number(value);
  if (!Number.isFinite(hwnd) || hwnd <= 0) {
    throw new Error('valid hwnd is required');
  }
  return hwnd;
}

async function executeWindowAction(action, args, options = {}) {
  const windowTools = options.windowTools || defaultWindowTools;

  if (action === 'window.list') {
    const windows = await windowTools.listWindows(options);
    return { ok: true, action, policy: POLICY.OBSERVE, windows };
  }

  const hwnd = normalizeHwnd(args.hwnd);

  if (action === 'window.focus') {
    const result = await windowTools.focusWindow(hwnd, options);
    return { ok: result.ok !== false, action, policy: POLICY.LOW_RISK, hwnd, result };
  }
  if (action === 'window.restore') {
    const result = await windowTools.restoreWindow(hwnd, options);
    return { ok: result.ok !== false, action, policy: POLICY.LOW_RISK, hwnd, result };
  }
  if (action === 'window.close') {
    const result = await windowTools.closeWindow(hwnd, options);
    return { ok: result.ok !== false, action, policy: POLICY.CONFIRM, hwnd, result };
  }
  if (action === 'window.move' || action === 'window.resize') {
    const rect = {
      x: Number(args.x),
      y: Number(args.y),
      width: Number(args.width),
      height: Number(args.height),
    };
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
      throw new Error('window rectangle requires x, y, width, and height');
    }
    const result = await windowTools.moveResizeWindow(hwnd, rect, options);
    return { ok: result.ok !== false, action, policy: POLICY.CONFIRM, hwnd, rect, result };
  }

  throw new Error(`unsupported window action: ${action}`);
}

async function executeWindowLayout(args, options = {}) {
  const windowTools = options.windowTools || defaultWindowTools;
  const workArea = args.workArea || options.workArea;
  const items = Array.isArray(args.items) ? args.items : [];

  if (items.length > 0) {
    const results = [];
    for (const item of items) {
      const hwnd = normalizeHwnd(item.hwnd);
      const rect = item.rect || windowTools.snapRect(item.position, workArea);
      results.push(await windowTools.moveResizeWindow(hwnd, rect, options));
    }
    return { ok: true, action: 'window.layout', policy: POLICY.CONFIRM, results };
  }

  const hwnds = Array.isArray(args.hwnds) ? args.hwnds.map(normalizeHwnd) : [];
  const layout = args.layout || 'two-columns';
  const rects = windowTools.multiWindowLayout(layout, workArea);
  if (hwnds.length === 0 || hwnds.length > rects.length) {
    throw new Error('layout requires hwnds matching available layout slots');
  }

  const results = [];
  for (let index = 0; index < hwnds.length; index += 1) {
    results.push(await windowTools.moveResizeWindow(hwnds[index], rects[index], options));
  }
  return { ok: true, action: 'window.layout', policy: POLICY.CONFIRM, results };
}

async function executeAppAction(action, args, options = {}) {
  const appResolver = options.appResolver || defaultAppResolver;
  const launchApp = options.launchApp || defaultLaunchApp;
  const registryApps = options.registryApps || defaultRegistryApps;
  const closeAppProcesses = options.closeAppProcesses || defaultCloseAppProcesses;

  if (action === 'app.resolve') {
    const query = String(args.query || args.name || '').trim();
    if (!query) throw new Error('app query is required');
    const result = appResolver.resolve(query, { infoOnly: !!args.infoOnly });
    return { ok: result.ok !== false, action, policy: POLICY.OBSERVE, result };
  }

  if (action === 'app.launch') {
    const candidateId = String(args.candidateId || '').trim();
    if (!/^candidate-[a-zA-Z0-9-]+$/.test(candidateId)) throw new Error('opaque candidateId is required for app.launch');
    if (typeof options.resolveAppCandidate !== 'function') throw new Error('trusted app candidate resolver is unavailable');
    const app = options.resolveAppCandidate(candidateId);
    if (!app || typeof app !== 'object') throw new Error('app candidate is unavailable or expired');
    const result = await launchApp.launch(app);
    return { ok: result.ok !== false, action, policy: POLICY.CONFIRM, result };
  }

  if (action === 'app.close') {
    const appId = String(args.appId || '').trim();
    const app = registryApps[appId];
    if (!app) throw new Error(`unknown whitelisted app id: ${appId}`);
    const result = await closeAppProcesses(app, options);
    return { ok: result.ok !== false, action, policy: POLICY.CONFIRM, result };
  }

  throw new Error(`unsupported app action: ${action}`);
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
    if (action === 'file.create_folder') return createFolder(args, options);
    if (action === 'file.create_text_file') return createTextFile(args, options);
    if (action === 'file.rename') return renamePath(args, options);
    if (action === 'file.move') return movePath(args, options);
    if (action === 'file.copy') return copyPath(args, options);
    if (action === 'file.delete') return await deleteToRecycleBin(args, options);
    if (action === 'file.permanent_delete') return permanentDelete(args, options);
    if (['file.move_batch', 'file.copy_batch', 'file.rename_batch', 'file.delete_batch'].includes(action)) {
      return await executeBatch(action, args, options);
    }
    if (['window.list', 'window.focus', 'window.restore', 'window.close', 'window.move', 'window.resize'].includes(action)) {
      return await executeWindowAction(action, args, options);
    }
    if (action === 'window.layout') return await executeWindowLayout(args, options);
    if (['app.resolve', 'app.launch', 'app.close'].includes(action)) {
      return await executeAppAction(action, args, options);
    }

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
