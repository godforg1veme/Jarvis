const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isDangerousFile } = require('../tools/fileSafety');

class FileCandidateVault {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now());
    this.ttlMs = options.ttlMs || 10 * 60 * 1000;
    this.maxEntries = options.maxEntries || 200;
    this.entries = new Map();
  }

  register(candidate) {
    this._prune();
    const candidatePath = path.resolve(String(candidate?.path || ''));
    const stats = fs.statSync(candidatePath);
    const type = stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other';
    if (type === 'other') throw new Error('unsupported file candidate type');
    while (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    const candidateId = `candidate-file-${crypto.randomUUID()}`;
    this.entries.set(candidateId, {
      path: candidatePath,
      type,
      size: stats.isFile() ? stats.size : 0,
      mtimeMs: stats.mtimeMs,
      expiresAt: this.now() + this.ttlMs,
    });
    return {
      candidateId,
      name: path.basename(candidatePath),
      type,
      size: stats.isFile() ? stats.size : 0,
      modifiedAt: stats.mtime.toISOString(),
      dangerous: type === 'file' ? isDangerousFile(candidatePath) : false,
      score: Number(candidate?.score) || 0,
      source: String(candidate?.source || candidate?.provider || 'search').slice(0, 64),
      locationHint: this._locationHint(candidatePath, candidate?.source),
    };
  }

  registerMany(candidates) {
    return (Array.isArray(candidates) ? candidates : []).slice(0, 20).flatMap((candidate) => {
      try { return [this.register(candidate)]; } catch (_) { return []; }
    });
  }

  resolve(candidateId, options = {}) {
    this._prune();
    const id = String(candidateId || '').trim();
    const entry = this.entries.get(id);
    this.entries.delete(id);
    if (!entry) throw new Error('file candidate is unavailable or expired');
    const stats = fs.statSync(entry.path);
    const currentType = stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other';
    if (currentType !== entry.type || (options.expectedType && currentType !== options.expectedType)) {
      throw new Error('file candidate type changed');
    }
    return {
      path: entry.path,
      type: currentType,
      name: path.basename(entry.path),
      size: stats.isFile() ? stats.size : 0,
      modifiedAt: stats.mtime.toISOString(),
      dangerous: currentType === 'file' ? isDangerousFile(entry.path) : false,
    };
  }

  _locationHint(candidatePath, source) {
    const root = path.parse(candidatePath).root.replace(/[\\/]+$/, '');
    const parentName = path.basename(path.dirname(candidatePath));
    const sourceName = String(source || '').trim();
    return [root, sourceName && sourceName !== 'disk' ? sourceName : parentName].filter(Boolean).join(' · ').slice(0, 160);
  }

  _prune() {
    const now = this.now();
    for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id);
  }
}

module.exports = { FileCandidateVault };
