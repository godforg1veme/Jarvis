const path = require('path');

const DANGEROUS_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.ps1',
  '.msi',
  '.reg',
  '.vbs',
  '.js',
  '.jar',
  '.scr',
  '.com',
]);

function normalizeExtension(fileName) {
  return path.extname(String(fileName || '')).toLowerCase();
}

function isDangerousFile(fileName) {
  return DANGEROUS_EXTENSIONS.has(normalizeExtension(fileName));
}

function toFileCandidate(filePath, stats, source, score = 0) {
  const name = path.basename(filePath);
  const extension = normalizeExtension(name);

  return {
    type: 'file',
    name,
    path: filePath,
    extension,
    directory: path.dirname(filePath),
    size: stats && typeof stats.size === 'number' ? stats.size : 0,
    modifiedAt: stats && stats.mtime ? stats.mtime.toISOString() : '',
    source: source || 'live',
    score,
    dangerous: isDangerousFile(name),
  };
}

module.exports = {
  DANGEROUS_EXTENSIONS,
  normalizeExtension,
  isDangerousFile,
  toFileCandidate,
};
