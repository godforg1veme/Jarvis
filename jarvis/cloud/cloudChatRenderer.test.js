const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.children = [];
    this.disabled = false;
    this.listeners = new Map();
    this.style = {};
    this.textContent = '';
    this.value = '';
    this.classList = { add() {}, remove() {}, toggle() {} };
  }

  addEventListener(type, listener) { this.listeners.set(type, listener); }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
  focus() { this.focused = true; }
  querySelector() { return null; }
}

function createRendererHarness(sendMessage) {
  const ids = [
    'pairing-card', 'pairing-form', 'server-url', 'pairing-code', 'pair-button', 'pairing-error',
    'connection-dot', 'connection-label', 'device-label', 'mode-badge', 'chat-shell', 'messages',
    'message-form', 'message-input', 'send-button', 'voice-toggle', 'voice-button-label',
    'voice-title', 'voice-description', 'voice-state',
    'vision-title', 'vision-indicator', 'vision-preview', 'vision-camera', 'vision-screens',
    'vision-toggle', 'vision-stop', 'vision-state', 'vision-timer', 'vision-timeline-open',
    'vision-timeline', 'vision-timeline-close', 'vision-memory-list', 'vision-memory-detail',
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement(id)]));
  const cloud = {
    onState(listener) { this.stateListener = listener; },
    onVoiceStatus(listener) { this.voiceListener = listener; },
    onMessage(listener) { this.messageListener = listener; },
    async getState() { return { ok: true, paired: true, connection: 'online' }; },
    async getVoiceState() { return { ok: true, enabled: false, phase: 'off' }; },
    sendMessage,
  };
  const context = vm.createContext({
    console,
    document: {
      createElement: () => new FakeElement(),
      getElementById: (id) => elements[id],
    },
    window: { jarvisCloud: cloud },
    setInterval() { return 1; },
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'cloud-chat', 'renderer.js'), 'utf8');
  vm.runInContext(source, context);
  return { elements };
}

test('cloud chat always unlocks the send button when the IPC request rejects', async () => {
  const { elements } = createRendererHarness(async () => { throw new Error('network details must not be rendered'); });
  await new Promise((resolve) => setImmediate(resolve));
  elements['message-input'].value = 'Проверка';

  await elements['message-form'].listeners.get('submit')({ preventDefault() {} });

  assert.equal(elements['send-button'].disabled, false);
  assert.equal(elements['message-input'].focused, true);
  const rendered = elements.messages.children.flatMap((message) => message.children).map((element) => element.textContent);
  assert.ok(rendered.includes('Сервер недоступен. Попробуйте ещё раз.'));
  assert.equal(rendered.some((text) => String(text).includes('network details')), false);
});

test('cloud chat layout keeps the scrollable transcript and composer inside the viewport', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'cloud-chat', 'style.css'), 'utf8');
  assert.match(css, /\.main-panel\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.chat-shell\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
});
