const cloud = window.jarvisCloud;

const elements = {
  pairingCard: document.getElementById('pairing-card'),
  pairingForm: document.getElementById('pairing-form'),
  serverUrl: document.getElementById('server-url'),
  pairingCode: document.getElementById('pairing-code'),
  pairButton: document.getElementById('pair-button'),
  pairingError: document.getElementById('pairing-error'),
  connectionDot: document.getElementById('connection-dot'),
  connectionLabel: document.getElementById('connection-label'),
  deviceLabel: document.getElementById('device-label'),
  modeBadge: document.getElementById('mode-badge'),
  chatShell: document.getElementById('chat-shell'),
  messages: document.getElementById('messages'),
  messageForm: document.getElementById('message-form'),
  messageInput: document.getElementById('message-input'),
  sendButton: document.getElementById('send-button'),
  voiceButton: document.getElementById('voice-toggle'),
  voiceButtonLabel: document.getElementById('voice-button-label'),
  voiceTitle: document.getElementById('voice-title'),
  voiceDescription: document.getElementById('voice-description'),
  voiceState: document.getElementById('voice-state'),
  visionTitle: document.getElementById('vision-title'),
  visionIndicator: document.getElementById('vision-indicator'),
  visionPreview: document.getElementById('vision-preview'),
  visionCamera: document.getElementById('vision-camera'),
  visionScreens: document.getElementById('vision-screens'),
  visionToggle: document.getElementById('vision-toggle'),
  visionStop: document.getElementById('vision-stop'),
  visionState: document.getElementById('vision-state'),
  visionTimer: document.getElementById('vision-timer'),
  visionTimelineOpen: document.getElementById('vision-timeline-open'),
  visionTimeline: document.getElementById('vision-timeline'),
  visionTimelineClose: document.getElementById('vision-timeline-close'),
  visionMemoryList: document.getElementById('vision-memory-list'),
  visionMemoryDetail: document.getElementById('vision-memory-detail'),
};

let state = { paired: false, connection: 'unpaired', voiceEnabled: false };
let visionState = { state: 'off', startedAt: null, preview: null };
let visionBusy = false;

function clearEmptyChat() {
  const empty = elements.messages.querySelector('.empty-chat');
  if (empty) empty.remove();
}

function appendMessage(role, text, meta) {
  if (!text) return;
  clearEmptyChat();
  const message = document.createElement('article');
  message.className = `message ${role}`;
  const label = document.createElement('div');
  label.className = 'message-meta';
  label.textContent = meta || (role === 'user' ? 'ВЫ' : role === 'system' ? 'СИСТЕМА' : 'JARVIS');
  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = text;
  message.append(label, body);
  elements.messages.appendChild(message);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function connectionText(connection) {
  if (connection === 'online') return 'Подключён к облаку';
  if (connection === 'connecting') return 'Подключаюсь…';
  if (connection === 'offline') return 'Сервер недоступен';
  return 'Не подключён';
}

function renderState(nextState) {
  state = { ...state, ...nextState };
  const connection = state.connection || 'unpaired';
  const paired = Boolean(state.paired);
  elements.connectionDot.className = `signal-dot ${connection === 'online' ? 'online' : connection === 'connecting' ? 'connecting' : 'offline'}`;
  elements.connectionLabel.textContent = connectionText(connection);
  elements.deviceLabel.textContent = paired
    ? `${state.deviceName || 'Jarvis Desktop'} · ${state.serverUrl || 'сервер'}`
    : 'Подключите этот компьютер через Telegram.';
  elements.modeBadge.textContent = connection === 'online' ? 'ОБЛАЧНЫЙ КАНАЛ АКТИВЕН' : paired ? 'ОЖИДАЕТ СОЕДИНЕНИЯ' : 'ОЖИДАЕТ ПРИВЯЗКИ';
  elements.modeBadge.classList.toggle('online', connection === 'online');
  elements.pairingCard.classList.toggle('is-hidden', paired);
  elements.chatShell.classList.toggle('is-disabled', !paired);
  elements.messageInput.disabled = !paired;
  elements.sendButton.disabled = !paired;
  elements.voiceButton.disabled = !paired;
  elements.visionToggle.disabled = !paired || visionBusy;
  elements.visionCamera.disabled = !paired || visionState.state === 'active';
  elements.visionScreens.disabled = !paired || visionState.state === 'active';
  elements.visionTimelineOpen.disabled = !paired;
  if (paired && state.serverUrl) elements.serverUrl.value = state.serverUrl;
  if (!paired && !elements.serverUrl.value && state.defaultServerUrl) elements.serverUrl.value = state.defaultServerUrl;
}

function remainingText(snapshot) {
  const expiries = [snapshot.idleExpiresAt, snapshot.hardExpiresAt]
    .map((value) => Date.parse(value)).filter(Number.isFinite);
  if (!expiries.length) return '00:00';
  const seconds = Math.max(0, Math.ceil((Math.min(...expiries) - Date.now()) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function activeVisionSources(snapshot) {
  const active = (snapshot.sources || []).filter((source) => source.active);
  const hasCamera = active.some((source) => source.type === 'camera');
  const hasWorkspace = active.some((source) => source.type === 'screen_workspace');
  return [hasCamera ? 'камера' : '', hasWorkspace ? 'оба монитора' : ''].filter(Boolean).join(' + ') || 'источник';
}

function renderVision(next = {}) {
  visionState = { ...visionState, ...next };
  const active = visionState.state === 'active';
  elements.visionTitle.textContent = visionBusy ? 'Анализирую сцену' : active ? 'Зрение активно' : 'Зрение выключено';
  elements.visionIndicator.className = `vision-indicator ${visionBusy ? 'busy' : active ? 'active' : 'off'}`;
  elements.visionToggle.textContent = active ? 'Анализировать' : 'Включить';
  elements.visionToggle.disabled = !state.paired || visionBusy;
  elements.visionStop.disabled = !active && !visionBusy;
  elements.visionCamera.disabled = !state.paired || active || visionBusy;
  elements.visionScreens.disabled = !state.paired || active || visionBusy;
  const recentRemote = visionState.lastRemoteUseAt && Date.now() - Date.parse(visionState.lastRemoteUseAt) < 10_000;
  elements.visionState.textContent = visionBusy ? 'Отправляю выбранные кадры в облачный контур зрения…'
    : visionState.lastTemporalError === 'VISION_PRIVACY_PAUSED' ? 'Vision приостановлен: на экране защищённое приложение.'
    : recentRemote ? `Удалённый запрос использует активное зрение: ${activeVisionSources(visionState)}.`
    : active ? `Активно: ${activeVisionSources(visionState)}. STOP немедленно закрывает камеру.`
    : 'Камера и экраны физически закрыты';
  elements.visionTimer.textContent = `${active ? remainingText(visionState) : '00:00'} · ${active ? 'ОСТАЛОСЬ' : 'OFF'}`;
  if (visionState.preview?.dataUrl) {
    const image = document.createElement('img');
    image.src = visionState.preview.dataUrl;
    image.alt = 'Последний кадр, отправленный на визуальный анализ';
    elements.visionPreview.replaceChildren(image);
  } else if (!active) {
    const label = document.createElement('span');
    label.textContent = 'NO VISUAL SIGNAL';
    elements.visionPreview.replaceChildren(label);
  }
}

async function refreshVisionSources() {
  if (!cloud || !state.paired || typeof cloud.listVisionSources !== 'function') return;
  const result = await cloud.listVisionSources();
  if (!result?.ok) { elements.visionState.textContent = result?.error || 'Источники зрения недоступны'; return; }
  const prior = elements.visionCamera.value;
  elements.visionCamera.replaceChildren();
  const automatic = document.createElement('option');
  automatic.value = 'auto'; automatic.textContent = 'Автовыбор · Camo при наличии'; elements.visionCamera.appendChild(automatic);
  const none = document.createElement('option');
  none.value = ''; none.textContent = 'Без камеры'; elements.visionCamera.appendChild(none);
  for (const camera of result.cameras || []) {
    const option = document.createElement('option');
    option.value = camera.sourceId; option.textContent = camera.label || 'Камера'; elements.visionCamera.appendChild(option);
  }
  elements.visionCamera.value = prior && [...elements.visionCamera.options].some((item) => item.value === prior)
    ? prior : 'auto';
}

async function openMemoryDetail(memoryId) {
  elements.visionMemoryDetail.replaceChildren(document.createTextNode('Загружаю зашифрованный снимок…'));
  const result = await cloud.getVisionMemory(memoryId);
  if (!result?.ok) {
    elements.visionMemoryDetail.replaceChildren(document.createTextNode(result?.error || 'Снимок недоступен.'));
    return;
  }
  const record = result.memory;
  const observation = result.observation;
  const image = document.createElement('img');
  image.src = `data:${result.image.contentType};base64,${result.image.data}`;
  image.alt = `Визуальный снимок от ${new Date(record.captured_at).toLocaleString('ru-RU')}`;
  const title = document.createElement('h3'); title.textContent = observation.sceneSummary;
  const meta = document.createElement('p');
  meta.textContent = `${new Date(record.captured_at).toLocaleString('ru-RU')} · ${record.source_id} · уверенность ${observation.confidence === null ? '—' : Math.round(observation.confidence * 100) + '%'}`;
  const actions = document.createElement('div'); actions.className = 'memory-detail-actions';
  const pin = document.createElement('button'); pin.type = 'button'; pin.textContent = record.pinned ? 'Открепить' : 'Закрепить навсегда';
  pin.addEventListener('click', async () => { await cloud.updateVisionMemory(memoryId, { pinned: !record.pinned }); await loadMemoryTimeline(); await openMemoryDetail(memoryId); });
  const correct = document.createElement('button'); correct.type = 'button'; correct.textContent = 'Исправить описание';
  correct.addEventListener('click', async () => {
    const summary = window.prompt('Как правильно описать этот снимок?', observation.sceneSummary);
    if (summary === null) return;
    await cloud.updateVisionMemory(memoryId, { correctedSummary: summary.slice(0, 4000) });
    await openMemoryDetail(memoryId);
  });
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger'; remove.textContent = 'Удалить полностью';
  remove.addEventListener('click', async () => {
    if (!window.confirm('Полностью удалить этот снимок и его зашифрованные данные?')) return;
    await cloud.deleteVisionMemory(memoryId);
    elements.visionMemoryDetail.replaceChildren(document.createTextNode('Снимок удалён.'));
    await loadMemoryTimeline();
  });
  actions.append(pin, correct, remove);
  elements.visionMemoryDetail.replaceChildren(image, title, meta, actions);
}

async function loadMemoryTimeline() {
  elements.visionMemoryList.replaceChildren(document.createTextNode('Загружаю ленту…'));
  const result = await cloud.listVisionMemories();
  if (!result?.ok || !result.memories?.length) {
    elements.visionMemoryList.replaceChildren(document.createTextNode(result?.error || 'Визуальная память пока пуста.'));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const memory of result.memories) {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'memory-row';
    const label = document.createElement('strong'); label.textContent = `${memory.pinned ? 'PIN · ' : ''}${memory.sensitivity === 'sensitive' ? 'PRIVATE · ' : ''}${memory.source_id}`;
    const date = document.createElement('span'); date.textContent = new Date(memory.captured_at).toLocaleString('ru-RU');
    const status = document.createElement('span'); status.textContent = memory.state === 'pending_sensitive_consent' ? 'Ожидает решения о хранении' : 'Сохранён';
    row.append(label, date, status);
    row.addEventListener('click', () => openMemoryDetail(memory.id));
    fragment.appendChild(row);
  }
  elements.visionMemoryList.replaceChildren(fragment);
}

async function runVisualQuery(text, intent) {
  visionBusy = true;
  renderVision();
  try {
    if (visionState.state !== 'active') {
      const start = await cloud.startVision({
        cameraSourceId: intent.target === 'screen' || elements.visionCamera.value === 'auto' ? '' : elements.visionCamera.value,
        includeCamera: intent.target !== 'screen' && elements.visionCamera.value !== '',
        includeScreens: intent.target !== 'camera',
        kind: intent.kind,
      });
      if (!start?.ok) { appendMessage('system', start?.error || 'Не удалось включить зрение.'); return; }
      renderVision(start.state);
    }
    appendMessage('system', 'Смотрю…');
    const result = await cloud.analyzeVision({ prompt: text, target: intent.target });
    if (!result?.ok) { appendMessage('system', result?.error || 'Визуальный анализ не удался.'); return; }
    appendMessage('assistant', result.answer, 'JARVIS · VISION');
    for (const sourceId of result.retentionConsentSources || []) {
      const allow = window.confirm('На кадре могут быть чувствительные данные. Сохранить этот и следующие чувствительные кадры этого источника в зашифрованной памяти до конца текущей сессии?');
      await cloud.setVisionSensitiveConsent(sourceId, allow);
    }
  } finally {
    visionBusy = false;
    renderVision();
  }
}

let quantumCore = null;

function initQuantumCore() {
  const canvas = document.getElementById('voice-core-canvas');
  const stage = document.getElementById('voice-core-stage');
  if (!canvas || !window.createQuantumCore) return;

  try {
    quantumCore = window.createQuantumCore({
      canvas: canvas,
      container: stage,
      width: stage.clientWidth || 240,
      height: 160,
      mouseTracking: true,
      autoStart: true,
      scaleFactor: 0.85,
    });
    window.__quantumCore = quantumCore;
  } catch (err) {
    console.error('[cloudChat] Failed to init QuantumCore:', err);
  }
}

function renderVoice(status) {
  const enabled = Boolean(status.enabled);
  state.voiceEnabled = enabled;
  const phase = status.phase || 'off';
  elements.voiceButton.classList.toggle('is-active', enabled);
  elements.voiceButtonLabel.textContent = enabled ? 'Выключить голос' : 'Включить голос';
  elements.voiceTitle.textContent = enabled ? (phase === 'wake' ? 'Жду «Джарвис»' : phase === 'listening' ? 'Слушаю' : 'Голосовой канал') : 'Голос выключен';
  elements.voiceDescription.textContent = enabled
    ? 'Wake word распознаётся локально. Фраза уйдёт на сервер после завершения.'
    : 'После подключения Jarvis будет ждать wake word локально.';
  elements.voiceState.textContent = status.message || (enabled ? 'Голос готов' : 'Микрофон не активен');
  if (status.type === 'error') appendMessage('system', status.message || 'Ошибка голосового канала.');

  if (quantumCore) {
    if (!enabled) {
      quantumCore.setMode('idle');
      quantumCore.setAudioLevel(0);
    } else if (phase === 'wake' || phase === 'ready') {
      quantumCore.setMode('idle');
      quantumCore.setAudioLevel(0);
    } else if (phase === 'listening') {
      quantumCore.setMode('speech');
      quantumCore.setAudioLevel(0.8);
    } else if (phase === 'transcribing' || phase === 'responding') {
      quantumCore.setMode('vortex');
    }
    if (status.type === 'error') {
      quantumCore.setMode('alert');
    }
  }
}

async function initialize() {
  initQuantumCore();

  if (!cloud) {
    appendMessage('system', 'Безопасный cloud bridge недоступен.');
    return;
  }
  cloud.onState(renderState);
  cloud.onVoiceStatus(renderVoice);
  cloud.onMessage((message) => {
    if (message.transcript) appendMessage('user', message.transcript, 'ВЫ · ГОЛОС');
    if (message.answer) {
      appendMessage('assistant', message.answer);
      if (quantumCore) {
        quantumCore.setMode('speech');
        quantumCore.setAudioLevel(0.9);
        setTimeout(() => {
          if (quantumCore && state.voiceEnabled) {
            quantumCore.setMode('idle');
            quantumCore.setAudioLevel(0);
          }
        }, 3500);
      }
    }
  });
  if (typeof cloud.onVisionState === 'function') cloud.onVisionState(renderVision);
  if (typeof cloud.onVisionSensitiveConsentRequired === 'function') {
    cloud.onVisionSensitiveConsentRequired(async (payload) => {
      for (const sourceId of payload?.sourceIds || []) {
        const allow = window.confirm('На кадре могут быть чувствительные данные. Сохранить этот и следующие чувствительные кадры этого источника в зашифрованной памяти до конца текущей сессии?');
        await cloud.setVisionSensitiveConsent(sourceId, allow);
      }
    });
  }
  const result = await cloud.getState();
  if (result && result.ok) renderState(result);
  const voice = await cloud.getVoiceState();
  if (voice && voice.ok) renderVoice(voice);
  if (typeof cloud.getVisionState === 'function') {
    const vision = await cloud.getVisionState();
    if (vision?.ok) renderVision(vision.state);
  }

  if (typeof cloud.onCoreMode === 'function') {
    cloud.onCoreMode((payload) => {
      if (quantumCore && payload && payload.mode) {
        quantumCore.setMode(payload.mode);
      }
    });
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (quantumCore) {
        if (document.hidden) quantumCore.pause();
        else quantumCore.resume();
      }
    });
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', () => {
      if (quantumCore) {
        const stage = document.getElementById('voice-core-stage');
        if (stage && stage.clientWidth > 0 && stage.clientHeight > 0) {
          quantumCore.resize(stage.clientWidth, stage.clientHeight);
        }
      }
    });
  }
}

elements.pairingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!cloud) return;
  elements.pairingError.textContent = '';
  elements.pairButton.disabled = true;
  elements.pairButton.textContent = 'Подключаю…';
  const result = await cloud.pair(elements.serverUrl.value, elements.pairingCode.value);
  elements.pairButton.disabled = false;
  elements.pairButton.textContent = 'Подключить Desktop';
  if (!result || !result.ok) {
    elements.pairingError.textContent = result && result.error ? result.error : 'Не удалось подключить Desktop.';
    return;
  }
  elements.pairingCode.value = '';
  renderState(result);
  appendMessage('system', 'Desktop подключён. История этого устройства теперь хранится в облаке.');
  elements.messageInput.focus();
});

elements.messageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = elements.messageInput.value.trim();
  if (!text || !cloud || !state.paired) return;
  appendMessage('user', text);
  elements.messageInput.value = '';
  elements.sendButton.disabled = true;
  if (quantumCore) {
    quantumCore.setMode('vortex');
  }
  try {
    const intent = typeof cloud.classifyVisualIntent === 'function' ? await cloud.classifyVisualIntent(text) : { visual: false };
    if (intent?.visual) {
      await runVisualQuery(text, intent);
      return;
    }
    const result = await cloud.sendMessage(text);
    if (!result || !result.ok) {
      appendMessage('system', result && result.error ? result.error : 'Сервер не ответил.');
      if (quantumCore) {
        quantumCore.setMode('alert');
        setTimeout(() => { if (quantumCore) quantumCore.setMode('idle'); }, 2500);
      }
      return;
    }
    appendMessage('assistant', result.answer);
    if (quantumCore) {
      quantumCore.setMode('speech');
      quantumCore.setAudioLevel(0.85);
      const duration = Math.min(8000, Math.max(3000, (result.answer || '').length * 40));
      setTimeout(() => {
        if (quantumCore) {
          quantumCore.setMode('idle');
          quantumCore.setAudioLevel(0);
        }
      }, duration);
    }
  } catch (_) {
    appendMessage('system', 'Сервер недоступен. Попробуйте ещё раз.');
    if (quantumCore) {
      quantumCore.setMode('alert');
      setTimeout(() => { if (quantumCore) quantumCore.setMode('idle'); }, 2500);
    }
  } finally {
    elements.sendButton.disabled = !state.paired;
    elements.messageInput.focus();
  }
});

elements.messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    elements.messageForm.requestSubmit();
  }
});

elements.messageInput.addEventListener('input', () => {
  elements.messageInput.style.height = 'auto';
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 150)}px`;
});

elements.voiceButton.addEventListener('click', async () => {
  if (!cloud || !state.paired) return;
  const result = state.voiceEnabled ? await cloud.stopVoice() : await cloud.startVoice();
  if (result && result.ok) renderVoice(result);
  else renderVoice({ type: 'error', message: result && result.error ? result.error : 'Голосовой режим недоступен.', enabled: false, phase: 'off' });
});

elements.visionToggle.addEventListener('click', async () => {
  if (!cloud || !state.paired || visionBusy) return;
  visionBusy = true;
  renderVision();
  try {
    if (visionState.state !== 'active') {
      const result = await cloud.startVision({
        cameraSourceId: elements.visionCamera.value === 'auto' ? '' : elements.visionCamera.value,
        includeCamera: elements.visionCamera.value !== '',
        includeScreens: elements.visionScreens.checked,
        kind: 'active',
      });
      if (!result?.ok) appendMessage('system', result?.error || 'Не удалось включить зрение.');
      else renderVision(result.state);
      return;
    }
    const prompt = elements.messageInput.value.trim() || 'Опиши, что сейчас видно, и обрати внимание на важные изменения.';
    visionBusy = false;
    await runVisualQuery(prompt, { target: 'all', kind: 'active' });
  } finally {
    visionBusy = false;
    renderVision();
  }
});

elements.visionStop.addEventListener('click', async () => {
  if (!cloud) return;
  visionBusy = true;
  renderVision();
  try {
    const result = await cloud.stopVision();
    if (result?.state) renderVision(result.state);
  } finally {
    visionBusy = false;
    renderVision({ state: 'off', startedAt: null, preview: null });
  }
});

elements.visionTimelineOpen.addEventListener('click', async () => {
  if (!cloud || !state.paired) return;
  elements.visionTimeline.showModal();
  await loadMemoryTimeline();
});
elements.visionTimelineClose.addEventListener('click', () => elements.visionTimeline.close());

setInterval(() => {
  if (visionState.state === 'active') renderVision();
}, 1000);

void initialize();
