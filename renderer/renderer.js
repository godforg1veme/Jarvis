/**
 * Jarvis Renderer - Spotlight-like Launcher UI
 */

// --- State ---
const state = {
  history: [],
  apps: [],
  selectedIndex: 0,
  selectedCandidateIndex: 0,
  results: [],
  confirmingCommand: null,
  confirmingRecovery: null,
  recovery: null,
  debounceTimer: null,
};

// --- Voice Access blacklist (prevent reading from app search) ---
const blockedAppNames = [
  "voice access",
  "voiceaccess",
  "голосовой доступ",
  "windows voice",
  "windows语音",
];

function isBlockedApp(app) {
  const haystack = [
    app.name,
    app.path,
    app.displayName,
    app.title,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return blockedAppNames.some((blocked) => haystack.includes(blocked));
}

// --- Internal command router ---
function normalizeCommandText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[.,!?;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTranslateSelectedCommand(text) {
  return [
    "переведи выделенное",
    "переведи выделенный текст",
    "переведи выбранное",
    "переведи выбранный текст",
  ].some((phrase) => text.includes(phrase));
}

function isVisualAnalyzeCommand(text) {
  return [
    "посмотри сюда",
    "что здесь",
    "что тут",
    "объясни это",
    "что тут не так",
    "что за ошибка",
  ].some((phrase) => text.includes(normalizeCommandText(phrase)));
}

function isVisualContinuationCommand(text) {
  return [
    "что делать",
    "почему",
    "объясни подробнее",
    "а дальше",
    "как исправить",
    "переведи это",
    "что это значит",
  ].some((phrase) => text.includes(normalizeCommandText(phrase)));
}

function isClearVisualContextCommand(text) {
  return [
    "забудь это",
    "забудь экран",
    "очисти визуальный контекст",
    "очисти visual context",
    "сбрось визуальный контекст",
  ].some((phrase) => text.includes(normalizeCommandText(phrase)));
}

async function tryHandleInternalCommand(rawText) {
  const text = normalizeCommandText(rawText);

  if (isTranslateSelectedCommand(text)) {
    if (!window.jarvis || typeof window.jarvis.translateSelected !== "function") {
      return {
        handled: true,
        result: {
          ok: false,
          type: "error",
          title: "Ошибка перевода",
          content: "Перевод выделенного текста недоступен.",
        },
      };
    }

    const result = await window.jarvis.translateSelected();
    return { handled: true, result };
  }

  if (isClearVisualContextCommand(text)) {
    if (!window.jarvis || typeof window.jarvis.clearVisualContext !== "function") {
      return {
        handled: true,
        result: {
          ok: false,
          type: "error",
          title: "Ошибка",
          content: "Очистка визуального контекста недоступна.",
        },
      };
    }

    const result = await window.jarvis.clearVisualContext();
    return { handled: true, result };
  }

  if (isVisualAnalyzeCommand(text)) {
    if (!window.jarvis || typeof window.jarvis.analyzeVisualArea !== "function") {
      return {
        handled: true,
        result: {
          ok: false,
          type: "error",
          title: "Ошибка анализа экрана",
          content: "AI-анализ области экрана недоступен.",
        },
      };
    }

    const result = await window.jarvis.analyzeVisualArea(rawText);
    return { handled: true, result };
  }

  if (isVisualContinuationCommand(text)) {
    if (!window.jarvis || typeof window.jarvis.continueVisualDialog !== "function") {
      return {
        handled: true,
        result: {
          ok: false,
          type: "error",
          title: "Ошибка анализа экрана",
          content: "Визуальный контекст недоступен.",
        },
      };
    }

    const result = await window.jarvis.continueVisualDialog(rawText);
    return { handled: true, result };
  }

  const startVoiceCommands = [
    "включить голос",
    "включи голос",
    "запусти голос",
    "старт голос",
    "начать слушать",
    "включить микрофон",
    "включи микрофон",
  ];

  const stopVoiceCommands = [
    "выключить голос",
    "выключи голос",
    "останови голос",
    "стоп голос",
    "перестань слушать",
    "выключить микрофон",
    "выключи микрофон",
  ];

  if (startVoiceCommands.includes(text)) {
    if (typeof window.startVoiceCapture !== "function") {
      return {
        handled: true,
        ok: false,
        message: "Голосовой модуль не загружен. Проверь подключение voiceCapture.js.",
      };
    }

    await window.startVoiceCapture();

    return {
      handled: true,
      ok: true,
      message: "Голос включён. Скажите: джарвис включи доту.",
    };
  }

  if (stopVoiceCommands.includes(text)) {
    if (typeof window.stopVoiceCapture !== "function") {
      return {
        handled: true,
        ok: false,
        message: "Голосовой модуль не загружен. Проверь подключение voiceCapture.js.",
      };
    }

    await window.stopVoiceCapture();

    return {
      handled: true,
      ok: true,
      message: "Голос выключен.",
    };
  }

  return { handled: false };
}

// --- DOM Elements ---
const inputEl = document.getElementById('input');
const resultsList = document.getElementById('results-list');
const confirmDialog = document.getElementById('confirm-dialog');
const confirmText = document.getElementById('confirm-text');
const confirmYes = document.getElementById('confirm-yes');
const confirmNo = document.getElementById('confirm-no');
const historySummary = document.getElementById('history-summary');
const historyChips = document.getElementById('history-chips');
const voiceStartBtn = document.getElementById('voice-start-btn');
const voiceStopBtn = document.getElementById('voice-stop-btn');
const voiceToggleBtn = document.getElementById('voice-toggle-btn');
const voiceDebugToggle = document.getElementById('voice-debug-toggle');
const voiceLabButton = document.getElementById('voice-lab-button');

if (voiceLabButton) {
  voiceLabButton.addEventListener('click', async () => {
    if (window.jarvis?.openVoiceLab) {
      await window.jarvis.openVoiceLab();
    }
  });
}

function setVoiceToggleState({ enabled = false, busy = false } = {}) {
  if (!voiceToggleBtn) return;

  voiceToggleBtn.classList.toggle('is-on', enabled && !busy);
  voiceToggleBtn.classList.toggle('is-off', !enabled && !busy);
  voiceToggleBtn.classList.toggle('is-busy', busy);
  voiceToggleBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  voiceToggleBtn.title = enabled ? 'Голос включен' : 'Голос выключен';
  voiceToggleBtn.setAttribute('aria-label', enabled ? 'Выключить голос' : 'Включить голос');
}

window.jarvisSetVoiceToggleState = setVoiceToggleState;

function isVoiceDebugOpen() {
  const voiceDebugPanel = document.getElementById('voice-debug-panel');
  return Boolean(voiceDebugPanel && voiceDebugPanel.classList.contains('is-open'));
}

function setVoiceDebugOpen(isOpen) {
  const voiceDebugPanel = document.getElementById('voice-debug-panel');
  if (!voiceDebugPanel || !voiceDebugToggle) return;

  voiceDebugPanel.classList.toggle('is-open', isOpen);
  voiceDebugPanel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  voiceDebugToggle.classList.toggle('is-open', isOpen);
  voiceDebugToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

if (voiceDebugToggle) {
  voiceDebugToggle.addEventListener('click', () => {
    setVoiceDebugOpen(!isVoiceDebugOpen());
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !isVoiceDebugOpen()) return;

  e.preventDefault();
  setVoiceDebugOpen(false);
});

if (voiceToggleBtn) {
  voiceToggleBtn.addEventListener('click', () => {
    const isEnabled = voiceToggleBtn.getAttribute('aria-pressed') === 'true';

    if (isEnabled) {
      if (typeof window.stopVoiceCapture === 'function') {
        window.stopVoiceCapture();
      }
      return;
    }

    if (typeof window.startVoiceCapture === 'function') {
      window.startVoiceCapture();
    }
  });
}

document.addEventListener('jarvis:voice-state', (event) => {
  setVoiceToggleState(event.detail || {});
});

if (voiceStartBtn) {
  voiceStartBtn.addEventListener('click', () => {
    if (typeof window.startVoiceCapture === 'function') {
      window.startVoiceCapture();
    }
  });
}

if (voiceStopBtn) {
  voiceStopBtn.addEventListener('click', () => {
    if (typeof window.stopVoiceCapture === 'function') {
      window.stopVoiceCapture();
    }
  });
}

// --- Initialize ---
async function init() {
  state.history = await window.jarvis.getHistory() || [];
  state.apps = await window.jarvis.getApps() || [];
  showHistory();
  updateHistoryPanel();
  inputEl.focus();
}

// --- Index status from main process (auto-index) ---
window.jarvis.onIndexStatus((data) => {
  if (data.status === 'indexing') {
    clearResults();
    state.results = [{
      type: 'sys',
      title: data.message,
      content: 'Пожалуйста, подождите...',
    }];
    renderResults();
  } else if (data.status === 'done') {
    // Refresh apps list
    window.jarvis.getApps().then(apps => { state.apps = apps; });
    clearResults();
    state.results = [{
      type: 'sys',
      title: data.message,
      content: `Найдено ${data.count} приложений`,
      success: true,
    }];
    renderResults();
  }
});

// --- Focus Input from main process ---
window.jarvis.onFocusInput(() => {
  inputEl.focus();
  inputEl.value = '';
  clearResults();
  showHistory();
  state.selectedIndex = 0;
  state.selectedCandidateIndex = 0;
});

// --- Input Handling ---
inputEl.addEventListener('input', () => {
  clearTimeout(state.debounceTimer);
  const val = inputEl.value.trim();

  if (!val) {
    showHistory();
    return;
  }

  state.debounceTimer = setTimeout(() => {
    showSuggestions(val);
  }, 200);
});

inputEl.addEventListener('keydown', (e) => {
  if (state.confirmingCommand || state.confirmingRecovery) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveCandidateSelection(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveCandidateSelection(-1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    handleEnter();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (state.recovery && !['completed', 'cancelled', 'failed'].includes(state.recovery.state)) {
      window.jarvis.cancelAppRecovery(state.recovery.recoveryId);
      return;
    }
    if (isVoiceDebugOpen()) {
      setVoiceDebugOpen(false);
      return;
    }
    inputEl.value = '';
    clearResults();
    showHistory();
  }
});

if (window.jarvis.onAppRecoveryState) {
  window.jarvis.onAppRecoveryState((snapshot) => {
    displayRecovery(snapshot);
  });
}

// --- History ---
function showHistory() {
  if (!state.history || state.history.length === 0) {
    state.results = [];
    state.selectedIndex = 0;
    state.selectedCandidateIndex = 0;
    updateHistoryPanel();
    showEmptyState();
    return;
  }

  state.results = state.history.slice(0, 15).map(h => ({
    type: 'history',
    title: h.command || '',
    content: `${h.tool} | ${h.timestamp || ''}`,
    data: null,
    originalText: h.command || '',
  }));

  state.selectedIndex = 0;
  state.selectedCandidateIndex = 0;
  updateHistoryPanel();
  renderResults();
}

// --- Autocomplete / Suggestions ---
function showSuggestions(query) {
  const lower = query.toLowerCase();
  const suggestions = [];

  for (const app of state.apps) {
    // Skip blocked apps (Windows Voice Access etc.)
    if (isBlockedApp(app)) continue;

    if (app.name.toLowerCase().includes(lower) ||
        (app.aliases || []).some(a => a.toLowerCase().includes(lower))) {
      suggestions.push({
        type: 'run',
        title: `${app.icon || ''} ${app.name}`,
        content: `Запустить ${app.name} (${app.command || app.path || ''})`,
        data: app,
        originalText: app.name,
      });
    }
  }

  const commands = [
    { prefix: 'переведи выделенное', title: 'переведи выделенное', desc: 'Перевести текущий выделенный текст на русский' },
    { prefix: 'посмотри сюда', title: 'посмотри сюда', desc: 'Проанализировать область экрана вокруг курсора' },
    { prefix: 'забудь экран', title: 'забудь экран', desc: 'Очистить последний визуальный контекст' },
    { prefix: '/run ', title: '/run <приложение>', desc: 'Запустить программу' },
    { prefix: '/agent ', title: '/agent <задача>', desc: 'Открыть Desktop Agent task window' },
    { prefix: '/ps ', title: '/ps <команда>', desc: 'Выполнить PowerShell-команду' },
    { prefix: '/find ', title: '/find <запрос>', desc: 'Найти файлы' },
    { prefix: '/sys', title: '/sys', desc: 'Информация о системе' },
    { prefix: '/appinfo ', title: '/appinfo <приложение>', desc: 'Показать выбранный appResolver-кандидат и детали' },
    { prefix: '/aidebug ', title: '/aidebug <запрос>', desc: 'Показать AI intent JSON без запуска' },
    { prefix: '/refresh-apps', title: '/refresh-apps (или /reindex)', desc: 'Обновить индекс приложений' },
    { prefix: '/addapp ', title: '/addapp <имя> "<путь>"', desc: 'Добавить приложение вручную' },
    { prefix: '/scanroots', title: '/scanroots', desc: 'Показать папки для поиска приложений' },
    { prefix: '/addscanroot ', title: '/addscanroot "<путь>"', desc: 'Добавить папку для поиска' },
  ];

  for (const cmd of commands) {
    if (cmd.prefix.includes(lower) || cmd.title.toLowerCase().includes(lower) || cmd.desc.includes(lower)) {
      suggestions.push({
        type: cmd.prefix.replace(' ', ''),
        title: cmd.title,
        content: cmd.desc,
        data: null,
        originalText: cmd.prefix.replace(' ', ''),
      });
    }
  }

  if (suggestions.length === 0) {
    state.results = [{
      type: 'run',
      title: query,
      content: `Запустить: "${query}"`,
      data: null,
      originalText: query,
    }];
  } else {
    state.results = suggestions.slice(0, 10);
  }

  state.selectedIndex = 0;
  state.selectedCandidateIndex = 0;
  renderResults();
}

// --- Result alias used by candidate buttons ---
function renderResult(result) {
  displayResult(result);
}

window.jarvisDisplayResult = displayResult;

// --- Handle Enter ---
async function handleEnter() {
  if (state.confirmingCommand || state.confirmingRecovery) return;

  const val = inputEl.value.trim();
  if (!val) return;

  // 1. Try internal commands first (voice start/stop)
  const internal = await tryHandleInternalCommand(val);
  if (internal.handled) {
    if (internal.result) {
      await saveAndDisplay(internal.result, val);
      inputEl.value = '';
      return;
    }

    clearResults();
    state.results = [{
      type: internal.ok ? 'voice' : 'error',
      title: internal.ok ? 'Голос' : 'Ошибка',
      content: internal.message,
      success: internal.ok,
      error: !internal.ok,
    }];
    renderResults();
    inputEl.value = '';
    return;
  }

  // 2. Candidate selection
  const selectedItem = getCurrentResultItem();
  if (hasCandidateSelection(selectedItem)) {
    await launchSelectedCandidate();
    return;
  }

  // 3. Existing app search / AI / tool commands
  if (state.results.length > 0 && selectedItem) {
    if (selectedItem.type === 'history' && selectedItem.originalText) {
      inputEl.value = selectedItem.originalText;
      await executeCommand(selectedItem.originalText);
    } else {
      await executeCommand(val);
    }
  } else {
    await executeCommand(val);
  }
}

function getCurrentResultItem() {
  return state.results[state.selectedIndex] || null;
}

function hasCandidateSelection(item) {
  return !!(item && item.needsSelection && Array.isArray(item.candidates) && item.candidates.length > 0);
}

const typeLabels = {
  run: 'Запуск',
  runProgram: 'Запуск',
  file: 'Файл',
  fileCommander: 'Файл',
  powershell: 'PowerShell',
  find: 'Поиск',
  searchFiles: 'Поиск',
  sys: 'Система',
  sysinfo: 'Система',
  history: 'История',
  error: 'Ошибка',
  ai: 'AI',
  visual: 'Зрение',
  voice: 'Голос',
};

const typeIcons = {
  run: '▶',
  runProgram: '▶',
  file: '▣',
  fileCommander: '▣',
  powershell: '⚡',
  find: '⌕',
  searchFiles: '⌕',
  sys: '▣',
  sysinfo: '▣',
  history: '↺',
  error: '!',
  ai: '◇',
  visual: '◎',
  voice: '🎙',
};

function labelForType(type) {
  return typeLabels[type] || type || 'Команда';
}

function iconForType(type) {
  return typeIcons[type] || '⌘';
}

function updateHistoryPanel() {
  if (!historySummary || !historyChips) return;

  const recent = (state.history || []).slice(0, 3);
  const recentCommands = recent.map((item) => item.command || '').filter(Boolean);
  historySummary.textContent = recentCommands.length
    ? recentCommands.join(' · ')
    : 'История появится после первого запуска.';

  historyChips.innerHTML = '';
  recent.forEach((item) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = item.tool || 'run';
    historyChips.appendChild(chip);
  });
}

function candidateLabel(candidate) {
  const candidateName = candidate.displayName || candidate.name || 'Без названия';
  if (candidate.type === 'file') {
    const warning = candidate.warning ? '⚠ ' : '';
    const size = candidate.size ? ` · ${candidate.size} B` : '';
    const detail = candidate.directory || candidate.path || '';
    return `${warning}${candidateName}${detail ? ` — ${detail}` : ''}${size}`;
  }

  const source = candidate.source || candidate.type || '?';
  const score = typeof candidate.score === 'number' ? ` · score ${candidate.score.toFixed(2)}` : '';
  const detail = candidate.command || candidate.path || candidate.aumid || '';
  return `${candidate.icon || ''} ${candidateName} (${source}${score})${detail ? ` — ${detail}` : ''}`;
}

async function launchCandidate(candidate) {
  if (window.jarvis.launchSelectedApp) {
    return await window.jarvis.launchSelectedApp(candidate.candidateId);
  }

  return await window.jarvis.executeTool('runProgram', {
    app: candidate.command || candidate.name,
    _direct: candidate,
  });
}

async function launchSelectedCandidate() {
  const item = getCurrentResultItem();
  if (!hasCandidateSelection(item)) return;

  const candidate = item.candidates[state.selectedCandidateIndex];
  if (!candidate) return;

  if (item.recovery) {
    const result = await window.jarvis.selectAppRecovery(item.recoveryId, candidate.candidateId);
    if (result && result.recovery) displayRecovery(result.recovery);
    else displayResult(result);
    return;
  }

  if (candidate.type === 'file') {
    const result = await window.jarvis.executeTool('fileCommander', {
      action: candidate.action || 'open',
      query: candidate.name,
      location: 'direct',
      selectedFile: candidate,
      confirmed: !!candidate.warning,
    });
    inputEl.value = '';
    await saveAndDisplay(result, candidate.path || candidate.name);
    return;
  }

  const rawInput = candidate.command || candidate.name || candidate.path || '';
  const result = await launchCandidate(candidate);
  inputEl.value = '';
  
  // Hide window on success
  if (result && result.ok && window.jarvis.hideWindow) {
    window.jarvis.hideWindow();
  }
  
  await saveAndDisplay(result, rawInput);
}

function moveCandidateSelection(delta) {
  const item = getCurrentResultItem();
  if (!hasCandidateSelection(item)) {
    moveSelection(delta);
    return;
  }

  const count = item.candidates.length;
  state.selectedCandidateIndex = (state.selectedCandidateIndex + delta + count) % count;
  renderResults();

  const selected = resultsList.querySelector('.candidate-button.selected');
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

function agentEscalationContext(result, toolName) {
  if (!result || !['runProgram', 'fileCommander'].includes(toolName)) return null;
  if (result.needsSelection && Array.isArray(result.candidates) && result.candidates.length > 0) {
    if (toolName === 'runProgram') return null;
    return {
      kind: 'candidate_selection',
      reason: result.type === 'file' || toolName === 'fileCommander'
        ? 'Нужно выбрать файл из нескольких вариантов.'
        : 'Нужно выбрать приложение из нескольких вариантов.',
      candidates: result.candidates,
    };
  }
  if (result.needsConfirmation && result.commandToConfirm && result.commandToConfirm.tool === 'fileCommander') {
    return {
      kind: 'confirmation',
      reason: 'Открытие найденного файла требует подтверждения.',
      confirmation: result.commandToConfirm,
    };
  }
  return null;
}

// --- Execute Command ---
async function executeCommand(rawInput) {
  if (state.recovery && !['completed', 'cancelled', 'failed'].includes(state.recovery.state)) {
    await window.jarvis.cancelAppRecovery(state.recovery.recoveryId);
    state.recovery = null;
    state.confirmingRecovery = null;
  }
  const toolName = parseTool(rawInput);
  const args = parseArgs(rawInput, toolName);

  // Handle refresh-apps specially
  if (toolName === 'refresh') {
    const result = await window.jarvis.refreshApps();
    saveAndDisplay(result, rawInput);
    return;
  }

  // Handle addapp specially
  if (toolName === 'addapp') {
    const addArgs = parseArgs(rawInput, toolName);
    const result = await window.jarvis.addApp(addArgs);
    saveAndDisplay(result, rawInput);
    return;
  }

  // Handle aidebug specially — show AI intent JSON without launching anything.
  if (toolName === 'agent') {
    const agentArgs = parseArgs(rawInput, toolName);
    const result = await window.jarvis.startAgentTask(agentArgs.command);
    saveAndDisplay(result, rawInput);
    return;
  }

  if (toolName === 'aidebug') {
    const aiArgs = parseArgs(rawInput, toolName);
    const result = await window.jarvis.executeTool('runProgram', aiArgs);
    saveAndDisplay(result, rawInput);
    return;
  }

  // Handle appinfo specially
  if (toolName === 'appinfo') {
    const infoArgs = parseArgs(rawInput, toolName);
    const result = await window.jarvis.executeTool('runProgram', infoArgs);
    saveAndDisplay(result, rawInput);
    return;
  }

  // Show loading
  clearResults();
  state.results = [{
    type: toolName,
    title: 'Выполняю...',
    content: rawInput,
    data: null,
  }];
  renderResults();

  const result = await window.jarvis.executeTool(toolName, args);

  if (result && result.needsAgent && result.command) {
    const agentResult = await window.jarvis.startAgentTask(result.command, {
      escalationReason: result.content || 'Команда требует многошагового плана.',
      escalationKind: 'semantic',
    });
    saveAndDisplay(agentResult, rawInput);
    return;
  }

  const escalationContext = agentEscalationContext(result, toolName);
  if (escalationContext) {
    const agentResult = await window.jarvis.startAgentTask(rawInput, {
      escalationReason: escalationContext.reason,
      escalationKind: escalationContext.kind,
      initialContext: escalationContext,
    });
    saveAndDisplay(agentResult, rawInput);
    return;
  }

  // Handle PowerShell confirmation
  if (result && result.needsConfirmation && result.commandToConfirm) {
    state.confirmingCommand = result.commandToConfirm;
    confirmText.textContent = result.content;
    confirmDialog.classList.remove('hidden');
    confirmYes.focus();
    return;
  }

  saveAndDisplay(result, rawInput);
}

// Save to history and display result
async function saveAndDisplay(result, rawInput) {
  if (!result) return;

  if (result.ok) {
    inputEl.value = '';
  }

  displayResult(result, rawInput);

  await window.jarvis.saveHistory({
    command: rawInput,
    tool: result.type || (rawInput.startsWith('/') ? rawInput.split(' ')[0].slice(1) : 'run'),
    timestamp: new Date().toISOString(),
  });
  state.history = await window.jarvis.getHistory() || [];
  updateHistoryPanel();
}

// --- Parse Tool & Args ---
function cleanFileCommandText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"]/g, '')
    .replace(/[,!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripFileWakeWord(text) {
  return String(text || '').replace(/^(джарвис|jarvis)\s+/i, '').trim();
}

function normalizeFileLocation(text) {
  const normalized = cleanFileCommandText(text);
  const aliases = [
    ['desktop', ['desktop', 'рабочий стол', 'рабочем столе', 'на рабочем столе']],
    ['downloads', ['downloads', 'download', 'загрузки', 'загрузках', 'в загрузках']],
    ['documents', ['documents', 'document', 'документы', 'документах', 'в документах']],
    ['pictures', ['pictures', 'images', 'изображения', 'картинки', 'фото']],
    ['videos', ['videos', 'video', 'видео']],
    ['music', ['music', 'музыка', 'музыке']],
    ['home', ['home', 'user', 'домашняя папка', 'папка пользователя']],
    ['computer', ['computer', 'pc', 'на пк', 'на компьютере', 'везде', 'не помню где']],
  ];

  for (const [id, names] of aliases) {
    if (names.some((name) => normalized.includes(cleanFileCommandText(name)))) return id;
  }

  return '';
}

function parseFileCommandForRenderer(rawText) {
  const text = cleanFileCommandText(rawText);
  const withoutWake = stripFileWakeWord(text);
  let action = '';

  if (/^(покажи|показать|show|reveal)(\s|$)/.test(withoutWake)) action = 'reveal';
  else if (/^(найди|найти|поиск|ищи|find|search)(\s|$)/.test(withoutWake)) action = 'find';
  else if (/^(открой|открыть|open)(\s|$)/.test(withoutWake)) action = 'open';
  if (!action) return null;

  const targetType = /(?:^|\s)(папку|папка|папке|директорию|директория|folder|directory)(?:\s|$)/i.test(withoutWake)
    ? 'directory'
    : /(?:^|\s)(файл|файлик|file)(?:\s|$)/i.test(withoutWake)
      ? 'file'
      : 'any';
  const location = normalizeFileLocation(text) || 'computer';
  let query = stripFileWakeWord(text)
    .replace(/^(открой|открыть|покажи|показать|найди|найти|поиск|ищи|open|show|reveal|find|search)\s+/i, '')
    .replace(/^(файл|файлик|папку|папка|папке|директорию|директория|file|folder|directory)\s+/i, '')
    .trim();

  [
    'on desktop',
    'desktop',
    'на рабочем столе',
    'рабочем столе',
    'рабочий стол',
    'в загрузках',
    'загрузках',
    'загрузки',
    'в документах',
    'документах',
    'документы',
    'в изображениях',
    'изображениях',
    'изображения',
    'в видео',
    'в музыке',
    'музыке',
    'музыка',
    'в домашней папке',
    'домашней папке',
    'домашняя папка',
    'на компьютере',
    'на пк',
    'везде',
    'не помню где',
  ].forEach((phrase) => {
    query = query.replace(phrase, ' ');
  });

  query = query.replace(/\b(в|на)\s*$/i, '').replace(/\s+/g, ' ').trim();
  if (!query) return null;

  return { action, query, location, targetType };
}

function stripAgentPrefixForRenderer(input) {
  let command = String(input || '').trim();
  command = command.replace(/^\/agent\s+/i, '');
  command = command.replace(/^(агент|agent)[,\s:]*/i, '');
  command = command.replace(/^(джарвис|jarvis)\s+(сделай|выполни задачу|разберись|организуй)[,\s:]*/i, '');
  command = command.replace(/^(джарвис|jarvis)\s+(do|run task|handle|figure out|organize)[,\s:]*/i, '');
  command = command.replace(/^(сделай|выполни задачу|разберись|организуй)[,\s:]*/i, '');
  command = command.replace(/^(do|run task|handle|figure out|organize)[,\s:]*/i, '');
  return command.trim();
}

function shouldUseAgentForRenderer(input) {
  const raw = String(input || '').trim();
  const text = normalizeCommandText(raw);
  if (/^\/agent\s+/i.test(raw)) return true;
  if (/^(агент|agent)\b/i.test(raw)) return true;
  if (/^(джарвис|jarvis)\s+(сделай|выполни задачу|разберись|организуй)\b/i.test(raw)) return true;
  if (/^(джарвис|jarvis)\s+(do|run task|handle|figure out|organize)\b/i.test(raw)) return true;
  if (/^(сделай|выполни задачу|разберись|организуй)\b/i.test(raw)) return true;
  if (/^(do|run task|handle|figure out|organize)\b/i.test(raw)) return true;

  const batch = /\b(all|every|до\s+\d+|все|кажд|несколько)\b/.test(text) ||
    /[*?]\.[a-z0-9]+/.test(text) ||
    (/\bpng|jpg|pdf|txt\b/.test(text) && /\bmove|copy|delete|перемест|скопир|удал/i.test(text));
  const multiStep = (/\b(and then|then|после этого|затем|и потом|а потом)\b/.test(text) || text.includes(' и ')) &&
    ['find', 'search', 'move', 'copy', 'rename', 'delete', 'create', 'open', 'найди', 'перемести', 'скопируй', 'переименуй', 'удали', 'создай', 'открой']
      .filter((word) => text.includes(word)).length >= 2;
  const windowLayout = /\b(window|windows|окн|приложени|app)\b/.test(text) &&
    /\b(left|right|top|bottom|layout|snap|columns|слева|справа|сверху|снизу|размест|располож|колонк)\b/.test(text);

  return batch || multiStep || windowLayout;
}

function parseTool(input) {
  const trimmed = input.trim();
  if (trimmed.startsWith('/run ')) return 'runProgram';
  if (trimmed.startsWith('/agent ')) return 'agent';
  if (trimmed.startsWith('/ps ')) return 'powershell';
  if (trimmed.startsWith('/find ')) return 'searchFiles';
  if (trimmed.startsWith('/sys')) return 'sysinfo';
  if (trimmed.startsWith('/refresh-apps')) return 'refresh';
  if (trimmed.startsWith('/addapp')) return 'addapp';
  if (trimmed.startsWith('/appinfo')) return 'appinfo';
  if (trimmed.startsWith('/aidebug')) return 'aidebug';

  const lower = trimmed.toLowerCase();
  if (shouldUseAgentForRenderer(trimmed)) return 'agent';
  if (parseFileCommandForRenderer(trimmed)) return 'fileCommander';
  if (/aidebug/.test(lower)) return 'aidebug';
  if (/appinfo/.test(lower)) return 'appinfo';
  if (/систем|инфо|cpu|ram|память|диск/.test(lower)) return 'sysinfo';
  if (/найди|найти|поиск|search|find/.test(lower)) return 'searchFiles';
  if (/powershell|павершелл|пс|выполни|execute/.test(lower)) return 'powershell';

  return 'runProgram';
}

function parseArgs(input, toolName) {
  const trimmed = input.trim();
  switch (toolName) {
    case 'runProgram': {
      let app = trimmed;
      if (trimmed.startsWith('/run ')) app = trimmed.slice(5).trim();
      return { app };
    }
    case 'refresh':
      return {};
    case 'agent':
      return { command: stripAgentPrefixForRenderer(trimmed) };
    case 'addapp': {
      const rest = trimmed.slice(8).trim();
      const match = rest.match(/^(\S+)\s+"(.+)"$/);
      if (match) return { alias: match[1], appPath: match[2] };
      return { alias: rest, appPath: '' };
    }
    case 'appinfo': {
      let query = trimmed;
      if (trimmed.startsWith('/appinfo ')) query = trimmed.slice(9).trim();
      return { app: query, _appinfo: true };
    }
    case 'aidebug': {
      let query = trimmed;
      if (trimmed.startsWith('/aidebug ')) query = trimmed.slice(9).trim();
      return { app: query, _aidebug: true };
    }
    case 'powershell': {
      let command = trimmed;
      if (trimmed.startsWith('/ps ')) command = trimmed.slice(4).trim();
      return { command };
    }
    case 'fileCommander':
      return parseFileCommandForRenderer(trimmed) || { action: 'find', query: trimmed, location: 'computer' };
    case 'searchFiles': {
      let query = trimmed;
      if (trimmed.startsWith('/find ')) query = trimmed.slice(6).trim();
      return { query };
    }
    case 'sysinfo':
      return {};
    default:
      return { app: trimmed };
  }
}

// --- Display Result ---
function displayResult(result, rawInput) {
  if (!result) return;

  if (result.recovery) {
    displayRecovery(result.recovery);
    return;
  }

  if (result.needsConfirmation && result.commandToConfirm) {
    state.confirmingCommand = result.commandToConfirm;
    confirmText.textContent = result.content || result.message || 'Нужно подтверждение.';
    confirmDialog.classList.remove('hidden');
    confirmYes.focus();
    return;
  }

  state.results = [];
  state.selectedIndex = 0;
  state.selectedCandidateIndex = 0;

  // Handle needsSelection (multiple candidates)
  if (result.needsSelection && result.candidates) {
    state.results.push({
      type: result.type || 'run',
      title: result.title || 'Выберите приложение',
      content: result.content || '',
      candidates: result.candidates,
      needsSelection: true,
    });
    renderResults();
    return;
  }

  // Handle notFound
  if (result.notFound) {
    state.results.push({
      type: 'error',
      title: result.title || 'Приложение не найдено',
      content: result.content || result.message || 'Не нашёл приложение.',
      notFound: true,
    });
    renderResults();
    return;
  }

  // Handle refresh-apps result
  if (result.ok !== undefined && result.count !== undefined) {
    state.results.push({
      type: 'sys',
      title: 'Индекс приложений обновлён',
      content: `Найдено приложений: ${result.count}`,
      success: true,
    });
    renderResults();
    return;
  }

  // Handle AI debug JSON
  if (result.type === 'ai') {
    const content = JSON.stringify(result.data || result, null, 2);
    state.results.push({
      type: 'ai',
      title: result.title || (result.ok === false ? 'AI intent error' : 'AI intent JSON'),
      content,
      fullContent: content,
      success: result.ok !== false,
      error: result.ok === false,
    });
    renderResults();
    return;
  }

  // Normal result
  if (result.ok) {
    const launchedName = result.type === 'run' && result.data && result.data.name ? result.data.name : '';
    state.results.push({
      type: result.type,
      title: result.type === 'run' ? `Запущено: ${launchedName}` : result.title,
      content: result.content,
      data: result.data,
      success: true,
    });
  } else {
    state.results.push({
      type: result.type || 'error',
      title: result.title,
      content: result.content || result.error || 'Неизвестная ошибка',
      data: result.data,
      error: true,
    });
  }

  renderResults();
}

function recoveryStateText(snapshot) {
  if (snapshot.state === 'quick_discovery') return 'Проверяю системные источники и настроенные папки…';
  if (snapshot.state === 'extended_discovery') {
    const progress = snapshot.progress || {};
    return `Ищу по локальным дискам… Проверено: ${progress.visited || 0}, найдено: ${progress.found || 0}`;
  }
  if (snapshot.state === 'ai_ranking') return 'AI сопоставляет локально найденные кандидаты…';
  if (snapshot.state === 'awaiting_selection') return 'Найдено несколько вариантов. Выберите приложение.';
  if (snapshot.state === 'awaiting_confirmation') return 'Проверьте найденное приложение и подтвердите запуск.';
  if (snapshot.state === 'launching') return 'Запускаю подтверждённое приложение…';
  if (snapshot.state === 'learning') return 'Сохраняю алиасы для локального поиска…';
  if (snapshot.state === 'completed') return snapshot.result?.warning || snapshot.result?.message || 'Приложение запущено и запомнено.';
  if (snapshot.state === 'cancelled') return 'Поиск отменён.';
  return snapshot.error || 'Не удалось найти приложение.';
}

function displayRecovery(snapshot) {
  if (!snapshot) return;
  state.recovery = snapshot;
  state.results = [{
    type: 'run',
    title: 'Поиск неизвестного приложения',
    content: recoveryStateText(snapshot),
    candidates: snapshot.state === 'awaiting_selection' ? snapshot.candidates || [] : [],
    needsSelection: snapshot.state === 'awaiting_selection',
    recovery: true,
    recoveryId: snapshot.recoveryId,
    recoveryState: snapshot.state,
    success: snapshot.state === 'completed',
    error: snapshot.state === 'failed',
  }];
  state.selectedIndex = 0;
  state.selectedCandidateIndex = 0;

  const confirmationCandidate = snapshot.candidates?.find(candidate => candidate.candidateId === snapshot.selectedCandidateId)
    || (snapshot.candidates?.length === 1 ? snapshot.candidates[0] : null);
  if (snapshot.state === 'awaiting_confirmation' && confirmationCandidate) {
    const candidate = confirmationCandidate;
    state.confirmingRecovery = { recoveryId: snapshot.recoveryId, candidate };
    confirmText.textContent = `Запустить ${candidate.displayName} (${candidate.publisher || candidate.location || candidate.type})?`;
    confirmYes.textContent = 'Запустить';
    confirmDialog.classList.remove('hidden');
    confirmYes.focus();
    if (window.jarvis.getAppRecoveryDetails) {
      window.jarvis.getAppRecoveryDetails(snapshot.recoveryId, candidate.candidateId).then(result => {
        if (!result?.ok || state.confirmingRecovery?.recoveryId !== snapshot.recoveryId) return;
        const target = result.details?.target ? ` — ${result.details.target}` : '';
        confirmText.textContent = `Запустить ${candidate.displayName} (${candidate.publisher || candidate.location || candidate.type})${target}?`;
      });
    }
  } else if (!['launching', 'learning'].includes(snapshot.state)) {
    state.confirmingRecovery = null;
    confirmDialog.classList.add('hidden');
    confirmYes.textContent = 'Подтвердить';
  }
  renderResults();
}

// --- Confirm Dialog ---
confirmYes.addEventListener('click', async () => {
  if (state.confirmingRecovery) {
    const pending = state.confirmingRecovery;
    state.confirmingRecovery = null;
    confirmDialog.classList.add('hidden');
    confirmYes.textContent = 'Подтвердить';
    const result = await window.jarvis.confirmAppRecovery(pending.recoveryId);
    if (result?.recovery) {
      displayRecovery(result.recovery);
      if (result.recovery.state === 'completed' && window.jarvis.hideWindow) window.jarvis.hideWindow();
    } else displayResult(result);
    return;
  }
  if (!state.confirmingCommand) return;
  const cmd = state.confirmingCommand;
  confirmDialog.classList.add('hidden');
  state.confirmingCommand = null;

  const result = await window.jarvis.confirmCommand(cmd.tool, cmd.args);
  const rawInput = cmd.args.command ||
    cmd.description ||
    (cmd.args.selectedFile && (cmd.args.selectedFile.path || cmd.args.selectedFile.name)) ||
    '';
  saveAndDisplay(result, rawInput);
});

confirmNo.addEventListener('click', () => {
  if (state.confirmingRecovery) {
    const pending = state.confirmingRecovery;
    state.confirmingRecovery = null;
    confirmDialog.classList.add('hidden');
    confirmYes.textContent = 'Подтвердить';
    window.jarvis.cancelAppRecovery(pending.recoveryId).then(result => {
      if (result?.recovery) displayRecovery(result.recovery);
    });
    return;
  }
  confirmDialog.classList.add('hidden');
  state.confirmingCommand = null;
  clearResults();
  showHistory();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && (state.confirmingRecovery || state.confirmingCommand)) {
    event.preventDefault();
    confirmNo.click();
  }
});

// --- Render Results ---
function renderResults() {
  resultsList.innerHTML = '';

  if (state.results.length === 0) {
    showEmptyState();
    return;
  }

  state.results.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = `result-item${index === state.selectedIndex ? ' selected' : ''}`;

    const iconDiv = document.createElement('div');
    iconDiv.className = 'result-icon';
    iconDiv.textContent = iconForType(item.type || 'history');

    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'result-body';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'result-title';

    const titleText = document.createElement('span');
    titleText.textContent = item.title || '';
    titleDiv.appendChild(titleText);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'result-content' +
      (item.error ? ' error' : '') +
      (item.success ? ' success' : '');
    contentDiv.textContent = item.content || '';

    if (item.fullContent !== undefined) {
      contentDiv.textContent = item.fullContent;
    } else if (contentDiv.textContent.length > 300) {
      contentDiv.textContent = contentDiv.textContent.slice(0, 300) + '...';
    }

    bodyDiv.appendChild(titleDiv);
    bodyDiv.appendChild(contentDiv);

    const badge = document.createElement('span');
    badge.className = `result-type type-${item.type || 'history'}`;
    badge.textContent = labelForType(item.type || 'history');

    div.appendChild(iconDiv);
    div.appendChild(bodyDiv);
    div.appendChild(badge);

    // If item has candidates, render them
    if (item.candidates && item.needsSelection) {
      const candidateDiv = document.createElement('div');
      candidateDiv.className = 'candidate-list';

      item.candidates.forEach((candidate, candidateIndex) => {
        const isSelected = item === getCurrentResultItem() && candidateIndex === state.selectedCandidateIndex;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `candidate-button${isSelected ? ' selected' : ''}`;
        if (candidate.warning) btn.classList.add('warning');
        btn.textContent = candidateLabel(candidate);
        btn.addEventListener('click', async () => {
          state.selectedCandidateIndex = candidateIndex;
          await launchSelectedCandidate();
        });
        candidateDiv.appendChild(btn);
      });

      div.appendChild(candidateDiv);
    }

    if (item.recovery && !['completed', 'cancelled', 'failed'].includes(item.recoveryState)) {
      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'recovery-cancel-button';
      cancelButton.textContent = 'Отменить поиск';
      cancelButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        const result = await window.jarvis.cancelAppRecovery(item.recoveryId);
        if (result?.recovery) displayRecovery(result.recovery);
      });
      div.appendChild(cancelButton);
    }

    // If notFound, add tip
    if (item.notFound) {
      const tipDiv = document.createElement('div');
      tipDiv.className = 'result-tip';
      if (item.type === 'file') {
        tipDiv.innerHTML = 'Можно попробовать:<br>найди файл на компьютере<br>или указать папку: в загрузках, документах, на рабочем столе';
      } else {
        tipDiv.innerHTML = 'Можно добавить папку для поиска:<br>/addscanroot "D:\\Папка"<br>Или добавить приложение вручную:<br>/addapp имя "C:\\путь\\к\\app.exe"';
      }
      div.appendChild(tipDiv);
    }

    div.addEventListener('click', () => {
      if (item.type === 'history' && item.originalText) {
        inputEl.value = item.originalText;
      }
    });
    div.addEventListener('dblclick', () => {
      if (item.type === 'history' && item.originalText) {
        inputEl.value = item.originalText;
        handleEnter();
      }
    });

    resultsList.appendChild(div);
  });
}

function showEmptyState() {
  resultsList.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">J</div>
      <h2>Ничего не выбрано</h2>
      <p>Начните вводить команду, название приложения или путь к файлу.</p>
      <div class="empty-examples">
        <span>/run notepad</span>
        <span>/find *.txt</span>
        <span>/sys</span>
      </div>
    </div>
  `;
}

function clearResults() {
  state.results = [];
  state.selectedIndex = 0;
  state.selectedCandidateIndex = 0;
  resultsList.innerHTML = '';
}

function moveSelection(delta) {
  if (state.results.length === 0) return;
  state.selectedIndex = (state.selectedIndex + delta + state.results.length) % state.results.length;
  state.selectedCandidateIndex = 0;
  renderResults();
  const selected = resultsList.querySelector('.result-item.selected');
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

// --- Init ---
init();
