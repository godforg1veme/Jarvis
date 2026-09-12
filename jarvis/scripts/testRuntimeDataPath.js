const assert = require('assert');
const path = require('path');
const { getWritableDataPath, isPathContained } = require('../runtimeDataPath');

const bundledDataDir = path.resolve('C:\Program Files\Jarvis Desktop\resources\app\data');
const userDataDir = path.resolve('C:\Users\Tester\AppData\Roaming\jarvis');
const historyPath = path.join(bundledDataDir, 'history.json');
const nestedCachePath = path.join(bundledDataDir, 'cache', 'result.json');
const siblingPath = path.resolve(`${bundledDataDir}-backup`, 'history.json');
const outsidePath = path.resolve('C:\Program Files\Jarvis Desktop\resources\app\settings.json');
const packagedApp = {
  isPackaged: true,
  getPath(name) {
    assert.strictEqual(name, 'userData');
    return userDataDir;
  },
};

assert.strictEqual(isPathContained(bundledDataDir, bundledDataDir), true);
assert.strictEqual(isPathContained(bundledDataDir, historyPath), true);
assert.strictEqual(isPathContained(bundledDataDir, siblingPath), false);
assert.strictEqual(isPathContained(bundledDataDir, outsidePath), false);

assert.strictEqual(
  getWritableDataPath(historyPath, { app: { ...packagedApp, isPackaged: false }, bundledDataDir }),
  historyPath,
);
assert.strictEqual(
  getWritableDataPath(historyPath, { app: packagedApp, bundledDataDir }),
  path.join(userDataDir, 'data', 'history.json'),
);
assert.strictEqual(
  getWritableDataPath(nestedCachePath, { app: packagedApp, bundledDataDir }),
  path.join(userDataDir, 'data', 'cache', 'result.json'),
);
assert.strictEqual(
  getWritableDataPath(siblingPath, { app: packagedApp, bundledDataDir }),
  siblingPath,
);
assert.strictEqual(
  getWritableDataPath(outsidePath, { app: packagedApp, bundledDataDir }),
  outsidePath,
);
assert.strictEqual(
  getWritableDataPath(historyPath, {
    app: { isPackaged: true, getPath() { throw new Error('not ready'); } },
    bundledDataDir,
  }),
  historyPath,
);

console.log('testRuntimeDataPath: ok');
