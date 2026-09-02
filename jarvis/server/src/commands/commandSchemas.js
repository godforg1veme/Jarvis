const { z } = require('zod');
const path = require('node:path');

const POLICY = Object.freeze({
  OBSERVE: 'observe',
  LOW_RISK: 'low_risk',
  CONFIRM: 'requires_confirmation',
  STRONG: 'requires_strong_confirmation',
});

const ACTION_POLICIES = Object.freeze({
  'file.search': POLICY.OBSERVE,
  'file.list_directory': POLICY.OBSERVE,
  'app.resolve': POLICY.OBSERVE,
  'window.list': POLICY.OBSERVE,
  // The cloud cannot inspect the target extension before reaching Desktop.
  // Require source-client confirmation so the local dangerous-file guard is never bypassed.
  'file.open': POLICY.CONFIRM,
  // Desktop verifies this is a directory before opening it; no executable can run.
  'file.open_folder': POLICY.LOW_RISK,
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
});

const OVERWRITE_CAPABLE_ACTIONS = new Set([
  'file.create_folder',
  'file.create_text_file',
  'file.move',
  'file.copy',
]);

const DANGEROUS_OPEN_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.ps1', '.msi', '.reg', '.vbs', '.js', '.jar', '.scr', '.com',
]);

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

const commandInputSchema = z.object({
  deviceId: z.string().uuid(),
  action: z.string().min(1).max(128),
  args: z.record(z.string(), z.unknown()).default({}),
}).strict();

function requireText(args, names, label, max = 4096) {
  const name = names.find((candidate) => typeof args[candidate] === 'string' && args[candidate].trim());
  if (!name) throw new Error(`${label} is required`);
  if (String(args[name]).length > max) throw new Error(`${label} is too long`);
}

function requireNumber(args, field, label) {
  const value = Number(args[field]);
  if (!Number.isFinite(value)) throw new Error(`${label} is required`);
}

function requireArray(args, names, label, max = 20) {
  const value = names.map((name) => args[name]).find(Array.isArray);
  if (!value || value.length === 0 || value.length > max) throw new Error(`${label} is invalid`);
  return value;
}

function validateActionArgs(action, input = {}) {
  if (!Object.prototype.hasOwnProperty.call(ACTION_POLICIES, action)) throw new Error(`unknown tool action: ${action}`);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('command args must be an object');
  const args = { ...input };
  const allowedKeys = new Set(ACTION_ARG_KEYS[action] || []);
  const unknownKey = Object.keys(args).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`unknown argument for ${action}: ${unknownKey}`);
  if (Object.prototype.hasOwnProperty.call(args, 'overwrite') && typeof args.overwrite !== 'boolean') {
    throw new Error('overwrite must be a boolean');
  }

  if (action === 'file.search') requireText(args, ['query'], 'query', 1000);
  if (['file.list_directory', 'file.create_folder', 'file.create_text_file', 'file.delete', 'file.permanent_delete'].includes(action)) {
    requireText(args, ['path'], 'path', 2048);
  }
  if (['file.open', 'file.open_folder', 'file.reveal'].includes(action)) {
    requireText(args, ['path', 'candidateId'], 'path or candidateId', 2048);
    if (args.candidateId && !/^candidate-file-[a-zA-Z0-9-]+$/.test(String(args.candidateId))) {
      throw new Error('opaque file candidateId is invalid');
    }
  }
  if (action === 'file.create_text_file' && typeof args.content === 'string' && args.content.length > 100000) {
    throw new Error('content is too long');
  }
  if (action === 'file.rename') {
    requireText(args, ['from', 'path'], 'source path', 2048);
    requireText(args, ['newName'], 'newName', 255);
  }
  if (['file.move', 'file.copy'].includes(action)) {
    requireText(args, ['from', 'path'], 'source path', 2048);
    requireText(args, ['to', 'destination'], 'destination', 2048);
  }
  if (action.endsWith('_batch')) requireArray(args, ['paths', 'items'], 'batch paths');
  if (['window.focus', 'window.restore', 'window.close', 'window.move', 'window.resize'].includes(action)) {
    requireNumber(args, 'hwnd', 'hwnd');
  }
  if (['window.move', 'window.resize'].includes(action)) {
    for (const field of ['x', 'y', 'width', 'height']) requireNumber(args, field, `window ${field}`);
  }
  if (action === 'window.layout') {
    const items = Array.isArray(args.items) ? args.items : [];
    const hwnds = Array.isArray(args.hwnds) ? args.hwnds : [];
    if (items.length === 0 && hwnds.length === 0) throw new Error('window layout items or hwnds are required');
    if (items.length > 20 || hwnds.length > 20) throw new Error('window layout is too large');
  }
  if (action === 'app.resolve') requireText(args, ['query', 'name'], 'app query', 1000);
  if (action === 'app.launch') {
    if (!/^candidate-[a-zA-Z0-9-]+$/.test(String(args.candidateId || ''))) throw new Error('opaque candidateId is required');
  }
  if (action === 'app.close') requireText(args, ['appId'], 'appId', 128);
  return args;
}

function policyForAction(action, args = {}) {
  const base = ACTION_POLICIES[action] || '';
  if (action === 'file.open' && typeof args.path === 'string' && args.path.trim()) {
    return DANGEROUS_OPEN_EXTENSIONS.has(path.extname(args.path.trim()).toLowerCase())
      ? POLICY.CONFIRM
      : POLICY.LOW_RISK;
  }
  if (base && args.overwrite === true && OVERWRITE_CAPABLE_ACTIONS.has(action)) return POLICY.STRONG;
  return base;
}

function validateCommandInput(input) {
  const parsed = commandInputSchema.parse(input);
  const args = validateActionArgs(parsed.action, parsed.args);
  return { ...parsed, args, policy: policyForAction(parsed.action, args) };
}

function validateCommandResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('command result must be an object');
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, 'utf8') > 128 * 1024) throw new Error('command result is too large');
  if (Object.prototype.hasOwnProperty.call(result, 'ok') && typeof result.ok !== 'boolean') throw new Error('command result ok must be boolean');
  return result;
}

module.exports = {
  ACTION_POLICIES,
  ACTION_ARG_KEYS,
  DANGEROUS_OPEN_EXTENSIONS,
  OVERWRITE_CAPABLE_ACTIONS,
  POLICY,
  policyForAction,
  validateActionArgs,
  validateCommandInput,
  validateCommandResult,
};
