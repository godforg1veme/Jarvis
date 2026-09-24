const { spawn: defaultSpawn, execFileSync: defaultExecFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { candidateToLaunchDescriptor, normalizeLaunchDescriptor } = require('./launchDescriptor');

const DEFAULT_OBSERVE_MS = 1500;

function windowsSystemPath(...segments) {
  return path.join(process.env.SystemRoot || 'C:\\Windows', ...segments);
}

function validateBatchArgument(value, label) {
  if (/["&|<>^%!()\r\n]/.test(String(value))) {
    throw new Error(`${label} contains unsafe cmd.exe metacharacters`);
  }
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

function successResult(name, descriptor) {
  return {
    ok: true,
    type: 'run',
    title: `Запущен: ${name || 'приложение'}`,
    content: `Программа "${name || 'приложение'}" успешно запущена.`,
    data: { name, type: descriptor.type },
  };
}

function platformLaunchCommand(descriptor) {
  const explorer = windowsSystemPath('explorer.exe');
  if (descriptor.type === 'lnk') return { executable: explorer, args: [descriptor.target] };
  if (descriptor.type === 'uwp') return { executable: explorer, args: [`shell:AppsFolder\\${descriptor.target}`] };
  if (descriptor.type === 'steam') return { executable: explorer, args: [`steam://rungameid/${descriptor.target}`] };
  if (descriptor.type === 'epic') {
    return {
      executable: explorer,
      args: [`com.epicgames.launcher://apps/${encodeURIComponent(descriptor.target)}?action=launch&silent=true`],
    };
  }
  return null;
}

function descriptorCommand(descriptor) {
  const platform = platformLaunchCommand(descriptor);
  if (platform) return platform;
  if (descriptor.type === 'script') {
    const ext = path.extname(descriptor.target).toLowerCase();
    if (ext === '.ps1') {
      return {
        executable: descriptor.interpreter,
        args: ['-NoProfile', '-NonInteractive', '-File', descriptor.target, ...descriptor.args],
      };
    }
    if (ext === '.bat' || ext === '.cmd') {
      validateBatchArgument(descriptor.target, 'Batch script path');
      descriptor.args.forEach((arg, index) => validateBatchArgument(arg, `Batch argument #${index + 1}`));
      return { executable: descriptor.interpreter, args: ['/d', '/c', descriptor.target, ...descriptor.args] };
    }
    throw new Error('Unsupported script extension');
  }
  return { executable: descriptor.target, args: descriptor.args };
}

function validateExistingTargets(descriptor, options = {}) {
  const existsSync = options.existsSync || fs.existsSync;
  if (['exe', 'lnk', 'script', 'command'].includes(descriptor.type) && !existsSync(descriptor.target)) {
    throw new Error('Launch target not found');
  }
  if (descriptor.type === 'script' && !existsSync(descriptor.interpreter)) {
    throw new Error('Script interpreter not found');
  }
}

function spawnStructured(executable, args, descriptor, name, options = {}) {
  const spawnImpl = options.spawn || defaultSpawn;
  const observeMs = Number.isFinite(options.observeMs) ? Math.max(0, options.observeMs) : DEFAULT_OBSERVE_MS;

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    try {
      const cwd = ['exe', 'script', 'command'].includes(descriptor.type) && path.win32.isAbsolute(executable)
        ? path.win32.dirname(executable)
        : undefined;
      const child = spawnImpl(executable, args, {
        detached: true,
        stdio: 'ignore',
        cwd,
        shell: false,
        windowsHide: false,
      });

      child.once('error', error => finish(failResult(name, error.message)));
      child.once('spawn', () => {
        timer = setTimeout(() => {
          if (typeof child.unref === 'function') child.unref();
          finish(successResult(name, descriptor));
        }, observeMs);
      });
      child.once('exit', code => {
        if (!settled && code !== null && code !== 0) {
          finish(failResult(name, `Process exited with code ${code}`));
        } else if (!settled && code === 0) {
          finish(successResult(name, descriptor));
        }
      });
    } catch (error) {
      finish(failResult(name, error.message));
    }
  });
}

async function launchDescriptor(rawDescriptor, options = {}) {
  let descriptor;
  try {
    descriptor = normalizeLaunchDescriptor(rawDescriptor);
    validateExistingTargets(descriptor, options);
  } catch (error) {
    return failResult(options.name, error.message);
  }

  try {
    const command = descriptorCommand(descriptor);
    return spawnStructured(command.executable, command.args, descriptor, options.name, options);
  } catch (error) {
    return failResult(options.name, error.message);
  }
}

async function launch(app, options = {}) {
  if (!app) return failResult('', 'App is required');
  let descriptor;
  try {
    if (String(app.type || '').toLowerCase() === 'command' && app.command && !path.win32.isAbsolute(app.command)) {
      const command = String(app.command).trim();
      const systemRoot = process.env.SystemRoot || 'C:\\Windows';
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:$/.test(command)) {
        descriptor = normalizeLaunchDescriptor({
          type: 'command',
          target: path.join(systemRoot, 'explorer.exe'),
          args: [command],
        });
      } else {
        if (!/^[a-zA-Z0-9._-]+$/.test(command)) throw new Error('Unsafe command name');
        const execFileSync = options.execFileSync || defaultExecFileSync;
        let resolved = '';
        try {
          resolved = String(execFileSync(windowsSystemPath('System32', 'where.exe'), [command], {
            encoding: 'utf8', windowsHide: true, timeout: 3000,
          })).split(/\r?\n/).map(value => value.trim()).find(Boolean) || '';
        } catch {}
        if (!resolved) {
          const fileName = path.extname(command) ? command : `${command}.exe`;
          const builtIn = path.join(systemRoot, 'System32', fileName);
          if ((options.existsSync || fs.existsSync)(builtIn)) resolved = builtIn;
        }
        if (!resolved) throw new Error('Command was not resolved to a local executable');
        descriptor = normalizeLaunchDescriptor({ type: 'command', target: resolved, args: [] });
      }
    } else {
      descriptor = candidateToLaunchDescriptor(app);
    }
  } catch (error) {
    return failResult(app.name, error.message);
  }
  return launchDescriptor(descriptor, { ...options, name: app.name || app.displayName || options.name });
}

module.exports = {
  DEFAULT_OBSERVE_MS,
  launch,
  launchDescriptor,
  descriptorCommand,
  platformLaunchCommand,
  windowsSystemPath,
};
