const path = require('path');

const SCHEMA_VERSION = 1;
const ALLOWED_TYPES = new Set(['exe', 'lnk', 'uwp', 'steam', 'epic', 'script', 'command']);
const MAX_TARGET_LENGTH = 32767;
const MAX_ARG_LENGTH = 8192;
const MAX_ARGS = 64;

function cleanString(value, label, maxLength) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} is required`);
  if (cleaned.includes('\0')) throw new Error(`${label} contains NUL`);
  if (cleaned.length > maxLength) throw new Error(`${label} is too long`);
  return cleaned;
}

function normalizeArgs(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('launch args must be an array');
  if (value.length > MAX_ARGS) throw new Error('too many launch args');
  return value.map((arg, index) => cleanString(arg, `launch arg #${index + 1}`, MAX_ARG_LENGTH));
}

function isAbsoluteLocalPath(value) {
  return path.win32.isAbsolute(value) && !value.startsWith('\\\\');
}

function requireAbsoluteLocalPath(value, label) {
  const cleaned = cleanString(value, label, MAX_TARGET_LENGTH);
  if (!isAbsoluteLocalPath(cleaned)) throw new Error(`${label} must be an absolute local path`);
  return path.win32.normalize(cleaned);
}

function normalizeLaunchDescriptor(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('launch descriptor must be an object');
  }
  if (raw.schemaVersion !== undefined && Number(raw.schemaVersion) !== SCHEMA_VERSION) {
    throw new Error('unsupported launch descriptor schema version');
  }

  const type = cleanString(raw.type, 'launch type', 32).toLowerCase();
  if (!ALLOWED_TYPES.has(type)) throw new Error(`unsupported launch type: ${type}`);
  const args = normalizeArgs(raw.args);
  const result = { schemaVersion: SCHEMA_VERSION, type, target: '', args };

  if (['exe', 'lnk', 'command'].includes(type)) {
    result.target = requireAbsoluteLocalPath(raw.target, 'launch target');
    return result;
  }

  if (type === 'script') {
    result.target = requireAbsoluteLocalPath(raw.target, 'script target');
    result.interpreter = requireAbsoluteLocalPath(raw.interpreter, 'script interpreter');
    return result;
  }

  if (type === 'steam') {
    const appId = cleanString(raw.target, 'Steam app id', 20);
    if (!/^\d+$/.test(appId)) throw new Error('Steam app id must be numeric');
    result.target = appId;
    return result;
  }

  if (type === 'epic') {
    const appName = cleanString(raw.target, 'Epic app name', 256);
    if (!/^[a-zA-Z0-9._-]+$/.test(appName)) throw new Error('Epic app name contains unsafe characters');
    result.target = appName;
    return result;
  }

  const aumid = cleanString(raw.target, 'UWP AUMID', 512);
  if (!/^[a-zA-Z0-9._-]+![a-zA-Z0-9._-]+$/.test(aumid)) throw new Error('invalid UWP AUMID');
  result.target = aumid;
  return result;
}

function canonicalizeLaunchDescriptor(raw) {
  const descriptor = normalizeLaunchDescriptor(raw);
  const canonical = {
    schemaVersion: descriptor.schemaVersion,
    type: descriptor.type,
    target: descriptor.target.toLowerCase(),
    args: descriptor.args,
  };
  if (descriptor.interpreter) canonical.interpreter = descriptor.interpreter.toLowerCase();
  return JSON.stringify(canonical);
}

function candidateToLaunchDescriptor(candidate) {
  if (!candidate || typeof candidate !== 'object') throw new Error('candidate is required');
  if (candidate.launch) return normalizeLaunchDescriptor(candidate.launch);

  const type = String(candidate.type || (candidate.command ? 'command' : 'exe')).toLowerCase();
  if (type === 'uwp') return normalizeLaunchDescriptor({ type, target: candidate.aumid, args: [] });
  if (type === 'steam') return normalizeLaunchDescriptor({ type, target: candidate.steamAppId || candidate.appId, args: [] });
  if (type === 'epic') return normalizeLaunchDescriptor({ type, target: candidate.epicAppName || candidate.appName, args: [] });
  if (type === 'script') {
    return normalizeLaunchDescriptor({
      type,
      target: candidate.path || candidate.target,
      interpreter: candidate.interpreter,
      args: candidate.args || [],
    });
  }
  return normalizeLaunchDescriptor({
    type,
    target: candidate.path || candidate.command || candidate.target,
    args: candidate.args || [],
  });
}

module.exports = {
  SCHEMA_VERSION,
  ALLOWED_TYPES,
  normalizeLaunchDescriptor,
  canonicalizeLaunchDescriptor,
  candidateToLaunchDescriptor,
  isAbsoluteLocalPath,
};
