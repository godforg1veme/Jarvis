const { ACTION_POLICIES, normalizeAction } = require('./toolPolicy');

const ACTION_ARG_KEYS = Object.freeze({
  'file.search': ['query', 'location', 'targetType', 'limit', 'enableDiskScan'],
  'file.list_directory': ['path', 'limit'],
  'file.open': ['path', 'candidateId'],
  'file.open_folder': ['path', 'candidateId'],
  'file.reveal': ['path', 'candidateId'],
  'file.create_folder': ['path', 'overwrite'],
  'file.create_text_file': ['path', 'content', 'overwrite'],
  'file.rename': ['from', 'path', 'newName'],
  'file.move': ['from', 'path', 'to', 'destination', 'overwrite'],
  'file.copy': ['from', 'path', 'to', 'destination', 'overwrite'],
  'file.delete': ['path'],
  'file.permanent_delete': ['path'],
  'file.move_batch': ['paths', 'items', 'to', 'destination'],
  'file.copy_batch': ['paths', 'items', 'to', 'destination', 'overwrite'],
  'file.rename_batch': ['paths', 'items'],
  'file.delete_batch': ['paths', 'items'],
  'app.resolve': ['query', 'name', 'infoOnly'],
  'app.launch': ['candidateId'],
  'app.close': ['appId'],
  'window.list': [],
  'window.focus': ['hwnd'],
  'window.restore': ['hwnd'],
  'window.close': ['hwnd'],
  'window.move': ['hwnd', 'x', 'y', 'width', 'height'],
  'window.resize': ['hwnd', 'x', 'y', 'width', 'height'],
  'window.layout': ['items', 'hwnds', 'layout'],
});

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasText(args, ...names) {
  return names.some((name) => typeof args[name] === 'string' && args[name].trim());
}

function requireText(args, names, label) {
  if (!hasText(args, ...names)) throw new Error(`${label} is required`);
}

function requireArray(args, names, label) {
  const value = names.map((name) => args[name]).find(Array.isArray);
  if (!value || value.length === 0) throw new Error(`${label} is required`);
}

function validateActionArgs(action, input) {
  const normalizedAction = normalizeAction(action);
  if (!ACTION_POLICIES[normalizedAction]) throw new Error(`unknown tool action: ${normalizedAction}`);
  if (!isRecord(input)) throw new Error('tool request args must be an object');

  const args = { ...input };
  const allowedKeys = new Set(ACTION_ARG_KEYS[normalizedAction] || []);
  const unknownKey = Object.keys(args).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`unknown argument for ${normalizedAction}: ${unknownKey}`);
  if (Object.prototype.hasOwnProperty.call(args, 'overwrite') && typeof args.overwrite !== 'boolean') {
    throw new Error('overwrite must be a boolean');
  }

  if (normalizedAction === 'file.search') requireText(args, ['query'], 'query');
  if (['file.list_directory', 'file.create_folder', 'file.create_text_file', 'file.delete', 'file.permanent_delete'].includes(normalizedAction)) {
    requireText(args, ['path'], 'path');
  }
  if (['file.open', 'file.open_folder', 'file.reveal'].includes(normalizedAction)) {
    requireText(args, ['path', 'candidateId'], 'path or candidateId');
    if (args.candidateId && !/^candidate-file-[a-zA-Z0-9-]+$/.test(String(args.candidateId))) {
      throw new Error('opaque file candidateId is invalid');
    }
  }
  if (normalizedAction === 'file.rename') {
    requireText(args, ['from', 'path'], 'source path');
    requireText(args, ['newName'], 'newName');
  }
  if (normalizedAction === 'file.move' || normalizedAction === 'file.copy') {
    requireText(args, ['from', 'path'], 'source path');
    requireText(args, ['to', 'destination'], 'destination');
  }
  if (normalizedAction.endsWith('_batch')) requireArray(args, ['paths', 'items'], 'batch paths');

  if (['window.focus', 'window.restore', 'window.close', 'window.move', 'window.resize'].includes(normalizedAction)) {
    const hwnd = Number(args.hwnd);
    if (!Number.isFinite(hwnd) || hwnd <= 0) throw new Error('valid hwnd is required');
  }
  if (normalizedAction === 'window.move' || normalizedAction === 'window.resize') {
    for (const field of ['x', 'y', 'width', 'height']) {
      if (!Number.isFinite(Number(args[field]))) throw new Error(`window ${field} is required`);
    }
  }
  if (normalizedAction === 'window.layout') {
    const hasItems = Array.isArray(args.items) && args.items.length > 0;
    const hasHwnds = Array.isArray(args.hwnds) && args.hwnds.length > 0;
    if (!hasItems && !hasHwnds) throw new Error('window layout items or hwnds are required');
  }

  if (normalizedAction === 'app.resolve') requireText(args, ['query', 'name'], 'app query');
  if (normalizedAction === 'app.launch') {
    const candidateId = String(args.candidateId || '').trim();
    if (!/^candidate-[a-zA-Z0-9-]+$/.test(candidateId)) throw new Error('opaque candidateId is required for app.launch');
  }
  if (normalizedAction === 'app.close') requireText(args, ['appId'], 'appId');

  return args;
}

module.exports = {
  ACTION_ARG_KEYS,
  isRecord,
  validateActionArgs,
};
