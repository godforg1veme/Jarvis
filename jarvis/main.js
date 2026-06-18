// Fix for ELECTRON_RUN_AS_NODE environment issue
// Electron runs as Node.js when this is set to any value
if (process.env.ELECTRON_RUN_AS_NODE) {
  delete process.env.ELECTRON_RUN_AS_NODE;
}

const { app, BrowserWindow, globalShortcut, ipcMain, session, screen, Tray, Menu, nativeImage, clipboard, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const appIndexer = require('./tools/appIndexer');
const { setupVoiceIpc } = require('./voice/voiceIpc');
const { VoiceService } = require('./voice/voiceService');
const { buildTrayMenuTemplate } = require('./trayMenu');
const { createTrayIcon } = require('./trayIcon');
const { translateSelectedText } = require('./tools/selectedTextTranslator');
const { getForegroundWindowHandle, sendCtrlCToSelection } = require('./tools/windowsSelectionCopy');
const {
  analyzeVisualArea,
  continueVisualDialog,
  clearVisualContext,
} = require('./tools/screenVisionAnalyzer');
const { DesktopAgentClient } = require('./agents/desktopAgentClient');
const { appendTask, updateTask } = require('./agents/agentHistory');
const {
  showAgentTaskWindow,
  sendAgentTaskEvent,
  getAgentTaskWindow,
} = require('./agents/agentTaskWindow');

if (process.platform === 'win32') {
  // Keep hidden renderer processes alive so microphone capture continues in the tray/background.
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
}

let mainWindow = null;
let tray = null;
let voiceService = null;
let desktopAgentClient = null;
let activeAgentTaskId = null;
let lastExternalForegroundHwnd = null;
const HISTORY_PATH = path.join(__dirname, 'data', 'history.json');
const APPS_PATH = path.join(__dirname, 'data', 'apps.default.json');

// --- Helpers ---
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJSON(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function saveJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMainWindowHwnd() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;

  const handle = mainWindow.getNativeWindowHandle();
  if (handle.length >= 8) {
    return Number(handle.readBigUInt64LE(0));
  }

  return handle.readUInt32LE(0);
}

async function rememberExternalForegroundWindow() {
  if (process.platform !== 'win32') return;

  const hwnd = await getForegroundWindowHandle();
  const ownHwnd = getMainWindowHwnd();
  if (hwnd && hwnd !== ownHwnd) {
    lastExternalForegroundHwnd = hwnd;
    console.log('[translate-selected] remembered foreground hwnd', hwnd);
  }
}

async function sendCtrlCShortcut(targetHwnd) {
  if (process.platform !== 'win32') {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.copy();
    }
    return;
  }

  await sendCtrlCToSelection({ targetHwnd });
}

async function copyForegroundSelection() {
  const shouldHide = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  const targetHwnd = shouldHide ? lastExternalForegroundHwnd : null;

  if (shouldHide) {
    mainWindow.hide();
    await sleep(120);
  }

  try {
    await sendCtrlCShortcut(targetHwnd);
  } finally {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
}

async function handleTranslateSelected() {
  return await translateSelectedText({
    readClipboardText: () => clipboard.readText(),
    writeClipboardText: (text) => clipboard.writeText(text),
    copySelectedText: copyForegroundSelection,
    logger: console,
    allowExistingClipboardFallback: true,
  });
}

async function handleVisualAnalyze(command) {
  return await analyzeVisualArea(command, {
    screen,
    desktopCapturer,
    nativeImage,
    app,
    logger: console,
  });
}

async function handleVisualContinue(command) {
  return await continueVisualDialog(command, {
    logger: console,
  });
}

function handleClearVisualContext() {
  return clearVisualContext(console);
}

async function handleFileCommand(args, confirmed = false) {
  const fileCommander = require('./tools/fileCommander');
  return await fileCommander.execute(args, confirmed);
}

function getDesktopAgentClient() {
  if (desktopAgentClient && desktopAgentClient.isRunning()) {
    return desktopAgentClient;
  }

  desktopAgentClient = new DesktopAgentClient();
  desktopAgentClient.on('event', (event) => {
    sendAgentTaskEvent(event);

    if (event.type === 'plan_draft' && event.task_id) {
      updateTask(event.task_id, {
        taskId: event.task_id,
        status: 'planning',
        plan: event.payload && event.payload.plan,
      });
    }

    if ((event.type === 'final_report' || event.type === 'error' || event.type === 'needs_input') && event.task_id) {
      updateTask(event.task_id, {
        taskId: event.task_id,
        status: event.type,
        lastEvent: event,
      });
    }

    if ((event.type === 'final_report' || event.type === 'error') && event.task_id === activeAgentTaskId) {
      activeAgentTaskId = null;
    }
  });
  desktopAgentClient.on('exit', (event) => {
    sendAgentTaskEvent({
      type: 'error',
      task_id: activeAgentTaskId,
      payload: {
        error: `Agent runtime stopped (${event.code ?? event.signal ?? 'unknown'}).`,
      },
    });
  });
  desktopAgentClient.start();
  return desktopAgentClient;
}

async function handleStartAgentTask(command, options = {}) {
  const userCommand = String(command || '').trim();
  if (!userCommand) {
    return { ok: false, type: 'agent', title: 'Agent', content: 'Введите задачу для агента.' };
  }

  if (activeAgentTaskId) {
    showAgentTaskWindow({ noFocus: true });
    return {
      ok: false,
      type: 'agent',
      title: 'Agent уже занят',
      content: 'Сначала завершите или отмените текущую задачу агента.',
      taskId: activeAgentTaskId,
    };
  }

  showAgentTaskWindow({ noFocus: true });

  try {
    const client = getDesktopAgentClient();
    await client.waitUntilReady();
    const { taskId } = client.startTask(userCommand, options);
    activeAgentTaskId = taskId;
    appendTask({
      taskId,
      command: userCommand,
      source: options.source || 'launcher',
      status: 'started',
    });
    sendAgentTaskEvent({
      type: 'event',
      task_id: taskId,
      payload: {
        message: 'Открыл агент и запустил задачу.',
      },
    });
    return {
      ok: true,
      type: 'agent',
      title: 'Agent task started',
      content: `Открыл агент для задачи: ${userCommand}`,
      taskId,
    };
  } catch (error) {
    sendAgentTaskEvent({
      type: 'error',
      task_id: activeAgentTaskId,
      payload: {
        error: `${error.message}. Запустите node scripts/ensureAgentRuntime.js, если Python runtime не подготовлен.`,
      },
    });
    activeAgentTaskId = null;
    return {
      ok: false,
      type: 'agent',
      title: 'Agent runtime недоступен',
      content: `${error.message}. Запустите node scripts/ensureAgentRuntime.js, если Python runtime не подготовлен.`,
      error: error.message,
    };
  }
}

function ensureWindowsAutoStart() {
  if (process.platform !== 'win32') return;

  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      args: ['--hidden'],
    });
  } catch (err) {
    console.warn('[main] Failed to enable Windows autostart:', err.message);
  }
}

// --- Tray setup ---
function createTray() {
  const icon = createTrayIcon(nativeImage);
  tray = new Tray(icon);
  tray.setToolTip('Jarvis — голосовой ассистент');
  updateTrayMenu();
  tray.on('click', () => {
    toggleWindow();
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const isMicOn = voiceService ? voiceService.isVoiceEnabled : false;

  const contextMenu = Menu.buildFromTemplate(buildTrayMenuTemplate({
    isMicOn,
    onToggleMic: () => {
        if (voiceService) {
          voiceService.toggle();
          updateTrayMenu();
        }
      },
    onQuit: () => shutdownApp(),
  }));
  tray.setContextMenu(contextMenu);
}

// --- Create Window ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 680,
    height: 540,
    x: Math.round(screen.getPrimaryDisplay().workAreaSize.width / 2 - 340),
    y: Math.round(screen.getPrimaryDisplay().workAreaSize.height / 2 - 240),
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    // CRITICAL: disable background throttling so voice capture works when window is hidden
    backgroundThrottling: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('blur', () => {
    mainWindow.hide();
  });

  mainWindow.on('close', (event) => {
    // Prevent actual close — hide to tray instead
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- Toggle Window ---
async function showMainWindow() {
  await rememberExternalForegroundWindow();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('focus-input');
}

async function toggleWindow() {
  if (!mainWindow) {
    // If window was closed (not just hidden), recreate it
    createWindow();
    await showMainWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    await showMainWindow();
  }
}

// --- Shutdown ---
let shuttingDown = false;
function shutdownApp() {
  if (shuttingDown) return;
  shuttingDown = true;
  app.isQuitting = true;

  console.log('[main] Shutting down...');
  if (voiceService) {
    voiceService.shutdown();
    voiceService = null;
  }
  if (desktopAgentClient) {
    desktopAgentClient.stop();
    desktopAgentClient = null;
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
  globalShortcut.unregisterAll();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
  app.quit();
}

// --- App Ready ---
app.whenReady().then(() => {
  const startHidden = process.argv.includes('--hidden');

  // --- Permission handler for microphone ---
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      return callback(true);
    }
    return callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media') {
      return true;
    }
    return false;
  });

  // --- Enable Windows autostart by default ---
  ensureWindowsAutoStart();

  // --- Create voice service ---
  voiceService = new VoiceService({
    onStateChange: () => updateTrayMenu(),
    intentOptions: {
      translateSelectedText: handleTranslateSelected,
      analyzeVisualArea: handleVisualAnalyze,
      continueVisualDialog: handleVisualContinue,
      clearVisualContext: handleClearVisualContext,
      executeFileCommand: handleFileCommand,
      showMainWindow,
    },
  });
  voiceService.registerIpcHandlers();

  // --- Create main window (always, but hidden if --hidden) ---
  createWindow();
  if (startHidden) {
    mainWindow.hide();
  } else {
    mainWindow.show();
  }

  // --- Tray (always created) ---
  createTray();

  // --- Enable voice by default ---
  // Ask the renderer UI to start the voice service after the window loads.
  // Actual microphone capture is handled by VoiceService's hidden audio window.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('voice:auto-start');
  });

  // --- Setup voice IPC backward compatibility ---
  setupVoiceIpc(mainWindow, voiceService);

  // Register global shortcut to show/hide window
  globalShortcut.register('Ctrl+Alt+J', () => {
    toggleWindow();
  });

  // Whitelist of allowed tool modules
  const ALLOWED_TOOLS = ['runProgram', 'powershell', 'searchFiles', 'sysinfo', 'fileCommander'];

  // --- IPC Handlers ---
  ipcMain.handle('execute-tool', async (event, { tool, args }) => {
    if (!ALLOWED_TOOLS.includes(tool)) {
      return { ok: false, type: 'error', title: 'Ошибка', content: `Неизвестный инструмент: ${tool}` };
    }
    try {
      const toolModule = require(`./tools/${tool}`);
      return await toolModule.execute(args);
    } catch (err) {
      return { ok: false, type: 'error', title: 'Ошибка', content: err.message, error: err.message };
    }
  });

  ipcMain.handle('launch-selected-app', async (event, app) => {
    try {
      const launchApp = require('./tools/launchApp');
      return await launchApp.launch(app);
    } catch (err) {
      return { ok: false, type: 'run', title: 'Ошибка запуска', content: err.message, error: err.message };
    }
  });

  ipcMain.handle('confirm-command', async (event, { tool, args }) => {
    if (!ALLOWED_TOOLS.includes(tool)) {
      return { ok: false, type: 'error', title: 'Ошибка', content: `Неизвестный инструмент: ${tool}` };
    }
    try {
      const toolModule = require(`./tools/${tool}`);
      return await toolModule.execute(args, true);
    } catch (err) {
      return { ok: false, type: 'error', title: 'Ошибка', content: err.message, error: err.message };
    }
  });

  ipcMain.handle('get-history', () => loadJSON(HISTORY_PATH, []));

  ipcMain.handle('save-history', (event, entry) => {
    const history = loadJSON(HISTORY_PATH, []);
    history.unshift(entry);
    if (history.length > 50) history.length = 50;
    saveJSON(HISTORY_PATH, history);
    return history;
  });

  ipcMain.handle('get-apps', async () => {
    const userApps = loadJSON(path.join(__dirname, 'data', 'apps.user.json'), { apps: [] }).apps || [];
    const defaultApps = loadJSON(APPS_PATH, []);
    const indexData = loadJSON(path.join(__dirname, 'data', 'app-index.json'), { apps: [] });
    const indexedApps = (indexData.apps || []).map(a => ({
      name: a.name,
      aliases: a.aliases || [],
      command: a.path || a.aumid || '',
      icon: a.type === 'uwp' ? '📱' : a.type === 'lnk' ? '🔗' : '📦',
    }));
    const allApps = [...userApps, ...defaultApps];
    const existingNames = new Set(userApps.concat(defaultApps).map(a => a.name.toLowerCase()));
    for (const app of indexedApps) {
      if (!existingNames.has(app.name.toLowerCase())) {
        allApps.push(app);
        existingNames.add(app.name.toLowerCase());
      }
    }
    return allApps;
  });

  ipcMain.handle('refresh-apps', async () => {
    try {
      const result = await appIndexer.indexAll();
      return { ok: true, count: result.apps.length, updatedAt: result.updatedAt };
    } catch (err) {
      console.error('Error refreshing apps:', err);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('add-app', (event, args) => {
    const runProgram = require('./tools/runProgram');
    return runProgram.addApp(args);
  });

  ipcMain.handle('learn-app', (event, args) => {
    const { alias, appName, appPath, appType } = args;
    const runProgram = require('./tools/runProgram');
    return runProgram.learnApp(alias, { name: appName, type: appType, path: appPath });
  });

  ipcMain.handle('get-settings', () => loadJSON(path.join(__dirname, 'data', 'settings.json'), {}));

  ipcMain.handle('add-scan-root', (event, { path: newPath }) => {
    const settingsPath = path.join(__dirname, 'data', 'settings.json');
    const settings = loadJSON(settingsPath, { scanRoots: [] });
    if (!settings.scanRoots) settings.scanRoots = [];
    const expanded = newPath.replace(/%([^%]+)%/g, (_, name) => process.env[name] || '');
    if (!settings.scanRoots.includes(expanded)) {
      settings.scanRoots.push(expanded);
      saveJSON(settingsPath, settings);
    }
    return { ok: true, scanRoots: settings.scanRoots };
  });

  ipcMain.handle('hide-window', () => {
    if (mainWindow) mainWindow.hide();
    return { ok: true };
  });

  ipcMain.handle('translate-selected', async () => {
    return await handleTranslateSelected();
  });

  ipcMain.handle('visual-analyze', async (event, { command } = {}) => {
    return await handleVisualAnalyze(command || '');
  });

  ipcMain.handle('visual-continue', async (event, { command } = {}) => {
    return await handleVisualContinue(command || '');
  });

  ipcMain.handle('visual-clear-context', async () => {
    return handleClearVisualContext();
  });

  ipcMain.handle('agent-start-task', async (event, { command } = {}) => {
    return await handleStartAgentTask(command, { source: 'launcher' });
  });

  ipcMain.handle('agent-task-action', async (event, { action, payload } = {}) => {
    const taskId = payload && payload.taskId ? payload.taskId : activeAgentTaskId;

    if (action === 'hide') {
      const win = getAgentTaskWindow();
      if (win) win.hide();
      return { ok: true };
    }

    if (action === 'cancel') {
      activeAgentTaskId = null;
      sendAgentTaskEvent({
        type: 'final_report',
        task_id: taskId,
        payload: { phase: 'finalized', message: 'Задача отменена пользователем.' },
      });
      if (taskId) updateTask(taskId, { status: 'cancelled' });
      return { ok: true };
    }

    if (action === 'stop_after_current_step') {
      sendAgentTaskEvent({
        type: 'event',
        task_id: taskId,
        payload: { message: 'Остановлю задачу после текущего шага.' },
      });
      return { ok: true };
    }

    sendAgentTaskEvent({
      type: 'event',
      task_id: taskId,
      payload: { message: `Действие пока не реализовано: ${action || 'unknown'}` },
    });
    return { ok: true };
  });

  // --- Auto-index on first launch or stale index ---
  setTimeout(async () => {
    try {
      const settings = loadJSON(path.join(__dirname, 'data', 'settings.json'), { autoIndexOnFirstLaunch: true, autoRefreshDays: 7 });
      const index = loadJSON(path.join(__dirname, 'data', 'app-index.json'), null);
      const now = Date.now();
      let shouldIndex = false;
      if (!index || !index.apps || index.apps.length === 0) {
        if (settings.autoIndexOnFirstLaunch) shouldIndex = true;
      } else if (index.updatedAt && settings.autoRefreshDays > 0) {
        const ageDays = (now - new Date(index.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays >= settings.autoRefreshDays) shouldIndex = true;
      }
      if (shouldIndex && mainWindow) {
        mainWindow.webContents.send('index-status', { status: 'indexing', message: 'Ищу установленные приложения...' });
        const result = await appIndexer.indexAll();
        mainWindow.webContents.send('index-status', { status: 'done', message: `Найдено ${result.apps.length} приложений`, count: result.apps.length });
      }
    } catch (err) {
      console.error('[Jarvis] Auto-index error:', err);
    }
  }, 1500);
});

// --- Cleanup ---
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    toggleWindow();
  });
}

// Ensure shutdown on app quit
app.on('before-quit', () => {
  app.isQuitting = true;
  if (voiceService) {
    voiceService.shutdown();
    voiceService = null;
  }
  if (desktopAgentClient) {
    desktopAgentClient.stop();
    desktopAgentClient = null;
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
});
