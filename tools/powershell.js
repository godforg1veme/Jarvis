const { exec } = require('child_process');

const DANGEROUS_PATTERNS = [
  /\bRemove-Item\b/i,
  /\bdel\b/i,
  /\brm\b/i,
  /\bStop-Process\b/i,
  /\bshutdown\b/i,
  /\brestart-computer\b/i,
  /\bformat\b/i,
  /\breg\s+delete\b/i,
  /\bSet-ExecutionPolicy\b/i,
  /\bRemove-ItemProperty\b/i,
  /\bRemove-Item\b/i,
  /\bForEach\b.*Remove/i,
  /\bGet-ChildItem.*Remove/i,
  /\bClear-Content\b/i,
  /\bStop-Service\b/i,
  /\bNew-Item\b.*-Force\b/i,
];

function isDangerous(command) {
  return DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
}

async function execute(args, confirmed) {
  const command = (args.command || '').trim();

  if (!command) {
    return {
      ok: false,
      type: 'powershell',
      title: 'PowerShell',
      content: 'Укажите команду. Пример: /ps Get-Process',
      error: 'command is required',
    };
  }

  // Check if dangerous and not yet confirmed
  if (isDangerous(command) && !confirmed) {
    return {
      ok: false,
      type: 'powershell',
      title: '⚠️ Опасная команда',
      content: `Команда "${command}" считается потенциально опасной.\nДля подтверждения нажмите Enter или введите "да".`,
      needsConfirmation: true,
      commandToConfirm: {
        tool: 'powershell',
        args: { command },
        description: command,
      },
    };
  }

  // Execute PowerShell command
  return new Promise((resolve) => {
    const fullCommand = `powershell.exe -NoProfile -NonInteractive -Command "${command.replace(/"/g, '\\"')}"`;
    exec(fullCommand, { shell: 'cmd.exe', timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve({
          ok: false,
          type: 'powershell',
          title: 'Ошибка PowerShell',
          content: stderr || err.message,
          error: err.message,
          commandToConfirm: null,
        });
      } else {
        const output = stdout.trim() || '(нет вывода)';
        resolve({
          ok: true,
          type: 'powershell',
          title: `PowerShell: ${command}`,
          content: output,
          data: { command, output },
        });
      }
    });
  });
}

function getSchema() {
  return 'powershell: выполнение PowerShell-команды. Args: { command: string }. Пример: /ps Get-Process';
}

module.exports = { execute, getSchema };