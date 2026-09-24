const { execFile } = require('child_process');

const SW_HIDE = 0;
const SW_SHOWNORMAL = 1;
const SW_SHOWMINIMIZED = 2;
const SW_SHOWMAXIMIZED = 3;
const SW_RESTORE = 9;

const HWND_TOP = 0;
const SWP_SHOWWINDOW = 0x0040;

function psString(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function win32TypeDefinition() {
  return [
    '$signature = @"',
    'using System;',
    'using System.Text;',
    'using System.Collections.Generic;',
    'using System.Runtime.InteropServices;',
    'public static class JarvisWin32 {',
    '  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);',
    '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);',
    '  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);',
    '  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
    '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);',
    '  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);',
    '}',
    '"@',
    'Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue',
  ].join('\n');
}

function powerShellPreamble() {
  return [
    "$ErrorActionPreference = 'Stop'",
    '$utf8 = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::OutputEncoding = $utf8',
    '$OutputEncoding = $utf8',
  ];
}

function buildListWindowsScript() {
  return [
    ...powerShellPreamble(),
    win32TypeDefinition(),
    '$windows = New-Object System.Collections.Generic.List[object]',
    '$callback = [JarvisWin32+EnumWindowsProc]{',
    '  param([IntPtr]$hWnd, [IntPtr]$lParam)',
    '  if (-not [JarvisWin32]::IsWindowVisible($hWnd)) { return $true }',
    '  $length = [JarvisWin32]::GetWindowTextLength($hWnd)',
    '  if ($length -le 0) { return $true }',
    '  $builder = New-Object System.Text.StringBuilder($length + 1)',
    '  [JarvisWin32]::GetWindowText($hWnd, $builder, $builder.Capacity) | Out-Null',
    '  $title = $builder.ToString()',
    '  if ([string]::IsNullOrWhiteSpace($title)) { return $true }',
    '  [uint32]$processId = 0',
    '  [JarvisWin32]::GetWindowThreadProcessId($hWnd, [ref]$processId) | Out-Null',
    '  $processName = ""',
    '  try { $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch {}',
    '  $windows.Add([pscustomobject]@{ hwnd = $hWnd.ToInt64(); title = $title; processId = $processId; processName = $processName; minimized = [JarvisWin32]::IsIconic($hWnd); maximized = [JarvisWin32]::IsZoomed($hWnd) }) | Out-Null',
    '  return $true',
    '}',
    '[JarvisWin32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null',
    '$windows | ConvertTo-Json -Depth 4',
  ].join('\n');
}

function buildShowWindowScript(hwnd, command) {
  return [
    ...powerShellPreamble(),
    win32TypeDefinition(),
    `$hwnd = [IntPtr]${Number(hwnd)}`,
    `[JarvisWin32]::ShowWindow($hwnd, ${Number(command)}) | Out-Null`,
    '[JarvisWin32]::SetForegroundWindow($hwnd) | Out-Null',
    'Write-Output "{\\"ok\\":true}"',
  ].join('\n');
}

function buildMoveResizeScript(hwnd, rect) {
  return [
    ...powerShellPreamble(),
    win32TypeDefinition(),
    `$hwnd = [IntPtr]${Number(hwnd)}`,
    `[JarvisWin32]::SetWindowPos($hwnd, [IntPtr]${HWND_TOP}, ${Math.round(rect.x)}, ${Math.round(rect.y)}, ${Math.round(rect.width)}, ${Math.round(rect.height)}, ${SWP_SHOWWINDOW}) | Out-Null`,
    'Write-Output "{\\"ok\\":true}"',
  ].join('\n');
}

function buildCloseWindowScript(hwnd) {
  return [
    ...powerShellPreamble(),
    win32TypeDefinition(),
    `$hwnd = [IntPtr]${Number(hwnd)}`,
    '[JarvisWin32]::PostMessage($hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null',
    'Write-Output "{\\"ok\\":true}"',
  ].join('\n');
}

function runPowerShell(script, options = {}) {
  const execFileImpl = options.execFile || execFile;
  return new Promise((resolve, reject) => {
    execFileImpl(
      'powershell.exe',
      ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script],
      { windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || stdout || error.message).trim()));
          return;
        }
        resolve(String(stdout || '').trim());
      }
    );
  });
}

function parseJsonOutput(stdout, fallback) {
  if (!stdout) return fallback;
  try {
    return JSON.parse(stdout);
  } catch {
    return fallback;
  }
}

async function listWindows(options = {}) {
  const stdout = await runPowerShell(buildListWindowsScript(), options);
  const parsed = parseJsonOutput(stdout, []);
  return Array.isArray(parsed) ? parsed : [parsed].filter(Boolean);
}

async function findWindows(query, options = {}) {
  const normalized = String(query || '').toLowerCase().trim();
  if (!normalized) return [];

  const windows = await listWindows(options);
  return windows.filter((window) => {
    const haystack = `${window.title || ''} ${window.processName || ''}`.toLowerCase();
    return haystack.includes(normalized);
  });
}

async function focusWindow(hwnd, options = {}) {
  const stdout = await runPowerShell(buildShowWindowScript(hwnd, SW_RESTORE), options);
  return parseJsonOutput(stdout, { ok: true });
}

async function minimizeWindow(hwnd, options = {}) {
  const stdout = await runPowerShell(buildShowWindowScript(hwnd, SW_SHOWMINIMIZED), options);
  return parseJsonOutput(stdout, { ok: true });
}

async function maximizeWindow(hwnd, options = {}) {
  const stdout = await runPowerShell(buildShowWindowScript(hwnd, SW_SHOWMAXIMIZED), options);
  return parseJsonOutput(stdout, { ok: true });
}

async function restoreWindow(hwnd, options = {}) {
  const stdout = await runPowerShell(buildShowWindowScript(hwnd, SW_RESTORE), options);
  return parseJsonOutput(stdout, { ok: true });
}

async function closeWindow(hwnd, options = {}) {
  const stdout = await runPowerShell(buildCloseWindowScript(hwnd), options);
  return parseJsonOutput(stdout, { ok: true });
}

async function moveResizeWindow(hwnd, rect, options = {}) {
  const stdout = await runPowerShell(buildMoveResizeScript(hwnd, rect), options);
  return parseJsonOutput(stdout, { ok: true });
}

function snapRect(position, workArea) {
  const area = {
    x: Number(workArea && workArea.x) || 0,
    y: Number(workArea && workArea.y) || 0,
    width: Number(workArea && workArea.width) || 1920,
    height: Number(workArea && workArea.height) || 1080,
  };
  const halfW = Math.round(area.width / 2);
  const halfH = Math.round(area.height / 2);

  switch (position) {
    case 'left':
      return { x: area.x, y: area.y, width: halfW, height: area.height };
    case 'right':
      return { x: area.x + halfW, y: area.y, width: area.width - halfW, height: area.height };
    case 'top':
      return { x: area.x, y: area.y, width: area.width, height: halfH };
    case 'bottom':
      return { x: area.x, y: area.y + halfH, width: area.width, height: area.height - halfH };
    case 'top-left':
      return { x: area.x, y: area.y, width: halfW, height: halfH };
    case 'top-right':
      return { x: area.x + halfW, y: area.y, width: area.width - halfW, height: halfH };
    case 'bottom-left':
      return { x: area.x, y: area.y + halfH, width: halfW, height: area.height - halfH };
    case 'bottom-right':
      return { x: area.x + halfW, y: area.y + halfH, width: area.width - halfW, height: area.height - halfH };
    default:
      throw new Error(`unknown snap position: ${position}`);
  }
}

function multiWindowLayout(layout, workArea) {
  const area = workArea || { x: 0, y: 0, width: 1920, height: 1080 };
  if (layout === 'two-columns') {
    return [snapRect('left', area), snapRect('right', area)];
  }
  if (layout === 'three-columns') {
    const width = Math.floor(area.width / 3);
    return [0, 1, 2].map((index) => ({
      x: area.x + width * index,
      y: area.y,
      width: index === 2 ? area.width - width * 2 : width,
      height: area.height,
    }));
  }
  throw new Error(`unknown layout: ${layout}`);
}

module.exports = {
  SW_HIDE,
  SW_SHOWNORMAL,
  SW_SHOWMINIMIZED,
  SW_SHOWMAXIMIZED,
  SW_RESTORE,
  buildListWindowsScript,
  buildShowWindowScript,
  buildMoveResizeScript,
  buildCloseWindowScript,
  listWindows,
  findWindows,
  focusWindow,
  minimizeWindow,
  maximizeWindow,
  restoreWindow,
  closeWindow,
  moveResizeWindow,
  snapRect,
  multiWindowLayout,
  psString,
};
