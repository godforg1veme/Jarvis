function buildWindowsAutoStartSettings({ isPackaged, execPath, appPath }) {
  if (!execPath) throw new Error('Electron executable path is required.');
  if (!isPackaged && !appPath) throw new Error('Application path is required in development mode.');

  return {
    openAtLogin: true,
    path: execPath,
    args: isPackaged ? ['--hidden'] : [appPath, '--hidden'],
  };
}

module.exports = { buildWindowsAutoStartSettings };
