const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { getTrayIconPath, createTrayIcon } = require("../trayIcon");

const iconPath = getTrayIconPath();
assert.strictEqual(path.basename(iconPath), "tray-icon.png");
assert.strictEqual(path.basename(path.dirname(iconPath)), "assets");
assert.ok(fs.existsSync(iconPath), "tray icon asset must exist");

const calls = [];
const fakeNativeImage = {
  createFromPath(filePath) {
    calls.push(filePath);
    return {
      isEmpty: () => false,
      resize: ({ width, height }) => ({ filePath, width, height }),
    };
  },
};

const icon = createTrayIcon(fakeNativeImage);
assert.deepStrictEqual(calls, [iconPath]);
assert.deepStrictEqual(icon, {
  filePath: iconPath,
  width: 16,
  height: 16,
});

console.log("[test] tray icon OK");
