const crypto = require('crypto');
const fs = require('fs');
const { normalizeLaunchDescriptor, canonicalizeLaunchDescriptor } = require('./launchDescriptor');

const POLICY = {
  CONFIRM: 'confirmation_required',
  ALLOW: 'launch_allowed',
  BLOCK: 'blocked',
};

function targetExists(descriptor, options = {}) {
  const existsSync = options.existsSync || fs.existsSync;
  if (['exe', 'lnk', 'script', 'command'].includes(descriptor.type)) {
    if (!existsSync(descriptor.target)) return false;
  }
  if (descriptor.type === 'script' && !existsSync(descriptor.interpreter)) return false;
  return true;
}

function createFingerprint(rawDescriptor, options = {}) {
  const descriptor = normalizeLaunchDescriptor(rawDescriptor);
  const createHash = options.createHash || crypto.createHash;
  const readFileSync = options.readFileSync || fs.readFileSync;
  const hash = createHash('sha256');
  hash.update(canonicalizeLaunchDescriptor(descriptor), 'utf8');

  if (descriptor.type === 'script') {
    hash.update(readFileSync(descriptor.target));
  } else if (descriptor.type === 'command') {
    for (const arg of descriptor.args) {
      if (/\.(bat|cmd|ps1)$/i.test(arg) && /^[a-z]:\\/i.test(arg) && targetExists({ type: 'exe', target: arg }, options)) {
        hash.update(readFileSync(arg));
      }
    }
  }

  return { algorithm: 'sha256', value: hash.digest('hex') };
}

function fingerprintsEqual(a, b) {
  return !!a && !!b && a.algorithm === 'sha256' && b.algorithm === 'sha256' && a.value === b.value;
}

function evaluateLaunchPolicy(rawDescriptor, learnedRecord, options = {}) {
  let descriptor;
  try {
    descriptor = normalizeLaunchDescriptor(rawDescriptor);
  } catch (error) {
    return { decision: POLICY.BLOCK, reason: error.message };
  }

  if (!targetExists(descriptor, options)) return { decision: POLICY.BLOCK, reason: 'launch target is missing' };
  if (!learnedRecord) return { decision: POLICY.CONFIRM, reason: 'first recovered launch' };

  let learnedKey;
  try {
    learnedKey = canonicalizeLaunchDescriptor(learnedRecord.launch);
  } catch {
    return { decision: POLICY.BLOCK, reason: 'learned launch descriptor is invalid' };
  }
  if (learnedKey !== canonicalizeLaunchDescriptor(descriptor)) {
    return { decision: POLICY.CONFIRM, reason: 'launch descriptor changed' };
  }

  if (!['script', 'command'].includes(descriptor.type)) {
    return { decision: POLICY.ALLOW, reason: 'trusted learned application' };
  }

  try {
    const fingerprint = createFingerprint(descriptor, options);
    if (!fingerprintsEqual(fingerprint, learnedRecord.fingerprint)) {
      return { decision: POLICY.CONFIRM, reason: 'script or command fingerprint changed', fingerprint };
    }
    return { decision: POLICY.ALLOW, reason: 'trusted unchanged script or command', fingerprint };
  } catch (error) {
    return { decision: POLICY.BLOCK, reason: `fingerprint failed: ${error.message}` };
  }
}

module.exports = {
  POLICY,
  createFingerprint,
  fingerprintsEqual,
  evaluateLaunchPolicy,
};
