const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseSteamLibraryPaths, discoverSteamApps, discoverEpicApps } = require('../tools/gameAppDiscovery');

assert.deepStrictEqual(parseSteamLibraryPaths('"path" "D:\\\\Games"\n"path" "E:\\\\Steam"'), ['D:\\Games', 'E:\\Steam']);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-games-'));
const steamApps = path.join(root, 'steamapps');
fs.mkdirSync(steamApps, { recursive: true });
fs.writeFileSync(path.join(steamApps, 'appmanifest_570.acf'), '"AppState" { "appid" "570" "name" "Dota 2" "installdir" "dota 2 beta" }');
const steam = discoverSteamApps({ steamRoots: [root] });
assert.strictEqual(steam[0].steamAppId, '570');
assert.strictEqual(steam[0].name, 'Dota 2');

const epicRoot = path.join(root, 'epic');
fs.mkdirSync(epicRoot);
fs.writeFileSync(path.join(epicRoot, 'game.item'), JSON.stringify({ AppName: 'Fortnite', DisplayName: 'Fortnite', InstallLocation: 'D:\\Games\\Fortnite' }));
const epic = discoverEpicApps({ epicManifestRoot: epicRoot });
assert.strictEqual(epic[0].epicAppName, 'Fortnite');

fs.rmSync(root, { recursive: true, force: true });
console.log('testGameAppDiscovery: ok');
