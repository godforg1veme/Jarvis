const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizeAlias } = require('./appIdentity');
const { normalizeLaunchDescriptor, canonicalizeLaunchDescriptor } = require('./launchDescriptor');

const HELPER_WORDS = /(?:unins(?:tall)?|setup|update(?:r)?|crash(?:pad|report)?|helper|service|maintenance)/i;

function generalizeLocation(target) {
  const value = String(target || '').toLowerCase();
  const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(item => item.toLowerCase());
  if (programFiles.some(root => value === root || value.startsWith(`${root.toLowerCase()}\\`))) return 'Program Files';
  const local = String(process.env.LOCALAPPDATA || '').toLowerCase();
  if (local && (value === local || value.startsWith(`${local}\\`))) return 'user apps';
  return target ? 'other local drive' : 'registered app';
}

function inferScriptDescriptor(filePath, options = {}) {
  const systemRoot = options.systemRoot || process.env.SystemRoot || 'C:\\Windows';
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.ps1') {
    return {
      type: 'script',
      target: filePath,
      interpreter: path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: [],
    };
  }
  return {
    type: 'script',
    target: filePath,
    interpreter: path.join(systemRoot, 'System32', 'cmd.exe'),
    args: [],
  };
}

function rawToDescriptor(raw, options = {}) {
  if (raw.launch) return normalizeLaunchDescriptor(raw.launch);
  const type = String(raw.type || '').toLowerCase();
  if (type === 'uwp') return normalizeLaunchDescriptor({ type, target: raw.aumid, args: [] });
  if (type === 'steam') return normalizeLaunchDescriptor({ type, target: raw.steamAppId || raw.appId, args: [] });
  if (type === 'epic') return normalizeLaunchDescriptor({ type, target: raw.epicAppName || raw.appName, args: [] });
  const target = String(raw.path || raw.command || '').trim();
  const ext = path.extname(target).toLowerCase();
  if (type === 'script' || ['.bat', '.cmd', '.ps1'].includes(ext)) return normalizeLaunchDescriptor(inferScriptDescriptor(target, options));
  return normalizeLaunchDescriptor({ type: type || (raw.command ? 'command' : 'exe'), target, args: raw.args || [] });
}

function validateCandidate(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('raw candidate must be an object');
  const descriptor = rawToDescriptor(raw, options);
  const existsSync = options.existsSync || fs.existsSync;
  if (['exe', 'lnk', 'script', 'command'].includes(descriptor.type) && !existsSync(descriptor.target)) {
    throw new Error('candidate target is missing');
  }
  if (descriptor.type === 'script' && !existsSync(descriptor.interpreter)) throw new Error('script interpreter is missing');
  const displayName = String(raw.name || raw.displayName || path.basename(descriptor.target, path.extname(descriptor.target))).trim();
  if (!displayName || displayName.length > 256) throw new Error('candidate display name is invalid');
  const randomId = options.randomId || (() => crypto.randomUUID());
  const helper = HELPER_WORDS.test(displayName) || HELPER_WORDS.test(path.basename(descriptor.target || ''));
  const candidate = {
    candidateId: `candidate-${randomId()}`,
    displayName,
    aliases: Array.isArray(raw.aliases) ? raw.aliases.map(normalizeAlias).filter(Boolean) : [],
    source: String(raw.source || 'unknown'),
    launch: descriptor,
    productName: String(raw.productName || ''),
    description: String(raw.description || ''),
    publisher: String(raw.publisher || ''),
    signatureStatus: String(raw.signatureStatus || 'unknown'),
    generalizedLocation: generalizeLocation(raw.installLocation || descriptor.target),
    helper,
    localScore: 0,
  };
  candidate.identityKey = canonicalizeLaunchDescriptor(descriptor);
  return candidate;
}

function localScore(query, candidate) {
  const normalized = normalizeAlias(query);
  const tokens = normalized.split(' ').filter(Boolean);
  const names = [candidate.displayName, candidate.productName, candidate.description, ...(candidate.aliases || [])]
    .map(normalizeAlias).filter(Boolean);
  let score = 0;
  if (names.some(name => name === normalized)) score = 0.98;
  else if (names.some(name => name.startsWith(normalized) || normalized.startsWith(name))) score = 0.88;
  else if (tokens.length > 0) {
    const matched = tokens.filter(token => names.some(name => name.includes(token))).length;
    score = Math.min(0.82, matched / tokens.length * 0.82);
  }
  if (candidate.source === 'start-menu' || candidate.source === 'app-paths') score += 0.04;
  if (candidate.helper && !normalizeAlias(candidate.displayName).includes(normalized)) score -= 0.35;
  return Math.max(0, Math.min(1, score));
}

function validateAndRank(rawCandidates, query, options = {}) {
  const byIdentity = new Map();
  for (const raw of Array.isArray(rawCandidates) ? rawCandidates : []) {
    try {
      const candidate = validateCandidate(raw, options);
      candidate.localScore = localScore(query, candidate);
      const existing = byIdentity.get(candidate.identityKey);
      if (!existing || candidate.localScore > existing.localScore) byIdentity.set(candidate.identityKey, candidate);
    } catch {}
  }
  return Array.from(byIdentity.values()).sort((a, b) => b.localScore - a.localScore || a.displayName.localeCompare(b.displayName));
}

function providerMetadata(candidate) {
  const safeText = value => {
    const text = String(value || '');
    if (/[a-zA-Z]:\\|\\\\/.test(text)) return '[redacted]';
    return text.slice(0, 500);
  };
  return {
    candidateId: candidate.candidateId,
    displayName: safeText(candidate.displayName),
    type: candidate.launch.type,
    productName: safeText(candidate.productName),
    description: safeText(candidate.description),
    publisher: safeText(candidate.publisher),
    signatureStatus: candidate.signatureStatus,
    location: candidate.generalizedLocation,
    localScore: candidate.localScore,
  };
}

module.exports = {
  HELPER_WORDS,
  generalizeLocation,
  inferScriptDescriptor,
  rawToDescriptor,
  validateCandidate,
  validateAndRank,
  localScore,
  providerMetadata,
};
