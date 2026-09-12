const { execSync } = require('child_process');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getWritableDataPath } = require('../runtimeDataPath');

const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'settings.json');
const INDEX_PATH = path.join(__dirname, '..', 'data', 'app-index.json');

// --- Helpers ---
function loadJSON(filePath, fallback) {
  try {
    const target = getWritableDataPath(filePath);
    if (fs.existsSync(target)) return JSON.parse(fs.readFileSync(target, 'utf-8'));
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return fallback;
  } catch { return fallback; }
}

function saveJSON(filePath, data) {
  try {
    const target = getWritableDataPath(filePath);
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[appIndexer] Failed to write ${filePath}:`, err);
  }
}

function expandEnv(str) {
  return str.replace(/%([^%]+)%/g, (_, name) => process.env[name] || '');
}

function normalize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSafeName(name) {
  return /^[a-zA-Z0-9._-]+$/.test(name);
}

// --- Source 1: Start Menu .lnk shortcuts ---
async function indexStartMenu() {
  const apps = [];
  const startMenuPaths = [
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs',
  ];

  for (const smDir of startMenuPaths) {
    if (!fs.existsSync(smDir)) continue;
    try {
      const ps = `Get-ChildItem -Path "${smDir}" -Recurse -Filter *.lnk | ForEach-Object { [PSCustomObject]@{ Name=[System.IO.Path]::GetFileNameWithoutExtension($_.Name); FullName=$_.FullName } } | ConvertTo-Json -Compress`;
      const result = execSync(`powershell.exe -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"')}"`, {
        encoding: 'utf-8',
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      }).trim();

      if (!result) continue;
      const items = JSON.parse(result);
      const arr = Array.isArray(items) ? items : [items];

      for (const item of arr) {
        apps.push({
          name: item.Name,
          aliases: [normalize(item.Name)],
          type: 'lnk',
          path: item.FullName,
          source: 'start-menu',
          sourcePriority: 2,
          discoveredAt: new Date().toISOString(),
        });
      }
    } catch {}
  }
  return apps;
}

// --- Source 2: Get-StartApps for UWP ---
async function indexUWP() {
  const apps = [];
  try {
    const result = execSync('powershell.exe -NoProfile -NonInteractive -Command "Get-StartApps | ConvertTo-Json -Compress"', {
      encoding: 'utf-8',
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    }).trim();

    if (!result) return apps;
    const items = JSON.parse(result);
    const arr = Array.isArray(items) ? items : [items];

    for (const item of arr) {
      apps.push({
        name: item.Name || item.AppName || '',
        aliases: [normalize(item.Name || item.AppName || '')],
        type: 'uwp',
        aumid: item.AppID || item.AppId || '',
        source: 'uwp',
        sourcePriority: 4,
        discoveredAt: new Date().toISOString(),
      });
    }
  } catch {}
  return apps;
}

// --- Source 3: Windows App Paths registry ---
async function indexAppPathsRegistry() {
  const apps = [];
  const hives = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  ];

  for (const hive of hives) {
    try {
      const result = execSync(`reg query "${hive}" /s`, {
        encoding: 'utf-8',
        timeout: 10000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });

      const lines = result.split('\n');
      let currentName = '';

      for (const line of lines) {
        const trimmed = line.trim();

        // Detect key (app name)
        if (trimmed.startsWith(hive.replace(/\\/g, '\\\\')) || trimmed.startsWith(hive)) {
          const parts = trimmed.split('\\');
          currentName = parts[parts.length - 1] || '';
          // Remove .exe suffix if present
          currentName = currentName.replace(/\.exe$/i, '');
        }

        // Detect (Default) or (Default) value with path
        if (trimmed.startsWith('(默认)') || trimmed.startsWith('(Default)')) {
          const match = trimmed.match(/REG_SZ\s+(.+)/i);
          if (match && currentName) {
            const appPath = match[1].trim();
            if (appPath && (appPath.endsWith('.exe') || appPath.includes('\\'))) {
              apps.push({
                name: currentName,
                aliases: [normalize(currentName)],
                type: 'exe',
                path: appPath,
                source: 'app-paths',
                sourcePriority: 3,
                discoveredAt: new Date().toISOString(),
              });
            }
          }
        }
      }
    } catch {}
  }
  return apps;
}

// --- Source 4: scanRoots (recursive .exe scan) ---
function scanRootsSync(dir, maxDepth, currentDepth, maxFiles, count) {
  const apps = [];
  if (currentDepth > maxDepth || count.current >= maxFiles) return apps;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (count.current >= maxFiles) break;

      // Skip known slow/useless dirs
      if (entry.isDirectory() && !entry.name.startsWith('.') && !['node_modules', '__pycache__', '.git', 'venv'].includes(entry.name)) {
        count.current++;
        const subApps = scanRootsSync(path.join(dir, entry.name), maxDepth, currentDepth + 1, maxFiles, count);
        apps.push(...subApps);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
        count.current++;
        const name = entry.name.replace(/\.exe$/i, '');
        apps.push({
          name,
          aliases: [normalize(name)],
          type: 'exe',
          path: path.join(dir, entry.name),
          source: 'scan-roots',
          sourcePriority: 6,
          discoveredAt: new Date().toISOString(),
        });
      }
    }
  } catch {}

  return apps;
}

async function indexScanRoots() {
  const settings = loadJSON(SETTINGS_PATH, { scanRoots: [], maxDepth: 3, maxFiles: 20000 });
  const apps = [];

  for (const root of (settings.scanRoots || [])) {
    const expanded = expandEnv(root);
    if (!fs.existsSync(expanded)) continue;
    const count = { current: 0 };
    apps.push(...scanRootsSync(expanded, settings.maxDepth || 3, 0, settings.maxFiles || 20000, count));
  }

  return apps;
}

// --- Source 5: Popular commands via where.exe ---
const POPULAR_COMMANDS = [
  'notepad', 'calc', 'mspaint', 'cmd', 'powershell', 'explorer',
  'code', 'chrome', 'firefox', 'msedge', 'opera', 'brave',
  'steam', 'discord', 'slack', 'telegram', 'whatsapp',
  '7z', 'git', 'python', 'node', 'npm', 'pnpm',
  'curl', 'wget', 'adb', 'docker',
];

function indexWherePopular() {
  const apps = [];
  for (const cmd of POPULAR_COMMANDS) {
    try {
      const result = execSync(`where.exe ${cmd}`, {
        encoding: 'utf-8',
        timeout: 3000,
        windowsHide: true,
      }).trim();
      const firstLine = result.split('\n')[0].trim();
      if (firstLine && fs.existsSync(firstLine)) {
        apps.push({
          name: cmd,
          aliases: [normalize(cmd)],
          type: 'exe',
          path: firstLine,
          source: 'where',
          sourcePriority: 7,
          discoveredAt: new Date().toISOString(),
        });
      }
    } catch {}
  }
  return apps;
}

// --- Dedupe ---
function dedupeApps(apps) {
  const seen = new Map();
  const result = [];

  for (const app of apps) {
    const name = normalize(app.name);
    const key = app.type === 'uwp'
      ? `uwp:${name}:${normalize(app.aumid || '')}`
      : `${app.type}:${name}:${normalize(app.path || app.command || '')}`;

    if (!seen.has(key)) {
      seen.set(key, true);
      result.push(app);
    }
  }

  return result;
}

// --- Main: Index all sources ---
async function indexAll() {
  console.log('[Jarvis Indexer] Starting full index...');
  const startTime = Date.now();

  // Run sources in parallel where possible
  const [startMenuApps, uwpApps, registryApps, scanRootsApps] = await Promise.all([
    indexStartMenu(),
    indexUWP(),
    indexAppPathsRegistry(),
    indexScanRoots(),
  ]);

  // Sync where.exe
  const whereApps = indexWherePopular();

  const allApps = dedupeApps([
    ...startMenuApps,
    ...uwpApps,
    ...registryApps,
    ...scanRootsApps,
    ...whereApps,
  ]);

  const elapsed = Date.now() - startTime;
  console.log(`[Jarvis Indexer] Indexed ${allApps.length} apps in ${elapsed}ms`);

  const index = {
    updatedAt: new Date().toISOString(),
    apps: allApps,
  };

  saveJSON(INDEX_PATH, index);
  return index;
}

// --- Get cached index ---
function getIndex() {
  return loadJSON(INDEX_PATH, { updatedAt: null, apps: [] });
}

module.exports = { indexAll, getIndex };
