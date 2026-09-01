const { ACTION_POLICIES, normalizeAction } = require('./toolPolicy');

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
  if (Object.prototype.hasOwnProperty.call(args, 'overwrite') && typeof args.overwrite !== 'boolean') {
    throw new Error('overwrite must be a boolean');
  }

  if (normalizedAction === 'file.search') requireText(args, ['query'], 'query');
  if (['file.list_directory', 'file.open', 'file.reveal', 'file.create_folder', 'file.create_text_file', 'file.delete', 'file.permanent_delete'].includes(normalizedAction)) {
    requireText(args, ['path'], 'path');
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
  isRecord,
  validateActionArgs,
};
