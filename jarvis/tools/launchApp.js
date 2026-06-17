const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Launch an app based on its type.
 * @param {Object} app - { type, path, aumid, command, name }
 * @returns {Promise<Object>} - Jarvis result format
 */
async function launch(app) {
  if (!app) {
    return {
      ok: false,
      type: 'run',
      title: 'Ошибка запуска',
      content: 'Приложение не указано.',
      error: 'app is required',
    };
  }

  switch (app.type) {
    case 'exe':
      return launchExe(app);
    case 'lnk':
      return launchLnk(app);
    case 'uwp':
      return launchUwp(app);
    case 'command':
      return launchCommand(app);
    default:
      // Fallback: command entries often have `command` but no `path`.
      if (app.command) return launchCommand(app);
      // Otherwise try as exe.
      return launchExe(app);
  }
}

function launchExe(app) {
  const appPath = app.path;
  if (!appPath) {
    return failResult(app.name, 'Path not specified');
  }

  if (!fs.existsSync(appPath)) {
    return failResult(app.name, `File not found: ${appPath}`);
  }

  return new Promise((resolve) => {
    try {
      const cwd = path.dirname(appPath);
      const child = spawn(appPath, [], {
        detached: true,
        stdio: 'ignore',
        cwd,
        windowsHide: false,
      });
      child.unref();

      resolve({
        ok: true,
        type: 'run',
        title: `Запущен: ${app.name || path.basename(appPath)}`,
        content: `Программа "${app.name || path.basename(appPath)}" успешно запущена.`,
        data: { name: app.name, path: appPath, type: 'exe' },
      });
    } catch (err) {
      resolve(failResult(app.name, err.message));
    }
  });
}

function launchLnk(app) {
  const lnkPath = app.path;
  if (!lnkPath) {
    return failResult(app.name, 'Path not specified');
  }

  return new Promise((resolve) => {
    exec(`cmd /c start "" "${lnkPath}"`, { shell: 'cmd.exe', timeout: 5000 }, (err) => {
      if (err) {
        resolve(failResult(app.name, err.message));
      } else {
        resolve({
          ok: true,
          type: 'run',
          title: `Запущен: ${app.name}`,
          content: `Ярлык "${app.name}" успешно запущен.`,
          data: { name: app.name, path: lnkPath, type: 'lnk' },
        });
      }
    });
  });
}

function launchUwp(app) {
  const aumid = app.aumid;
  if (!aumid) {
    return failResult(app.name, 'AUMID not specified for UWP app');
  }

  return new Promise((resolve) => {
    exec(`explorer.exe "shell:AppsFolder\\${aumid}"`, { shell: 'cmd.exe', timeout: 5000 }, (err) => {
      if (err) {
        resolve(failResult(app.name, err.message));
      } else {
        resolve({
          ok: true,
          type: 'run',
          title: `Запущен: ${app.name}`,
          content: `UWP приложение "${app.name}" успешно запущено.`,
          data: { name: app.name, aumid, type: 'uwp' },
        });
      }
    });
  });
}

function launchCommand(app) {
  const command = app.command || app.path;
  if (!command) {
    return failResult(app.name, 'Command not specified');
  }

  return new Promise((resolve) => {
    try {
      const child = spawn(command, [], {
        detached: true,
        stdio: 'ignore',
        shell: true,
        windowsHide: false,
      });
      child.unref();

      resolve({
        ok: true,
        type: 'run',
        title: `Выполнено: ${app.name || command}`,
        content: `Команда "${app.name || command}" успешно выполнена.`,
        data: { name: app.name, command, type: 'command' },
      });
    } catch (err) {
      resolve(failResult(app.name, err.message));
    }
  });
}

function failResult(name, error) {
  return {
    ok: false,
    type: 'run',
    title: `Ошибка запуска: ${name || 'unknown'}`,
    content: `Не удалось запустить "${name || 'unknown'}".\n${error}`,
    error,
  };
}

module.exports = { launch };