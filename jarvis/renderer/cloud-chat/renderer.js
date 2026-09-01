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
};

let state = { paired: false, connection: 'unpaired', voiceEnabled: false };

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
  if (paired && state.serverUrl) elements.serverUrl.value = state.serverUrl;
  if (!paired && !elements.serverUrl.value && state.defaultServerUrl) elements.serverUrl.value = state.defaultServerUrl;
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
}

async function initialize() {
  if (!cloud) {
    appendMessage('system', 'Безопасный cloud bridge недоступен.');
    return;
  }
  cloud.onState(renderState);
  cloud.onVoiceStatus(renderVoice);
  cloud.onMessage((message) => {
    if (message.transcript) appendMessage('user', message.transcript, 'ВЫ · ГОЛОС');
    if (message.answer) appendMessage('assistant', message.answer);
  });
  const result = await cloud.getState();
  if (result && result.ok) renderState(result);
  const voice = await cloud.getVoiceState();
  if (voice && voice.ok) renderVoice(voice);
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
  const result = await cloud.sendMessage(text);
  elements.sendButton.disabled = false;
  if (!result || !result.ok) {
    appendMessage('system', result && result.error ? result.error : 'Сервер не ответил.');
    return;
  }
  appendMessage('assistant', result.answer);
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

void initialize();
