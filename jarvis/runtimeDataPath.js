const path = require('path');

const DEFAULT_BUNDLED_DATA_DIR = path.resolve(__dirname, 'data');

function getElectronApp() {
  try {
    return require('electron').app || null;
  } catch {
    return null;
  }
}

function isPathContained(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function getWritableDataPath(filePath, options = {}) {
  try {
    const electronApp = Object.prototype.hasOwnProperty.call(options, 'app')
      ? options.app
      : getElectronApp();
    if (!electronApp || !electronApp.isPackaged || typeof electronApp.getPath !== 'function') {
      return filePath;
    }

    const bundledDataDir = path.resolve(options.bundledDataDir || DEFAULT_BUNDLED_DATA_DIR);
    const resolvedFilePath = path.resolve(filePath);
    if (!isPathContained(bundledDataDir, resolvedFilePath)) return filePath;

    const relative = path.relative(bundledDataDir, resolvedFilePath);
    return path.join(electronApp.getPath('userData'), 'data', relative);
  } catch {
    return filePath;
  }
}

module.exports = {
  DEFAULT_BUNDLED_DATA_DIR,
  getWritableDataPath,
  isPathContained,
};
