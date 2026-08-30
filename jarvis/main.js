// Fix for ELECTRON_RUN_AS_NODE environment issue
// Electron runs as Node.js when this is set to any value
if (process.env.ELECTRON_RUN_AS_NODE) {
  delete process.env.ELECTRON_RUN_AS_NODE;
}
require('./tools/loadEnv').loadEnvFile();

const { app, BrowserWindow, globalShortcut, ipcMain, session, screen, Tray, Menu, nativeImage, clipboard, desktopCapturer, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { buildWindowsAutoStartSettings } = require('./startup/windowsAutoStart');
const appIndexer = require('./tools/appIndexer');
const { AppRecoveryService } = require('./tools/appRecoveryService');
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
const { executeToolRequest } = require('./agents/toolGateway');

if (process.platform === 'win32') {
  // Keep hidden renderer processes alive so microphone capture continues in the tray/background.
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
}

let mainWindow = null;
let voiceOverlayWindow = null;
let transcriptionBarWindow = null;
let showTranscriptionBar = true;
let tray = null;
let voiceService = null;
let desktopAgentClient = null;
let activeAgentTaskId = null;
let lastExternalForegroundHwnd = null;
let suppressNextDesktopAgentExit = false;
let appRecoveryService = null;
const appSelectionTickets = new Map();
const HISTORY_PATH = path.join(__dirname, 'data', 'history.json');
const APPS_PATH = path.join(__dirname, 'data', 'apps.default.json');
const UI_STATE_PATH = path.join(__dirname, 'data', 'ui-state.local.json');

function recoveryResult(snapshot) {
  return {
    ok: snapshot && snapshot.state === 'completed',
    type: 'app_recovery',
    title: 'Поиск приложения',
    content: snapshot?.error || snapshot?.result?.message || 'Ищу приложение на компьютере.',
    recovery: snapshot,
  };
}

function getAppRecoveryService() {
  if (!appRecoveryService) {
    appRecoveryService = new AppRecoveryService({
      emit: snapshot => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('app-recovery-state', snapshot);
        }
      },
    });
  }
  return appRecoveryService;
}

function isTrustedMainRenderer(event) {
  return !!(mainWindow && !mainWindow.isDestroyed() && event?.sender?.id === mainWindow.webContents.id);
}

function requireOpaqueId(value, prefix) {
  const id = String(value || '');
  if (id.length > 100 || !new RegExp(`^${prefix}-[a-zA-Z0-9-]+$`).test(id)) throw new Error('invalid opaque id');
  return id;
}

function registerAppSelection(result) {
  if (!result?.needsSelection || !Array.isArray(result.candidates)) return result;
  const now = Date.now();
  for (const [candidateId, ticket] of appSelectionTickets) {
    if (now > ticket.expiresAt) appSelectionTickets.delete(candidateId);
  }
  const candidates = result.candidates.map(candidate => {
    const candidateId = `selection-${crypto.randomUUID()}`;
    appSelectionTickets.set(candidateId, { candidate, expiresAt: now + 10 * 60 * 1000 });
    return {
      candidateId,
      name: candidate.name,
      aliases: candidate.aliases || [],
      type: candidate.type,
      source: candidate.source,
      score: candidate.score,
      reason: candidate.reason,
      icon: candidate.icon,
    };
  });
  return { ...result, candidates };
}

async function launchRegisteredSelection(candidateId) {
  const id = requireOpaqueId(candidateId, 'selection');
  const ticket = appSelectionTickets.get(id);
  appSelectionTickets.delete(id);
  if (!ticket || Date.now() > ticket.expiresAt) throw new Error('app selection expired');
  const launchApp = require('./tools/launchApp');
  return launchApp.launch(ticket.candidate);
}

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

const initialUiState = loadJSON(UI_STATE_PATH, {});
showTranscriptionBar = initialUiState.showTranscriptionBar !== false;

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

function limitedText(value, maxLength = 1024) {
  return String(value || '').trim().slice(0, maxLength);
}

function sanitizeAgentCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const name = limitedText(candidate.name || candidate.title, 240);
  if (!name) return null;
  const safe = {
    type: limitedText(candidate.type, 32),
    name,
    path: limitedText(candidate.path, 2048),
    directory: limitedText(candidate.directory, 2048),
    action: limitedText(candidate.action, 32),
    warning: !!candidate.warning,
    dangerous: !!candidate.dangerous,
    score: Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : 0,
  };
  for (const key of ['aumid', 'command', 'source', 'matchType']) {
    if (candidate[key]) safe[key] = limitedText(candidate[key], 2048);
  }
  return safe;
}

function sanitizeAgentInitialContext(rawContext) {
  if (!rawContext || typeof rawContext !== 'object' || Array.isArray(rawContext)) return null;
  const kind = limitedText(rawContext.kind, 40);
  const reason = limitedText(rawContext.reason, 500);
  if (kind === 'candidate_selection') {
    const candidates = Array.isArray(rawContext.candidates)
      ? rawContext.candidates.slice(0, 20).map(sanitizeAgentCandidate).filter(Boolean)
      : [];
    return candidates.length > 0 ? { kind, reason, candidates } : null;
  }
  if (kind === 'confirmation') {
    const confirmation = rawContext.confirmation;
    if (!confirmation || confirmation.tool !== 'fileCommander') return null;
    const selectedFile = sanitizeAgentCandidate(confirmation.args && confirmation.args.selectedFile);
    const pathValue = limitedText(
      (selectedFile && selectedFile.path) || (confirmation.args && confirmation.args.path),
      2048,
    );
    if (!pathValue) return null;
    return {
      kind,
      reason,
      confirmation: {
        action: limitedText(confirmation.args && confirmation.args.action, 32) || 'open',
        path: pathValue,
        candidate: selectedFile,
      },
    };
  }
  return null;
}

function getDesktopAgentClient() {
  if (desktopAgentClient && desktopAgentClient.isRunning()) {
    return desktopAgentClient;
  }

  desktopAgentClient = new DesktopAgentClient({
    toolExecutor: (request, executionOptions = {}) => executeToolRequest(request, {
      shell,
      workArea: screen.getPrimaryDisplay().workArea,
      ...executionOptions,
    }),
  });
  desktopAgentClient.on('event', (event) => {
    sendAgentTaskEvent(event);
    if (voiceService && typeof voiceService.handleAgentTaskEvent === 'function') {
      voiceService.handleAgentTaskEvent(event).catch((error) => {
        console.error('[voiceService] Agent event handling failed:', error);
      });
    }

    if (event.type === 'plan_draft' && event.task_id) {
      updateTask(event.task_id, {
        taskId: event.task_id,
        status: 'planning',
        plan: event.payload && event.payload.plan,
      });
    }

    if ((event.type === 'final_report' || event.type === 'error' || event.type === 'needs_input' || event.type === 'needs_confirmation') && event.task_id) {
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
    if (suppressNextDesktopAgentExit) {
      suppressNextDesktopAgentExit = false;
      return;
    }

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

function stopDesktopAgentClient(options = {}) {
  if (!desktopAgentClient) return;

  if (options.silent && desktopAgentClient.isRunning()) {
    suppressNextDesktopAgentExit = true;
  }

  desktopAgentClient.stop();
  desktopAgentClient = null;
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
    // Restart the Python runtime for new tasks so planner/tool fixes are not
    // hidden behind a stale long-lived process.
    stopDesktopAgentClient({ silent: true });
    const client = getDesktopAgentClient();
    await client.waitUntilReady();
    const initialContext = sanitizeAgentInitialContext(options.initialContext);
    const escalationReason = limitedText(options.escalationReason, 500);
    const { taskId } = client.startTask(userCommand, { ...options, initialContext });
    activeAgentTaskId = taskId;
    appendTask({
      taskId,
      command: userCommand,
      source: options.source || 'launcher',
      escalationReason,
      escalationKind: limitedText(options.escalationKind, 40),
      status: 'started',
    });
    sendAgentTaskEvent({
      type: 'event',
      task_id: taskId,
      payload: {
        message: escalationReason
          ? `Автоматическая эскалация: ${escalationReason}`
          : 'Открыл агент и запустил задачу.',
        initialContext,
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

async function handleAgentVoiceAction(action, payload = {}) {
  const taskId = payload.taskId || activeAgentTaskId;
  if (!desktopAgentClient || !taskId || !desktopAgentClient.isRunning()) {
    return { ok: false, error: 'No active agent runtime.' };
  }

  if (action === 'user_choice') {
    return desktopAgentClient.sendTaskAction(taskId, 'user_choice', {
      index: payload.index,
      choice: payload.choice,
    });
  }
  if (action === 'confirm' || action === 'strong_confirm') {
    return await desktopAgentClient.confirmPendingTool(taskId, {
      strongConfirmed: action === 'strong_confirm',
    });
  }
  if (action === 'reject_confirmation') {
    return desktopAgentClient.rejectPendingTool(taskId, 'Tool request rejected by voice command.');
  }
  if (action === 'cancel') {
    desktopAgentClient.rejectPendingTool(taskId, 'Task cancelled by voice command.');
    const result = desktopAgentClient.sendTaskAction(taskId, 'cancel');
    if (taskId === activeAgentTaskId) activeAgentTaskId = null;
    return result;
  }
  return { ok: false, error: `Unsupported voice agent action: ${action}` };
}

function ensureWindowsAutoStart() {
  if (process.platform !== 'win32') return;

  try {
    app.setLoginItemSettings(buildWindowsAutoStartSettings({
      isPackaged: app.isPackaged,
      execPath: process.execPath,
      appPath: app.getAppPath(),
    }));
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
    showTranscriptionBar,
    onToggleMic: () => {
        if (voiceService) {
          voiceService.toggle();
          updateTrayMenu();
        }
      },
    onToggleTranscriptionBar: (checked) => {
      toggleTranscriptionBar(checked);
    },
    onQuit: () => shutdownApp(),
  }));
  tray.setContextMenu(contextMenu);
}

function toggleTranscriptionBar(visible) {
  showTranscriptionBar = visible;
  const uiState = loadJSON(UI_STATE_PATH, {});
  uiState.showTranscriptionBar = visible;
  saveJSON(UI_STATE_PATH, uiState);

  if (visible) {
    if (!transcriptionBarWindow || transcriptionBarWindow.isDestroyed()) {
      createTranscriptionBarWindow();
    } else {
      transcriptionBarWindow.show();
    }
  } else {
    if (transcriptionBarWindow && !transcriptionBarWindow.isDestroyed()) {
      transcriptionBarWindow.hide();
    }
  }
  updateTrayMenu();
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

function createVoiceOverlayWindow() {
  voiceOverlayWindow = new BrowserWindow({
    width: 800,
    height: 150,
    x: Math.round(screen.getPrimaryDisplay().workAreaSize.width / 2 - 400),
    y: Math.round(screen.getPrimaryDisplay().workAreaSize.height - 180), // At the bottom
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Make it click-through
  voiceOverlayWindow.setIgnoreMouseEvents(true, { forward: true });

  voiceOverlayWindow.loadFile(path.join(__dirname, 'renderer', 'voice-overlay.html'));

  voiceOverlayWindow.on('closed', () => {
    voiceOverlayWindow = null;
  });
}

function createTranscriptionBarWindow() {
  if (transcriptionBarWindow && !transcriptionBarWindow.isDestroyed()) return;

  const uiState = loadJSON(UI_STATE_PATH, {});
  const savedPos = uiState.transcriptionBarPosition;

  transcriptionBarWindow = new BrowserWindow({
    width: 520,
    height: 80,
    x: savedPos ? savedPos[0] : Math.round(screen.getPrimaryDisplay().workAreaSize.width / 2 - 260),
    y: savedPos ? savedPos[1] : 80,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    show: showTranscriptionBar,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  transcriptionBarWindow.loadFile(path.join(__dirname, 'renderer', 'transcription-bar.html'));

  let moveTimeout;
  transcriptionBarWindow.on('move', () => {
    if (moveTimeout) clearTimeout(moveTimeout);
    moveTimeout = setTimeout(() => {
      if (transcriptionBarWindow && !transcriptionBarWindow.isDestroyed()) {
        const pos = transcriptionBarWindow.getPosition();
        const latestUiState = loadJSON(UI_STATE_PATH, {});
        latestUiState.transcriptionBarPosition = pos;
        saveJSON(UI_STATE_PATH, latestUiState);
      }
    }, 1000);
  });

  transcriptionBarWindow.on('closed', () => {
    transcriptionBarWindow = null;
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
  if (voiceOverlayWindow && !voiceOverlayWindow.isDestroyed()) {
    voiceOverlayWindow.close();
  }
  if (transcriptionBarWindow && !transcriptionBarWindow.isDestroyed()) {
    transcriptionBarWindow.close();
  }
  app.quit();
}

// Prevent multiple instances before app.whenReady() starts registering shortcuts.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (app.isReady()) {
      toggleWindow();
    }
  });
}

// --- App Ready ---
if (gotTheLock) {
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

  voiceService = new VoiceService({
    onStateChange: () => updateTrayMenu(),
    intentOptions: {
      translateSelectedText: handleTranslateSelected,
      analyzeVisualArea: handleVisualAnalyze,
      continueVisualDialog: handleVisualContinue,
      clearVisualContext: handleClearVisualContext,
      executeFileCommand: handleFileCommand,
      startAgentTask: (command) => handleStartAgentTask(command, { source: 'voice' }),
      startAppRecovery: (command, recoveryOptions = {}) => getAppRecoveryService().start(command, {
        ...recoveryOptions,
        inputChannel: 'voice',
      }),
      selectAppRecovery: (recoveryId, candidateId) => getAppRecoveryService().select(recoveryId, candidateId),
      confirmAppRecovery: (recoveryId) => getAppRecoveryService().confirm(recoveryId),
      cancelAppRecovery: (recoveryId) => getAppRecoveryService().cancel(recoveryId, 'voice cancelled'),
      isAgentTaskWindowVisible: () => {
        const win = getAgentTaskWindow();
        return !!(win && !win.isDestroyed() && win.isVisible());
      },
      handleAgentVoiceAction,
      showMainWindow,
    },
  });
  voiceService.registerIpcHandlers();

  // --- Create main window (always, but hidden if --hidden) ---
  createWindow();
  createVoiceOverlayWindow();
  createTranscriptionBarWindow();
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
      const result = await toolModule.execute(args);
      if (tool === 'runProgram' && result?.needsRecovery) {
        const snapshot = await getAppRecoveryService().start(result.query, {
          inputChannel: 'text',
          normalizedQuery: result.normalizedQuery,
        });
        return recoveryResult(snapshot);
      }
      if (tool === 'runProgram' && result?.needsSelection) return registerAppSelection(result);
      return result;
    } catch (err) {
      return { ok: false, type: 'error', title: 'Ошибка', content: err.message, error: err.message };
    }
  });

  ipcMain.handle('launch-selected-app', async (event, request) => {
    try {
      if (!isTrustedMainRenderer(event)) throw new Error('untrusted renderer');
      return await launchRegisteredSelection(request && request.candidateId);
    } catch (err) {
      return { ok: false, type: 'run', title: 'Ошибка запуска', content: err.message, error: err.message };
    }
  });

  ipcMain.handle('app-recovery-select', (event, { recoveryId, candidateId } = {}) => {
    try {
      if (!isTrustedMainRenderer(event)) throw new Error('untrusted renderer');
      return recoveryResult(getAppRecoveryService().select(
        requireOpaqueId(recoveryId, 'recovery'),
        requireOpaqueId(candidateId, 'candidate'),
      ));
    } catch (error) {
      return { ok: false, type: 'app_recovery', content: error.message, error: error.message };
    }
  });

  ipcMain.handle('app-recovery-confirm', async (event, { recoveryId } = {}) => {
    try {
      if (!isTrustedMainRenderer(event)) throw new Error('untrusted renderer');
      return recoveryResult(await getAppRecoveryService().confirm(requireOpaqueId(recoveryId, 'recovery')));
    } catch (error) {
      return { ok: false, type: 'app_recovery', content: error.message, error: error.message };
    }
  });

  ipcMain.handle('app-recovery-cancel', (event, { recoveryId } = {}) => {
    try {
      if (!isTrustedMainRenderer(event)) throw new Error('untrusted renderer');
      return recoveryResult(getAppRecoveryService().cancel(requireOpaqueId(recoveryId, 'recovery'), 'text cancelled'));
    } catch (error) {
      return { ok: false, type: 'app_recovery', content: error.message, error: error.message };
    }
  });

  ipcMain.handle('app-recovery-details', (event, { recoveryId, candidateId } = {}) => {
    try {
      if (!isTrustedMainRenderer(event)) throw new Error('untrusted renderer');
      return {
        ok: true,
        details: getAppRecoveryService().details(
          requireOpaqueId(recoveryId, 'recovery'),
          requireOpaqueId(candidateId, 'candidate'),
        ),
      };
    } catch (error) {
      return { ok: false, error: error.message };
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
    const learnedApps = require('./tools/learnedAppStore').load({ quarantine: false }).apps.map(app => ({
      name: app.displayName,
      aliases: app.aliases || [],
      command: '',
      icon: '◆',
      source: 'apps.learned',
    }));
    const defaultApps = loadJSON(APPS_PATH, []);
    const indexData = loadJSON(path.join(__dirname, 'data', 'app-index.json'), { apps: [] });
    const indexedApps = (indexData.apps || []).map(a => ({
      name: a.name,
      aliases: a.aliases || [],
      command: a.path || a.aumid || '',
      icon: a.type === 'uwp' ? '📱' : a.type === 'lnk' ? '🔗' : '📦',
    }));
    const allApps = [...userApps, ...learnedApps, ...defaultApps];
    const existingNames = new Set(userApps.concat(learnedApps, defaultApps).map(a => a.name.toLowerCase()));
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

  ipcMain.handle('hide-transcription-bar', () => {
    toggleTranscriptionBar(false);
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

  ipcMain.handle('agent-start-task', async (event, { command, options } = {}) => {
    return await handleStartAgentTask(command, { ...(options || {}), source: 'launcher' });
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
      if (desktopAgentClient && taskId) {
        desktopAgentClient.rejectPendingTool(taskId, 'Task cancelled by user.');
        if (desktopAgentClient.isRunning()) {
          desktopAgentClient.sendTaskAction(taskId, 'cancel');
        }
      }
      sendAgentTaskEvent({
        type: 'final_report',
        task_id: taskId,
        payload: { phase: 'finalized', message: 'Задача отменена пользователем.' },
      });
      if (taskId) updateTask(taskId, { status: 'cancelled' });
      return { ok: true };
    }

    if (action === 'confirm' || action === 'strong_confirm') {
      if (!desktopAgentClient || !taskId) {
        return { ok: false, error: 'No active agent task.' };
      }
      const result = await desktopAgentClient.confirmPendingTool(taskId, {
        strongConfirmed: action === 'strong_confirm',
      });
      sendAgentTaskEvent({
        type: result.ok ? 'event' : 'error',
        task_id: taskId,
        payload: {
          message: result.ok ? 'Подтверждение принято, продолжаю выполнение.' : result.error,
          error: result.ok ? undefined : result.error,
        },
      });
      return result;
    }

    if (action === 'reject_confirmation') {
      if (!desktopAgentClient || !taskId) {
        return { ok: false, error: 'No active agent task.' };
      }
      const result = desktopAgentClient.rejectPendingTool(taskId, 'Tool request rejected by user.');
      sendAgentTaskEvent({
        type: 'event',
        task_id: taskId,
        payload: { message: result.ok ? 'Действие отклонено.' : result.error },
      });
      return result;
    }

    if (action === 'stop_after_current_step') {
      if (desktopAgentClient && taskId && desktopAgentClient.isRunning()) {
        desktopAgentClient.sendTaskAction(taskId, 'stop_after_current_step');
      }
      sendAgentTaskEvent({
        type: 'event',
        task_id: taskId,
        payload: { message: 'Остановлю задачу после текущего шага.' },
      });
      return { ok: true };
    }

    if (action === 'user_choice' || action === 'continue' || action === 'disable_steps') {
      if (!desktopAgentClient || !taskId || !desktopAgentClient.isRunning()) {
        return { ok: false, error: 'No active agent runtime.' };
      }
      return desktopAgentClient.sendTaskAction(taskId, action, payload || {});
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
}

// --- Cleanup ---
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

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
