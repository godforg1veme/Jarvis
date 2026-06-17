const fs = require("fs");
const path = require("path");

/**
 * Read Steam path from Windows Registry.
 * Steam stores its path in:
 *   HKEY_CURRENT_USER\Software\Valve\Steam\SteamPath
 *   HKEY_LOCAL_MACHINE\Software\Valve\Steam\InstallPath
 *   HKEY_LOCAL_MACHINE\Software\WOW6432Node\Valve\Steam\InstallPath
 */
function readSteamPathFromRegistry() {
  try {
    const { execSync } = require("child_process");

    // Try multiple registry locations
    const regQueries = [
      'reg query "HKEY_CURRENT_USER\\Software\\Valve\\Steam" /v SteamPath 2>nul',
      'reg query "HKEY_LOCAL_MACHINE\\Software\\Valve\\Steam" /v InstallPath 2>nul',
      'reg query "HKEY_LOCAL_MACHINE\\Software\\WOW6432Node\\Valve\\Steam" /v InstallPath 2>nul',
    ];

    for (const query of regQueries) {
      try {
        const output = execSync(query, { encoding: "utf8", timeout: 3000 });
        // Parse output: looks like "    SteamPath    REG_SZ    C:\Program Files (x86)\Steam"
        const match = output.match(/(REG_SZ|REG_EXPAND_SZ)\s+(.+)/);
        if (match) {
          let steamPath = match[2].trim();
          // Normalize forward slashes to backslashes
          steamPath = steamPath.replace(/\//g, "\\");
          if (fs.existsSync(steamPath)) {
            return steamPath;
          }
        }
      } catch (e) {
        // Query failed, try next
      }
    }
  } catch (e) {
    // Registry reading not available (not Windows?)
  }
  return null;
}

function getDefaultSteamPaths() {
  // 1. Try registry first (works for non-default install paths)
  const registryPath = readSteamPathFromRegistry();
  if (registryPath) {
    return [registryPath];
  }

  // 2. Fallback to common install paths
  return [
    "C:\\Program Files (x86)\\Steam",
    "C:\\Program Files\\Steam"
  ];
}

function extractLibraryPaths(libraryFoldersText) {
  const paths = [];
  const regex = /"path"\s+"([^"]+)"/g;
  let match;

  while ((match = regex.exec(libraryFoldersText)) !== null) {
    paths.push(match[1].replace(/\\\\/g, "\\"));
  }

  return paths;
}

async function isSteamAppInstalled(appId) {
  const steamRoots = getDefaultSteamPaths();

  for (const steamRoot of steamRoots) {
    if (!fs.existsSync(steamRoot)) continue;

    // Also check if Steam itself has a steamapps folder
    const directManifestPath = path.join(
      steamRoot,
      "steamapps",
      `appmanifest_${appId}.acf`
    );
    if (fs.existsSync(directManifestPath)) {
      return true;
    }

    const libraryFile = path.join(
      steamRoot,
      "steamapps",
      "libraryfolders.vdf"
    );

    if (!fs.existsSync(libraryFile)) {
      continue;
    }

    const text = fs.readFileSync(libraryFile, "utf8");

    // Check if appId appears anywhere in the file
    if (text.includes(`"${appId}"`)) {
      return true;
    }

    const libraryPaths = extractLibraryPaths(text);

    for (const libraryPath of libraryPaths) {
      const manifestPath = path.join(
        libraryPath,
        "steamapps",
        `appmanifest_${appId}.acf`
      );
      if (fs.existsSync(manifestPath)) {
        return true;
      }
    }

  }

  return false;

}

module.exports = { isSteamAppInstalled };