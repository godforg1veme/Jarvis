// Fix for ELECTRON_RUN_AS_NODE environment issue
// Electron runs as Node.js when this is set to any value
if (process.env.ELECTRON_RUN_AS_NODE) {
  delete process.env.ELECTRON_RUN_AS_NODE;
}
require('./tools/loadEnv').loadEnvFile();

const { app, BrowserWindow, globalShortcut, ipcMain, session, screen, Tray, Menu, nativeImage, clipboard, desktopCapturer, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { buildWindowsAutoStartSettings } = require('./startup/windowsAutoStart');
const appIndexer = require('./tools/appIndexer');
const { AppRecoveryService } = require('./tools/appRecoveryService');
const { setupVoiceIpc } = require('./voice/voiceIpc');
const { VoiceService } = require('./voice/voiceService');
const { VoiceLabController } = require('./voice/voiceLabController');
const { setupVoiceLabIpc } = require('./voice/voiceLabIpc');
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
const { executeToolRequest, ACTION_POLICIES } = require('./agents/toolGateway');
const { FileCandidateVault } = require('./agents/fileCandidateVault');
const { DesktopCloudClient } = require('./cloud/desktopCloudClient');
const { createSecureCloudTransport } = require('./cloud/secureCloudTransport');
const { CloudVoiceService } = require('./voice/cloudVoiceService');

if (process.platform === 'win32') {
  // Keep hidden renderer processes alive so microphone capture continues in the tray/background.
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
}

let mainWindow = null;
let voiceOverlayWindow = null;
let transcriptionBarWindow = null;
let voiceLabWindow = null;
let hologramWidgetWindow = null;
let showTranscriptionBar = true;
let showHologramWidget = true;
let tray = null;
let voiceService = null;
let voiceLabController = null;
let desktopAgentClient = null;
let activeAgentTaskId = null;
let lastExternalForegroundHwnd = null;
let suppressNextDesktopAgentExit = false;
let appRecoveryService = null;
let desktopCloudClient = null;
let cloudVoiceService = null;
let cloudTransport = null;
const appSelectionTickets = new Map();
const remoteFileCandidates = new FileCandidateVault();
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

function sendCloudEvent(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function broadcastCoreMode(mode, extra = {}) {
  const payload = { mode, ...extra };
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send('jarvis:core-mode', payload);
      }
    } catch (e) {}
  }
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

function registerRemoteAppTicket(candidate) {
  const now = Date.now();
  for (const [candidateId, ticket] of appSelectionTickets) {
    if (now > ticket.expiresAt) appSelectionTickets.delete(candidateId);
  }
  const candidateId = `candidate-${crypto.randomUUID()}`;
  appSelectionTickets.set(candidateId, { candidate, expiresAt: now + 10 * 60 * 1000 });
  return { ...candidate, candidateId };
}

function registerRemoteAppResolution(result) {
  if (!result || typeof result !== 'object') return result;
  const copy = { ...result };
  if (copy.app) copy.app = registerRemoteAppTicket(copy.app);
  if (Array.isArray(copy.candidates)) {
    copy.candidates = copy.candidates.map(registerRemoteAppTicket);
  }
  return copy;
}

function resolveRemoteAppCandidate(candidateId) {
  const id = requireOpaqueId(candidateId, 'candidate');
  const ticket = appSelectionTickets.get(id);
  appSelectionTickets.delete(id);
  if (!ticket || Date.now() > ticket.expiresAt) throw new Error('app candidate is unavailable or expired');
  return ticket.candidate;
}

function registerRemoteFileSearch(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.results)) return result;
  return { ...result, results: remoteFileCandidates.registerMany(result.results) };
}

function resolveRemoteFileCandidate(candidateId, options = {}) {
  return remoteFileCandidates.resolve(requireOpaqueId(candidateId, 'candidate-file'), options);
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
showHologramWidget = initialUiState.showHologramWidget !== false;

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
  const isMicOn = cloudVoiceService ? cloudVoiceService.isVoiceEnabled : (voiceService ? voiceService.isVoiceEnabled : false);

  const contextMenu = Menu.buildFromTemplate(buildTrayMenuTemplate({
    isMicOn,
    showHologramWidget,
    showTranscriptionBar,
    onToggleMic: () => {
        if (cloudVoiceService) {
          if (cloudVoiceService.isVoiceEnabled) cloudVoiceService.disable();
          else cloudVoiceService.enable();
          updateTrayMenu();
        }
      },
    onToggleHologramWidget: (checked) => {
      toggleHologramWidget(checked);
    },
    onToggleTranscriptionBar: (checked) => {
      toggleTranscriptionBar(checked);
    },
    onQuit: () => shutdownApp(),
  }));
  tray.setContextMenu(contextMenu);
}

function toggleHologramWidget(visible) {
  showHologramWidget = visible;
  const uiState = loadJSON(UI_STATE_PATH, {});
  uiState.showHologramWidget = visible;
  saveJSON(UI_STATE_PATH, uiState);

  if (visible) {
    if (!hologramWidgetWindow || hologramWidgetWindow.isDestroyed()) {
      createHologramWidgetWindow();
    } else {
      hologramWidgetWindow.show();
    }
  } else {
    if (hologramWidgetWindow && !hologramWidgetWindow.isDestroyed()) {
      hologramWidgetWindow.hide();
    }
  }
  updateTrayMenu();
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
    width: 1040,
    height: 740,
    minWidth: 760,
    minHeight: 560,
    frame: true,
    transparent: false,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: false,
    show: false,
    // CRITICAL: disable background throttling so voice capture works when window is hidden
    backgroundThrottling: false,
    webPreferences: {
      preload: path.join(__dirname, 'cloud', 'cloudPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'cloud-chat', 'index.html'));

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
    height: 300,
    x: Math.round(screen.getPrimaryDisplay().workAreaSize.width / 2 - 400),
    y: Math.round(screen.getPrimaryDisplay().workAreaSize.height - 330), // At the bottom
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

function createHologramWidgetWindow() {
  if (hologramWidgetWindow && !hologramWidgetWindow.isDestroyed()) return;

  const uiState = loadJSON(UI_STATE_PATH, {});
  const savedPos = uiState.hologramWidgetPosition;
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const defaultX = Math.round(screenWidth - 320);
  const defaultY = Math.round(screenHeight - 320);

  hologramWidgetWindow = new BrowserWindow({
    width: 300,
    height: 300,
    x: (savedPos && typeof savedPos[0] === 'number') ? savedPos[0] : defaultX,
    y: (savedPos && typeof savedPos[1] === 'number') ? savedPos[1] : defaultY,
    frame: false,
    transparent: true,
    alwaysOnTop: Boolean(uiState.hologramWidgetPinned),
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: showHologramWidget,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  hologramWidgetWindow.setAlwaysOnTop(Boolean(uiState.hologramWidgetPinned), 'normal');

  hologramWidgetWindow.loadFile(path.join(__dirname, 'renderer', 'quantum-widget.html'));

  let moveTimeout;
  hologramWidgetWindow.on('move', () => {
    if (moveTimeout) clearTimeout(moveTimeout);
    moveTimeout = setTimeout(() => {
      if (hologramWidgetWindow && !hologramWidgetWindow.isDestroyed()) {
        const pos = hologramWidgetWindow.getPosition();
        const latestUiState = loadJSON(UI_STATE_PATH, {});
        latestUiState.hologramWidgetPosition = pos;
        saveJSON(UI_STATE_PATH, latestUiState);
      }
    }, 500);
  });

  hologramWidgetWindow.on('closed', () => {
    hologramWidgetWindow = null;
  });
}

function openVoiceLab() {
  if (voiceLabWindow && !voiceLabWindow.isDestroyed()) {
    voiceLabWindow.show();
    voiceLabWindow.focus();
    return;
  }

  voiceLabWindow = new BrowserWindow({
    width: 1020,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    backgroundThrottling: false,
    webPreferences: {
      preload: path.join(__dirname, 'voice', 'voiceLabPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  voiceLabWindow.loadFile(path.join(__dirname, 'renderer', 'voice-lab', 'index.html'));
  voiceLabWindow.once('ready-to-show', () => {
    if (voiceLabWindow && !voiceLabWindow.isDestroyed()) {
      voiceLabWindow.show();
      voiceLabWindow.focus();
    }
  });
  voiceLabWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      voiceLabWindow.hide();
    }
  });
  voiceLabWindow.on('closed', () => {
    voiceLabWindow = null;
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
  if (cloudVoiceService) {
    cloudVoiceService.shutdown();
    cloudVoiceService = null;
  }
  if (desktopCloudClient) {
    desktopCloudClient.stopSession();
    desktopCloudClient = null;
  }
  if (cloudTransport) {
    void cloudTransport.close().catch(() => {});
    cloudTransport = null;
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
  if (voiceLabWindow && !voiceLabWindow.isDestroyed()) {
    voiceLabWindow.close();
  }
  if (hologramWidgetWindow && !hologramWidgetWindow.isDestroyed()) {
    hologramWidgetWindow.close();
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
  // Keep the Desktop cloud channel on encrypted DNS. Some ISPs intercept normal
  // DNS and can redirect the public Jarvis hostname to an unrelated certificate.
  // This does not bypass TLS validation: HTTPS and WSS certificates remain required.
  const startHidden = process.argv.includes('--hidden');

  // --- Permission handler for microphone ---
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      const captureWindow = cloudVoiceService && cloudVoiceService.audioCaptureWindow;
      return callback(Boolean(captureWindow && !captureWindow.isDestroyed() && webContents.id === captureWindow.webContents.id));
    }
    return callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media') {
      const captureWindow = cloudVoiceService && cloudVoiceService.audioCaptureWindow;
      return Boolean(captureWindow && !captureWindow.isDestroyed() && webContents.id === captureWindow.webContents.id);
    }
    return false;
  });

  // --- Enable Windows autostart by default ---
  ensureWindowsAutoStart();

  cloudTransport = createSecureCloudTransport();
  desktopCloudClient = new DesktopCloudClient({
    userDataPath: app.getPath('userData'),
    safeStorage,
    fetch: cloudTransport.fetch,
    WebSocket: cloudTransport.WebSocket,
    allowHttp: !app.isPackaged,
    capabilities: {
      wakeWord: true,
      localTts: true,
      protocolVersion: 1,
      localActions: Object.keys(ACTION_POLICIES),
    },
    executeRemoteCommand: async (request, executionOptions = {}) => {
      const isSearch = request?.action === 'file.search';
      broadcastCoreMode(isSearch ? 'scanner' : 'vortex', { action: request?.action });
      try {
        const result = await executeToolRequest(request, {
          shell,
          workArea: screen.getPrimaryDisplay().workArea,
          resolveAppCandidate: resolveRemoteAppCandidate,
          resolveFileCandidate: resolveRemoteFileCandidate,
          ...executionOptions,
        });
        if (request?.action === 'file.search') return registerRemoteFileSearch(result);
        if (request?.action === 'app.resolve' && result?.result) {
          return { ...result, result: registerRemoteAppResolution(result.result) };
        }
        return result;
      } catch (err) {
        broadcastCoreMode('alert', { error: err.message });
        throw err;
      } finally {
        setTimeout(() => broadcastCoreMode('idle'), 1200);
      }
    },
    onState: (state) => {
      sendCloudEvent('cloud:state', state);
      updateTrayMenu();
    },
    onWorkflowUpdate: (update) => {
      sendCloudEvent('cloud:message', update);
      if (update) {
        if (update.status === 'running') {
          broadcastCoreMode('vortex');
        } else if (update.status === 'failed') {
          broadcastCoreMode('alert', { duration: 3000 });
        } else if (update.answer) {
          const lower = update.answer.toLowerCase();
          let mode = 'speech';
          if (lower.includes('ошибк') || lower.includes('не удалось') || lower.includes('error')) {
            mode = 'alert';
          } else if (lower.includes('найден') || lower.includes('поиск') || lower.includes('сканир')) {
            mode = 'scanner';
          }
          const duration = Math.min(8000, Math.max(3000, update.answer.length * 40));
          broadcastCoreMode(mode, { text: update.answer, duration });
        }
      }
    },
  });
  cloudVoiceService = new CloudVoiceService({
    cloudClient: desktopCloudClient,
    onStatus: (status) => {
      sendCloudEvent('cloud:voice-status', status);
      updateTrayMenu();
    },
    onResponse: (response) => {
      sendCloudEvent('cloud:message', response);
      if (response && response.answer) {
        const duration = Math.min(8000, Math.max(3000, response.answer.length * 40));
        broadcastCoreMode('speech', { text: response.answer, duration });
      }
    },
  });

  // --- Create cloud chat window (always, but hidden if --hidden) ---
  createWindow();
  if (startHidden) {
    mainWindow.hide();
  } else {
    mainWindow.show();
  }

  cloudVoiceService.registerIpcHandlers(isTrustedMainRenderer);
  desktopCloudClient.startSession();

  // --- Tray (always created) ---
  createTray();

  if (showHologramWidget) {
    createHologramWidgetWindow();
  }

  // Register global shortcut to show/hide window
  globalShortcut.register('Ctrl+Alt+J', () => {
    toggleWindow();
  });

  // Whitelist of allowed tool modules
  const ALLOWED_TOOLS = ['runProgram', 'powershell', 'searchFiles', 'sysinfo', 'fileCommander'];

  // --- IPC Handlers ---
  ipcMain.handle('cloud:get-state', (event) => {
    if (!isTrustedMainRenderer(event) || !desktopCloudClient) return { ok: false, error: 'Access denied.' };
    return { ok: true, ...desktopCloudClient.getState() };
  });
  ipcMain.handle('cloud:pair', async (event, input = {}) => {
    if (!isTrustedMainRenderer(event) || !desktopCloudClient) return { ok: false, error: 'Access denied.' };
    try {
      const serverUrl = String(input.serverUrl || '').trim();
      const pairingCode = String(input.pairingCode || '').trim();
      if (!serverUrl || serverUrl.length > 2048 || !pairingCode || pairingCode.length > 64) {
        return { ok: false, error: 'Проверьте адрес сервера и код подключения.' };
      }
      const state = await desktopCloudClient.pair({ serverUrl, pairingCode });
      return { ok: true, ...state };
    } catch (error) {
      return { ok: false, error: 'Не удалось подключить устройство. Проверьте код и адрес сервера.' };
    }
  });
  ipcMain.handle('cloud:send-message', async (event, input = {}) => {
    if (!isTrustedMainRenderer(event) || !desktopCloudClient) return { ok: false, error: 'Access denied.' };
    const text = String(input.text || '').trim();
    if (!text || text.length > 10000) return { ok: false, error: 'Сообщение должно содержать от 1 до 10000 символов.' };
    broadcastCoreMode('vortex', { text, reason: 'text_query' });
    try {
      const result = await desktopCloudClient.sendText(text);
      if (result && result.ok && result.answer) {
        const lower = result.answer.toLowerCase();
        let mode = 'speech';
        if (lower.includes('ошибк') || lower.includes('не удалось') || lower.includes('error') || lower.includes('отказ')) {
          mode = 'alert';
        } else if (lower.includes('найден') || lower.includes('поиск') || lower.includes('сканир')) {
          mode = 'scanner';
        }
        const duration = Math.min(8000, Math.max(3000, result.answer.length * 40));
        broadcastCoreMode(mode, { text: result.answer, duration });
      } else if (result && !result.ok) {
        broadcastCoreMode('alert', { error: result.error, duration: 3000 });
      }
      return result;
    } catch (error) {
      broadcastCoreMode('alert', { error: error.message, duration: 3000 });
      return { ok: false, error: 'Сервер недоступен. Попробуйте ещё раз.' };
    }
  });
  ipcMain.handle('cloud:create-command', async (event, input = {}) => {
    if (!isTrustedMainRenderer(event) || !desktopCloudClient) return { ok: false, error: 'Access denied.' };
    try {
      return await desktopCloudClient.createRemoteCommand({
        deviceId: input.deviceId,
        action: input.action,
        args: input.args || {},
      });
    } catch (error) {
      return { ok: false, error: 'Не удалось создать удалённую команду.' };
    }
  });
  ipcMain.handle('cloud:get-command', async (event, input = {}) => {
    if (!isTrustedMainRenderer(event) || !desktopCloudClient) return { ok: false, error: 'Access denied.' };
    try { return await desktopCloudClient.getRemoteCommand(input.commandId); } catch (_) { return { ok: false, error: 'Команда не найдена.' }; }
  });
  ipcMain.handle('cloud:approve-command', async (event, input = {}) => {
    if (!isTrustedMainRenderer(event) || !desktopCloudClient) return { ok: false, error: 'Access denied.' };
    try { return await desktopCloudClient.approveRemoteCommand(input.commandId); } catch (_) { return { ok: false, error: 'Не удалось подтвердить команду.' }; }
  });
  ipcMain.handle('cloud:reject-command', async (event, input = {}) => {
    if (!isTrustedMainRenderer(event) || !desktopCloudClient) return { ok: false, error: 'Access denied.' };
    try { return await desktopCloudClient.rejectRemoteCommand(input.commandId); } catch (_) { return { ok: false, error: 'Не удалось отменить команду.' }; }
  });
  ipcMain.handle('voice-lab:open', (event) => {
    if (!isTrustedMainRenderer(event) || !voiceLabController) return { ok: false, error: 'Voice Lab unavailable in cloud mode.' };
    openVoiceLab();
    return { ok: true };
  });
  ipcMain.handle('voice-lab:close', (event) => {
    if (!voiceLabWindow || event?.sender?.id !== voiceLabWindow.webContents.id) {
      return { ok: false, error: 'Voice Lab access denied.' };
    }
    voiceLabWindow.hide();
    return { ok: true };
  });
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
    broadcastCoreMode('alert', { tool, args });
    try {
      if (!ALLOWED_TOOLS.includes(tool)) {
        return { ok: false, type: 'error', title: 'Ошибка', content: `Неизвестный инструмент: ${tool}` };
      }
      const toolModule = require(`./tools/${tool}`);
      return await toolModule.execute(args, true);
    } catch (err) {
      return { ok: false, type: 'error', title: 'Ошибка', content: err.message, error: err.message };
    } finally {
      setTimeout(() => broadcastCoreMode('idle'), 1500);
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

  ipcMain.handle('hologram-widget:toggle', (_event, { visible } = {}) => {
    toggleHologramWidget(!!visible);
    return { ok: true, visible: showHologramWidget };
  });

  ipcMain.handle('hologram-widget:set-pin', (_event, { pinned } = {}) => {
    if (hologramWidgetWindow && !hologramWidgetWindow.isDestroyed()) {
      hologramWidgetWindow.setAlwaysOnTop(!!pinned, 'normal');
      const uiState = loadJSON(UI_STATE_PATH, {});
      uiState.hologramWidgetPinned = !!pinned;
      saveJSON(UI_STATE_PATH, uiState);
    }
    return { ok: true, pinned: !!pinned };
  });

  ipcMain.on('hologram-widget:move', (_event, { dx, dy } = {}) => {
    if (hologramWidgetWindow && !hologramWidgetWindow.isDestroyed()) {
      const [x, y] = hologramWidgetWindow.getPosition();
      hologramWidgetWindow.setPosition(Math.round(x + (dx || 0)), Math.round(y + (dy || 0)));
    }
  });

  ipcMain.handle('show-main-window', async () => {
    await showMainWindow();
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
  if (cloudVoiceService) {
    cloudVoiceService.shutdown();
    cloudVoiceService = null;
  }
  if (desktopCloudClient) {
    desktopCloudClient.stopSession();
    desktopCloudClient = null;
  }
  if (cloudTransport) {
    void cloudTransport.close().catch(() => {});
    cloudTransport = null;
  }
  if (voiceLabWindow && !voiceLabWindow.isDestroyed()) {
    voiceLabWindow.destroy();
    voiceLabWindow = null;
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
