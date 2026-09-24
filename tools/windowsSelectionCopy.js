const { execFile } = require('child_process');

function buildGetForegroundWindowScript() {
  return [
    "$ErrorActionPreference = 'Stop'",
    '$signature = @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class Win32Foreground {',
    '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '}',
    '"@',
    'Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue',
    '[Win32Foreground]::GetForegroundWindow().ToInt64()',
  ].join('\n');
}

function buildSendCtrlCScript(targetHwnd) {
  const hwnd = Number(targetHwnd);
  const restoreTarget = Number.isFinite(hwnd) && hwnd > 0
    ? [
      '$signature = @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public static class Win32Focus {',
      '  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);',
      '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
      '}',
      '"@',
      'Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue',
      `$target = [IntPtr]${Math.trunc(hwnd)}`,
      'if ([Win32Focus]::IsWindow($target)) {',
      '  [Win32Focus]::SetForegroundWindow($target) | Out-Null',
      '  Start-Sleep -Milliseconds 120',
      '}',
    ]
    : [];

  return [
    "$ErrorActionPreference = 'Stop'",
    ...restoreTarget,
    'Add-Type -AssemblyName System.Windows.Forms',
    "[System.Windows.Forms.SendKeys]::SendWait('^c')",
  ].join('\n');
}

function sendCtrlCToSelection(options = {}) {
  const execFileImpl = options.execFile || execFile;
  const script = buildSendCtrlCScript(options.targetHwnd);

  return new Promise((resolve, reject) => {
    execFileImpl(
      'powershell.exe',
      [
        '-NoProfile',
        '-STA',
        '-WindowStyle',
        'Hidden',
        '-Command',
        script,
      ],
      { windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || stdout || error.message).trim()));
          return;
        }
        resolve();
      }
    );
  });
}

function getForegroundWindowHandle(options = {}) {
  const execFileImpl = options.execFile || execFile;
  const script = buildGetForegroundWindowScript();

  return new Promise((resolve) => {
    execFileImpl(
      'powershell.exe',
      [
        '-NoProfile',
        '-STA',
        '-WindowStyle',
        'Hidden',
        '-Command',
        script,
      ],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        const hwnd = Number(String(stdout || '').trim());
        resolve(Number.isFinite(hwnd) && hwnd > 0 ? hwnd : null);
      }
    );
  });
}

module.exports = {
  buildGetForegroundWindowScript,
  buildSendCtrlCScript,
  getForegroundWindowHandle,
  sendCtrlCToSelection,
};
