const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { discoverQuick } = require('./appDiscoverySources');
const { getWritableDataPath } = require('../runtimeDataPath');
const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'settings.json');

const EXCLUDED_DIRS = new Set([
  '$recycle.bin', 'system volume information', 'winsxs', 'temp', 'tmp',
  'cache', 'caches', '.git', 'node_modules', '__pycache__', '.venv', 'venv',
  'build', 'dist', 'out',
]);
const SUPPORTED_EXTENSIONS = new Set(['.exe', '.lnk', '.bat', '.cmd', '.ps1']);

function defaultFixedDrives(options = {}) {
  const exec = options.execFileSync || execFileSync;
  try {
    const powershellPath = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe',
    );
    const output = exec(powershellPath, [
      '-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object -ExpandProperty DeviceID",
    ], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    return String(output).split(/\r?\n/).map(value => value.trim()).filter(value => /^[a-z]:$/i.test(value)).map(value => `${value}\\`);
  } catch {
    return ['C:\\'];
  }
}

function shouldExcludeDirectory(name, fullPath) {
  const lowerName = String(name || '').toLowerCase();
  if (EXCLUDED_DIRS.has(lowerName)) return true;
  return /\\windows\\winsxs(?:\\|$)/i.test(String(fullPath || ''));
}

class AppDiscoveryService {
  constructor(options = {}) {
    this.fs = options.fs || fs;
    this.quickSource = options.quickSource || discoverQuick;
    this.driveProvider = options.driveProvider || (() => defaultFixedDrives(options));
    this.now = options.now || Date.now;
    if (options.settings) this.settings = options.settings;
    else {
      try {
        const target = getWritableDataPath(SETTINGS_PATH);
        if (fs.existsSync(target)) this.settings = JSON.parse(fs.readFileSync(target, 'utf8'));
        else if (fs.existsSync(SETTINGS_PATH)) this.settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
        else this.settings = {};
      } catch { this.settings = {}; }
    }
  }

  async discoverQuick(query, options = {}) {
    const recoverySettings = this.settings.appRecovery || {};
    const timeoutMs = options.quickTimeoutMs ?? recoverySettings.quickTimeoutMs ?? 5000;
    return this.quickSource(query, {
      ...options,
      settings: this.settings,
      roots: options.roots || this.settings.scanRoots || [],
      maxEntries: options.quickMaxEntries ?? recoverySettings.quickMaxEntries ?? 3000,
      deadline: this.now() + timeoutMs,
      fs: options.fs || this.fs,
    });
  }

  async discoverExtended(query, options = {}) {
    const recoverySettings = this.settings.appRecovery || {};
    const timeoutMs = options.extendedTimeoutMs ?? recoverySettings.extendedTimeoutMs ?? 120000;
    const deadline = this.now() + timeoutMs;
    const signal = options.signal;
    const maxEntries = options.maxEntries ?? recoverySettings.maxEntries ?? 30000;
    const maxCandidates = options.maxCandidates ?? recoverySettings.maxCandidates ?? 1000;
    const maxDepth = options.maxDepth ?? recoverySettings.maxDepth ?? 8;
    const roots = options.roots || this.driveProvider();
    const queue = roots.map(root => ({ dir: root, depth: 0 }));
    const candidates = [];
    const errors = [];
    let visited = 0;
    let denied = 0;
    let timedOut = false;

    while (queue.length > 0 && visited < maxEntries && candidates.length < maxCandidates) {
      if (signal?.aborted) break;
      if (this.now() >= deadline) { timedOut = true; break; }
      const current = queue.shift();
      let entries;
      try {
        entries = await this.fs.promises.readdir(current.dir, { withFileTypes: true });
      } catch (error) {
        denied += 1;
        if (errors.length < 10) errors.push(error.message);
        continue;
      }
      entries.sort((a, b) => {
        const q = String(query || '').toLowerCase();
        return Number(b.name.toLowerCase().includes(q)) - Number(a.name.toLowerCase().includes(q));
      });
      for (const entry of entries) {
        visited += 1;
        if (signal?.aborted || this.now() >= deadline || visited >= maxEntries) break;
        const fullPath = path.join(current.dir, entry.name);
        if (entry.isDirectory() && current.depth < maxDepth && !shouldExcludeDirectory(entry.name, fullPath)) {
          queue.push({ dir: fullPath, depth: current.depth + 1 });
        } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          const ext = path.extname(entry.name).toLowerCase();
          candidates.push({
            name: path.basename(entry.name, ext),
            aliases: [path.basename(entry.name, ext)],
            type: ext === '.lnk' ? 'lnk' : ['.bat', '.cmd', '.ps1'].includes(ext) ? 'script' : 'exe',
            path: fullPath,
            source: 'disk-scan',
          });
          if (typeof options.onCandidates === 'function') options.onCandidates(candidates.slice(-1));
        }
      }
      if (typeof options.onProgress === 'function') {
        options.onProgress({ visited, found: candidates.length, pendingDirectories: queue.length, denied });
      }
    }

    return { candidates, errors, visited, denied, timedOut, cancelled: !!signal?.aborted };
  }
}

module.exports = {
  EXCLUDED_DIRS,
  SUPPORTED_EXTENSIONS,
  defaultFixedDrives,
  shouldExcludeDirectory,
  AppDiscoveryService,
};
