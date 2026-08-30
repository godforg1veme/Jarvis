const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function parseVdfValue(text, key) {
  const match = String(text || '').match(new RegExp(`"${key}"\\s+"([^"]*)"`, 'i'));
  return match ? match[1].replace(/\\\\/g, '\\') : '';
}

function parseSteamLibraryPaths(text) {
  const paths = [];
  const regex = /"path"\s+"([^"]+)"/gi;
  let match;
  while ((match = regex.exec(String(text || ''))) !== null) paths.push(match[1].replace(/\\\\/g, '\\'));
  return Array.from(new Set(paths));
}

function defaultSteamRoots(options = {}) {
  const roots = [];
  const exec = options.execFileSync || execFileSync;
  try {
    const output = exec('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], {
      encoding: 'utf8', windowsHide: true, timeout: 3000,
    });
    const match = String(output).match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)/i);
    if (match) roots.push(match[1].trim().replace(/\//g, '\\'));
  } catch {}
  roots.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');
  return Array.from(new Set(roots));
}

function discoverSteamApps(options = {}) {
  const fsImpl = options.fs || fs;
  const roots = options.steamRoots || defaultSteamRoots(options);
  const libraries = [];
  for (const root of roots) {
    if (!fsImpl.existsSync(root)) continue;
    libraries.push(root);
    const libraryFile = path.join(root, 'steamapps', 'libraryfolders.vdf');
    try {
      libraries.push(...parseSteamLibraryPaths(fsImpl.readFileSync(libraryFile, 'utf8')));
    } catch {}
  }

  const results = [];
  const seen = new Set();
  for (const library of Array.from(new Set(libraries))) {
    const steamApps = path.join(library, 'steamapps');
    let entries = [];
    try { entries = fsImpl.readdirSync(steamApps, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !/^appmanifest_\d+\.acf$/i.test(entry.name)) continue;
      try {
        const text = fsImpl.readFileSync(path.join(steamApps, entry.name), 'utf8');
        const appId = parseVdfValue(text, 'appid') || (entry.name.match(/\d+/) || [])[0];
        const name = parseVdfValue(text, 'name');
        const installDir = parseVdfValue(text, 'installdir');
        if (!appId || !name || seen.has(appId)) continue;
        seen.add(appId);
        results.push({
          name,
          aliases: [name],
          type: 'steam',
          steamAppId: appId,
          installLocation: installDir ? path.join(steamApps, 'common', installDir) : '',
          source: 'steam-manifest',
        });
      } catch {}
    }
  }
  return results;
}

function discoverEpicApps(options = {}) {
  const fsImpl = options.fs || fs;
  const manifestRoot = options.epicManifestRoot || path.join(
    process.env.ProgramData || 'C:\\ProgramData',
    'Epic', 'EpicGamesLauncher', 'Data', 'Manifests',
  );
  let entries = [];
  try { entries = fsImpl.readdirSync(manifestRoot, { withFileTypes: true }); } catch { return []; }
  const results = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.item')) continue;
    try {
      const item = JSON.parse(fsImpl.readFileSync(path.join(manifestRoot, entry.name), 'utf8'));
      const appName = String(item.AppName || '').trim();
      const displayName = String(item.DisplayName || appName).trim();
      if (!appName || !displayName || !/^[a-zA-Z0-9._-]+$/.test(appName)) continue;
      results.push({
        name: displayName,
        aliases: [displayName],
        type: 'epic',
        epicAppName: appName,
        installLocation: String(item.InstallLocation || ''),
        source: 'epic-manifest',
      });
    } catch {}
  }
  return results;
}

module.exports = {
  parseVdfValue,
  parseSteamLibraryPaths,
  defaultSteamRoots,
  discoverSteamApps,
  discoverEpicApps,
};
