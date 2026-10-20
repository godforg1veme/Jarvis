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
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
  showModal() { this.open = true; }
  contains(element) { return this === element || this.children.some((child) => child.contains(element)); }
  focus() { this.focused = true; }
  remove() { this.removed = true; }
  querySelector() { return null; }
}

function createRendererHarness(sendMessage, overrides = {}) {
  const ids = [
    'pairing-card', 'pairing-form', 'server-url', 'pairing-code', 'pair-button', 'pairing-error',
    'connection-dot', 'connection-label', 'device-label', 'mode-badge', 'chat-shell', 'messages',
    'pending-requests', 'empty-chat-title', 'empty-chat-description',
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
    ...overrides,
  };
  const context = vm.createContext({
    console,
    document: {
      createElement: () => new FakeElement(),
      createTextNode: (text) => Object.assign(new FakeElement(), { textContent: text }),
      createDocumentFragment: () => new FakeElement(),
      getElementById: (id) => elements[id],
    },
    window: { jarvisCloud: cloud, confirm: () => true, prompt: () => 'Исправленное описание' },
    setInterval() { return 1; },
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'cloud-chat', 'renderer.js'), 'utf8');
  vm.runInContext(source, context);
  return { elements, window: context.window };
}

const MEMORY = { id: 'memory-1', captured_at: '2026-10-16T12:00:00Z', source_id: 'camera', pinned: false };

async function memoryHarness(mutate, overrides = {}) {
  const calls = [];
  const { elements, window } = createRendererHarness(async () => ({ ok: true }), {
    async listVisionMemories() { calls.push('list'); return { ok: true, memories: [MEMORY] }; },
    async getVisionMemory() {
      calls.push('get');
      return { ok: true, memory: { ...MEMORY }, observation: { sceneSummary: 'Снимок', confidence: null }, image: { contentType: 'image/png', data: '' } };
    },
    async deleteVisionMemory(id) { calls.push(['delete', id]); return mutate(); },
    async updateVisionMemory(id, patch) { calls.push(['update', id, patch]); return mutate(); },
    ...overrides,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await elements['vision-timeline-open'].listeners.get('click')();
  await elements['vision-memory-list'].children[0].children[0].listeners.get('click')();
  const detail = elements['vision-memory-detail'];
  const actions = detail.children.find((element) => element.className === 'memory-detail-actions');
  return { elements, detail, actions, calls, window };
}

for (const corrected of [undefined, null, '', '   ', 'Описание пользователя']) {
  test(`visual memory detail and edit prompt use the saved summary (${JSON.stringify(corrected)})`, async () => {
    const expected = typeof corrected === 'string' && corrected.trim() ? corrected : 'Исходное описание';
    const { detail, actions, window } = await memoryHarness(() => ({ ok: false }), {
      async getVisionMemory() {
        return {
          ok: true, memory: { ...MEMORY, corrected_summary: corrected },
          observation: { sceneSummary: 'Исходное описание', confidence: null },
          image: { contentType: 'image/png', data: '' },
        };
      },
    });
    assert.equal(detail.children[1].textContent, expected);
    const prompts = [];
    window.prompt = (message, initial) => { prompts.push(initial); return null; };
    await actions.children[1].listeners.get('click')();
    assert.deepEqual(prompts, [expected]);
  });
}

test('visual memory correction rereads authoritative text for the title, repeated edits and reopening', async () => {
  let saved = 'Сохранённая поправка';
  const { detail, actions, elements, window, calls } = await memoryHarness(() => {
    saved = 'Поправка после обработки сервером';
    return { ok: true };
  }, {
    async getVisionMemory() {
      return {
        ok: true, memory: { ...MEMORY, corrected_summary: saved },
        observation: { sceneSummary: 'Исходное описание', confidence: null },
        image: { contentType: 'image/png', data: '' },
      };
    },
  });
  const prompts = [];
  window.prompt = (message, initial) => { prompts.push(initial); return 'Новая поправка'; };
  await actions.children[1].listeners.get('click')();
  assert.equal(calls.find(Array.isArray)[2].correctedSummary, 'Новая поправка');
  assert.equal(detail.children[1].textContent, saved);
  window.prompt = (message, initial) => { prompts.push(initial); return null; };
  await detail.children[3].children[1].listeners.get('click')();
  await elements['vision-memory-list'].children[0].children[0].listeners.get('click')();
  assert.equal(detail.children[1].textContent, saved);
  await detail.children[3].children[1].listeners.get('click')();
  assert.deepEqual(prompts, ['Сохранённая поправка', saved, saved]);
});

test('visual memory failed correction preserves saved text in the title and next edit prompt', async () => {
  const saved = 'Прежняя поправка';
  const { detail, actions, window } = await memoryHarness(() => ({ ok: false }), {
    async getVisionMemory() {
      return {
        ok: true, memory: { ...MEMORY, corrected_summary: saved },
        observation: { sceneSummary: 'Исходное описание', confidence: null },
        image: { contentType: 'image/png', data: '' },
      };
    },
  });
  const prompts = [];
  window.prompt = (message, initial) => { prompts.push(initial); return 'Несохранённая поправка'; };
  await actions.children[1].listeners.get('click')();
  assert.equal(detail.children[1].textContent, saved);
  window.prompt = (message, initial) => { prompts.push(initial); return null; };
  await actions.children[1].listeners.get('click')();
  assert.deepEqual(prompts, [saved, saved]);
  assert.ok(detail.children.includes(actions));
});

for (const action of ['delete', 'pin', 'correct']) {
  for (const failure of [403, 404, 409, 500, 'offline', 'unknown', 'missing-ack']) {
    test(`visual memory ${action} preserves usable card on ${failure}`, async () => {
      const { detail, actions, calls } = await memoryHarness(() => {
        if (failure === 'offline') throw new Error('private network details');
        if (failure === 'unknown') return undefined;
        if (failure === 'missing-ack') return {};
        return { ok: false, statusCode: failure, error: 'private network details' };
      });
      const button = actions.children[{ pin: 0, correct: 1, delete: 2 }[action]];
      await assert.doesNotReject(() => button.listeners.get('click')());
      assert.ok(detail.children.includes(actions), 'failure retains the original controls');
      assert.ok(actions.children.every((control) => !control.disabled));
      assert.equal(calls.filter((call) => call === 'get').length, 1, 'failure does not reload detail');
      assert.equal(calls.filter((call) => call === 'list').length, 1, 'failure does not refresh timeline');
      const text = detail.children.map((element) => element.textContent).join('\n');
      assert.match(text, /Не удалось|не подтвержд[её]н/);
      assert.equal(text.includes('Снимок удалён.'), false);
      assert.equal(text.includes('private network details'), false);
    });
  }

  test(`visual memory ${action} blocks repeats while pending and succeeds only after acknowledgement`, async () => {
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    const { detail, actions, calls } = await memoryHarness(() => pending);
    const button = actions.children[{ pin: 0, correct: 1, delete: 2 }[action]];
    const first = button.listeners.get('click')();
    assert.ok(actions.children.every((control) => control.disabled));
    await button.listeners.get('click')();
    assert.equal(calls.filter(Array.isArray).length, 1);
    assert.ok(detail.children.includes(actions));
    assert.equal(detail.children.some((element) => element.textContent === 'Снимок удалён.'), false);
    finish({ ok: true });
    await first;
    if (action === 'delete') assert.equal(detail.children[0].textContent, 'Снимок удалён.');
    else assert.ok(actions.children.every((control) => !control.disabled));
    if (action === 'pin') {
      assert.equal(actions.children[0].textContent, 'Открепить');
      assert.equal(calls.filter((call) => call === 'list').length, 2);
    }
    if (action === 'correct') assert.equal(calls.filter((call) => call === 'get').length, 2);
  });
}

test('visual memory failure permits an explicit retry without changing the requested pin state', async () => {
  let attempt = 0;
  const { actions, calls } = await memoryHarness(() => ({ ok: ++attempt > 1 }));
  await actions.children[0].listeners.get('click')();
  assert.equal(actions.children[0].textContent, 'Закрепить навсегда');
  await actions.children[0].listeners.get('click')();
  assert.equal(actions.children[0].textContent, 'Открепить');
  const updates = calls.filter(Array.isArray);
  assert.equal(updates.length, 2);
  assert.equal(updates.every((call) => call[1] === MEMORY.id && call[2].pinned === true), true);
});

test('visual memory correction retains usable card if its acknowledged write cannot be reread', async () => {
  let reads = 0;
  const { detail, actions, elements } = await memoryHarness(() => ({ ok: true }), {
    async getVisionMemory() {
      if (++reads > 1) throw new Error('private read failure');
      return { ok: true, memory: { ...MEMORY }, observation: { sceneSummary: 'Снимок', confidence: null }, image: { contentType: 'image/png', data: '' } };
    },
  });
  await assert.doesNotReject(() => actions.children[1].listeners.get('click')());
  assert.ok(detail.children.includes(actions));
  assert.ok(actions.children.every((control) => !control.disabled));
  assert.ok(renderedText(elements).some((text) => text.includes('Не удалось обновить карточку')));
  assert.equal(renderedText(elements).join('\n').includes('private read failure'), false);
});

for (const outcome of ['offline', 'refused']) {
  test(`visual memory acknowledged delete distinguishes ${outcome} timeline refresh from empty memory`, async () => {
    let lists = 0;
    const { detail, actions, elements } = await memoryHarness(() => ({ ok: true }), {
      async listVisionMemories() {
        if (++lists === 1) return { ok: true, memories: [MEMORY] };
        if (outcome === 'offline') throw new Error('private list failure');
        return { ok: false, error: 'private list failure' };
      },
    });
    await assert.doesNotReject(() => actions.children[2].listeners.get('click')());
    assert.equal(detail.children[0].textContent, 'Снимок удалён.');
    const listText = elements['vision-memory-list'].children[0].textContent;
    assert.match(listText, /Не удалось загрузить ленту/);
    assert.equal(listText.includes('пуста'), false);
    assert.equal(listText.includes('private list failure'), false);
  });
}

test('cloud chat always unlocks the send button when the IPC request rejects', async () => {
  const { elements } = createRendererHarness(async () => { throw new Error('network details must not be rendered'); });
  await new Promise((resolve) => setImmediate(resolve));
  elements['message-input'].value = 'Проверка';

  await elements['message-form'].listeners.get('submit')({ preventDefault() {} });

  assert.equal(elements['send-button'].disabled, false);
  assert.equal(elements['message-input'].focused, true);
  const rendered = elements.messages.children.flatMap((message) => message.children).map((element) => element.textContent);
  assert.ok(rendered.includes('Сервер недоступен. Проверьте результат отправки ниже перед новым действием.'));
  assert.equal(rendered.some((text) => String(text).includes('network details')), false);
});

const COMMAND_A = '11111111-1111-4111-8111-111111111111';
const COMMAND_B = '22222222-2222-4222-8222-222222222222';

async function submitText(elements, text) {
  elements['message-input'].value = text;
  await elements['message-form'].listeners.get('submit')({ preventDefault() {} });
}

function actionRows(elements) {
  return elements.messages.children.flatMap((message) => message.children)
    .filter((element) => element.className === 'message-actions');
}

function renderedText(elements) {
  return elements.messages.children.flatMap((message) => message.children).map((element) => element.textContent);
}

for (const decision of ['confirm', 'reject']) {
  test(`cloud chat ${decision} keeps the first card ID after a second confirmation appears`, async () => {
    const calls = [];
    const { elements } = createRendererHarness(async (text) => {
      calls.push(text);
      if (text === 'first') return { ok: true, answer: 'Первая команда', confirmation: { commandId: COMMAND_A } };
      if (text === 'second') return { ok: true, answer: 'Вторая команда', confirmation: { commandId: COMMAND_B } };
      return { ok: true, answer: 'Подтверждение не найдено, уже использовано или истекло.' };
    });
    await new Promise((resolve) => setImmediate(resolve));
    await submitText(elements, 'first');
    await submitText(elements, 'second');
    const button = actionRows(elements)[0].children[decision === 'confirm' ? 0 : 1];
    await button.listeners.get('click')();
    assert.equal(calls[2], `/${decision} ${COMMAND_A}`);
    await button.listeners.get('click')();
    assert.equal(calls.length, 3, 'a consumed card must not send another decision');
    assert.ok(renderedText(elements).includes('Подтверждение не найдено, уже использовано или истекло.'));
  });
}

test('cloud chat accepts the command callback pair without structured confirmation', async () => {
  const calls = [];
  const { elements } = createRendererHarness(async (text) => {
    calls.push(text);
    return text === 'request'
      ? { ok: true, answer: 'Команда', buttons: [[{ data: `cmd:confirm:${COMMAND_A}` }, { data: `cmd:reject:${COMMAND_A}` }]] }
      : { ok: true, answer: 'Действие отменено.' };
  });
  await new Promise((resolve) => setImmediate(resolve));
  await submitText(elements, 'request');
  await actionRows(elements)[0].children[1].listeners.get('click')();
  assert.deepEqual(calls, ['request', `/reject ${COMMAND_A}`]);
  assert.ok(renderedText(elements).includes('Действие отменено.'));
});

test('cloud chat does not turn unrelated, malformed or conflicting buttons into confirmation', async () => {
  const responses = [
    { buttons: [[{ text: 'Настройки', data: 'settings:open' }]] },
    { confirmation: { commandId: 'invalid-id' } },
    { buttons: [[{ data: `cmd:confirm:${COMMAND_A}` }]] },
    { buttons: [[{ data: `cmd:confirm:${COMMAND_A}` }, { data: `cmd:reject:${COMMAND_B}` }]] },
    { confirmation: { commandId: COMMAND_A }, buttons: [[{ data: `cmd:confirm:${COMMAND_B}` }]] },
  ];
  const { elements } = createRendererHarness(async () => ({ ok: true, answer: 'Ответ', ...responses.shift() }));
  await new Promise((resolve) => setImmediate(resolve));
  for (let index = 0; index < 5; index += 1) await submitText(elements, 'request');
  assert.equal(actionRows(elements).length, 0);
});

for (const answer of [
  'Подтверждение принято. Действие выполняется на компьютере.',
  'Команда не выполнена: ошибка доставки.',
  'Результат действия неизвестен. Я не буду запускать его повторно до сверки состояния.',
]) {
  test(`cloud chat preserves the server decision outcome: ${answer}`, async () => {
    const { elements } = createRendererHarness(async (text) => text === 'request'
      ? { ok: true, answer: 'Команда', confirmation: { commandId: COMMAND_A } }
      : { ok: true, answer });
    await new Promise((resolve) => setImmediate(resolve));
    await submitText(elements, 'request');
    await actionRows(elements)[0].children[0].listeners.get('click')();
    assert.ok(renderedText(elements).includes(answer));
  });
}

for (const failure of ['rejection', 'api-error', 'empty-response']) {
  test(`cloud chat ${failure} reports uncertainty and never replays a consumed decision`, async () => {
    const calls = [];
    const { elements } = createRendererHarness(async (text) => {
      calls.push(text);
      if (text === 'request') return { ok: true, answer: 'Команда', confirmation: { commandId: COMMAND_A } };
      if (failure === 'rejection') throw new Error('private error details');
      return failure === 'api-error' ? { ok: false, error: 'private error details' } : { ok: true };
    });
    await new Promise((resolve) => setImmediate(resolve));
    await submitText(elements, 'request');
    await submitText(elements, 'request');
    const rows = actionRows(elements);
    await rows[0].children[0].listeners.get('click')();
    await rows[0].children[0].listeners.get('click')();
    await rows[1].children[1].listeners.get('click')();
    assert.deepEqual(calls, ['request', 'request', `/confirm ${COMMAND_A}`]);
    const text = renderedText(elements).join('\n');
    assert.match(text, new RegExp(`Результат подтверждения неизвестен.* /command ${COMMAND_A}`));
    assert.equal(text.includes('private error details'), false);
    await submitText(elements, 'request');
    assert.equal(actionRows(elements).length, 2, 'a repeated response cannot recreate live decision buttons');
  });
}

test('cloud chat layout keeps the scrollable transcript and composer inside the viewport', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'cloud-chat', 'style.css'), 'utf8');
  assert.match(css, /\.main-panel\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.chat-shell\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
});

test('empty chat follows connection state and composer has a stable accessible name', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'cloud-chat', 'index.html'), 'utf8');
  assert.match(html, /id="message-input"[^>]*aria-label="Сообщение для Jarvis"/);
  const { elements, window } = createRendererHarness(async () => ({ ok: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements['empty-chat-title'].textContent, 'Я на связи');
  window.jarvisCloud.stateListener({ paired: true, connection: 'offline' });
  assert.equal(elements['empty-chat-title'].textContent, 'Нет соединения с облаком');
  window.jarvisCloud.stateListener({ paired: false, connection: 'unpaired' });
  assert.equal(elements['empty-chat-title'].textContent, 'Подключите Desktop');
});

test('unknown send offers status lookup without replaying POST; completed response keeps confirmation', async () => {
  const id = 'request-one';
  const sent = [];
  const checked = [];
  const acknowledged = [];
  const { elements } = createRendererHarness(async (text) => {
    sent.push(text);
    return { ok: false, outcome: 'unknown', clientMessageId: id, error: 'private transport detail' };
  }, {
    async listPendingRequests() { return { ok: true, requests: [{ clientMessageId: id, kind: 'text' }] }; },
    async getRequestStatus(requestId) {
      checked.push(requestId);
      return { ok: true, clientMessageId: requestId, status: 'completed', response: { answer: 'Сохранённый ответ', confirmation: { commandId: COMMAND_A } } };
    },
    async acknowledgeRequest(requestId) { acknowledged.push(requestId); return { ok: true }; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await submitText(elements, 'проверка');
  assert.equal(elements['pending-requests'].children.length, 1);
  assert.equal(renderedText(elements).join(' ').includes('private transport detail'), false);
  await elements['pending-requests'].children[0].children[1].listeners.get('click')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent, ['проверка']);
  assert.deepEqual(checked, [id]);
  assert.deepEqual(acknowledged, [id]);
  assert.ok(renderedText(elements).includes('Сохранённый ответ'));
  assert.equal(actionRows(elements).length, 1);
  assert.equal(elements['pending-requests'].children.length, 0);
});

test('processing, failed and missing results stay visible; lookup failure preserves the row', async () => {
  const id = 'request-two';
  const statuses = ['processing', 'failed', 'not_found'];
  const { elements } = createRendererHarness(async () => ({ ok: true }), {
    async listPendingRequests() { return { ok: true, requests: [{ clientMessageId: id, kind: 'voice' }] }; },
    async getRequestStatus() { return { ok: true, clientMessageId: id, status: statuses.shift() }; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  for (const phrase of ['обрабатывает', 'ошибке', 'не нашёл']) {
    await elements['pending-requests'].children[0].children[1].listeners.get('click')();
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(elements['pending-requests'].children[0].children[0].textContent, new RegExp(phrase));
  }
  assert.equal(elements['pending-requests'].children.length, 1);
});

test('failed status lookup keeps its prior status and request metadata visible', async () => {
  const id = 'request-four';
  let fail = false;
  const { elements } = createRendererHarness(async () => ({ ok: true }), {
    async listPendingRequests() { return { ok: true, requests: [{ clientMessageId: id, kind: 'text' }] }; },
    async getRequestStatus() {
      if (fail) throw new Error('private status detail');
      return { ok: true, clientMessageId: id, status: 'processing' };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await elements['pending-requests'].children[0].children[1].listeners.get('click')();
  await new Promise((resolve) => setImmediate(resolve));
  fail = true;
  await elements['pending-requests'].children[0].children[1].listeners.get('click')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(elements['pending-requests'].children[0].children[0].textContent, /обрабатывает/);
  assert.equal(elements['pending-requests'].children.length, 1);
});

test('concurrent checks are single-flight and failed acknowledgement never duplicates recovered answer', async () => {
  const id = 'request-three';
  let release;
  let lookups = 0;
  const { elements } = createRendererHarness(async () => ({ ok: true }), {
    async listPendingRequests() { return { ok: true, requests: [{ clientMessageId: id, kind: 'text' }] }; },
    async getRequestStatus() {
      lookups += 1;
      if (lookups === 1) await new Promise((resolve) => { release = resolve; });
      return { ok: true, clientMessageId: id, status: 'completed', response: { answer: 'Один ответ' } };
    },
    async acknowledgeRequest() { return { ok: false }; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const first = elements['pending-requests'].children[0].children[1].listeners.get('click')();
  await elements['pending-requests'].children[0].children[1].listeners.get('click')();
  assert.equal(lookups, 1);
  release();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  await elements['pending-requests'].children[0].children[1].listeners.get('click')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lookups, 2);
  assert.equal(renderedText(elements).filter((value) => value === 'Один ответ').length, 1);
  assert.equal(elements['pending-requests'].children.length, 1);
});

test('normal text delivery acknowledges only after its answer and confirmation are rendered', async () => {
  const id = 'normal-text';
  let displayedAtAck = false;
  let confirmationAtAck = false;
  const { elements } = createRendererHarness(async () => ({ ok: true, clientMessageId: id, answer: 'Нужна проверка', confirmation: { commandId: COMMAND_A } }), {
    async acknowledgeRequest(requestId) {
      assert.equal(requestId, id);
      displayedAtAck = renderedText(elements).includes('Нужна проверка');
      confirmationAtAck = actionRows(elements).length === 1;
      return { ok: true };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await submitText(elements, 'действие');
  assert.equal(displayedAtAck, true);
  assert.equal(confirmationAtAck, true);
});

test('failed acknowledgement after normal delivery leaves one visible answer for status recovery', async () => {
  const id = 'normal-unacked';
  const { elements } = createRendererHarness(async () => ({ ok: true, clientMessageId: id, answer: 'Ответ доставлен' }), {
    async listPendingRequests() { return { ok: true, requests: [{ clientMessageId: id, kind: 'text' }] }; },
    async acknowledgeRequest() { return { ok: false }; },
    async getRequestStatus() { return { ok: true, clientMessageId: id, status: 'completed', response: { answer: 'Ответ доставлен' } }; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await submitText(elements, 'запрос');
  assert.equal(elements['pending-requests'].children.length, 1);
  await elements['pending-requests'].children[0].children[1].listeners.get('click')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renderedText(elements).filter((value) => value === 'Ответ доставлен').length, 1);
});

test('scope change discards a stale in-flight status response and list', async () => {
  let releaseStatus;
  let releaseList;
  const id = 'old-scope';
  let delayList = false;
  let switched = false;
  const { elements, window } = createRendererHarness(async () => ({ ok: true }), {
    async listPendingRequests() {
      if (delayList) { delayList = false; return new Promise((resolve) => { releaseList = resolve; }); }
      return { ok: true, requests: switched ? [] : [{ clientMessageId: id, kind: 'text' }] };
    },
    async getRequestStatus() { return new Promise((resolve) => { releaseStatus = resolve; }); },
  });
  await new Promise((resolve) => setImmediate(resolve));
  delayList = true;
  window.jarvisCloud.voiceListener({ type: 'error', enabled: false, phase: 'off' });
  elements['pending-requests'].children[0].children[1].listeners.get('click')();
  switched = true;
  window.jarvisCloud.stateListener({ paired: true, serverUrl: 'other-server', deviceId: 'other-device' });
  releaseStatus({ ok: true, clientMessageId: id, status: 'completed', response: { answer: 'Старый ответ' } });
  releaseList({ ok: true, requests: [{ clientMessageId: id, kind: 'text' }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements['pending-requests'].children.length, 0);
  assert.equal(renderedText(elements).includes('Старый ответ'), false);
});

test('voice delivery acknowledges after display; voice error refreshes pending results', async () => {
  const id = 'voice-message';
  let listed = 0;
  let displayedAtAck = false;
  const { elements, window } = createRendererHarness(async () => ({ ok: true }), {
    async listPendingRequests() { listed += 1; return { ok: true, requests: [] }; },
    async acknowledgeRequest() { displayedAtAck = renderedText(elements).includes('Голосовой ответ'); return { ok: true }; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await window.jarvisCloud.messageListener({ answer: 'Голосовой ответ', clientMessageId: id });
  assert.equal(displayedAtAck, true);
  window.jarvisCloud.voiceListener({ type: 'error', enabled: false, phase: 'off' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(listed >= 2);
});

test('ordinary delayed response and scoped voice event are not shown after changing devices', async () => {
  let resolveSend;
  const { elements, window } = createRendererHarness(() => new Promise((resolve) => { resolveSend = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  const sending = submitText(elements, 'Привет');
  await new Promise((resolve) => setImmediate(resolve));
  window.jarvisCloud.stateListener({ paired: true, serverUrl: 'https://other.test', deviceId: 'other' });
  resolveSend({ ok: true, answer: 'Старый текстовый ответ', clientMessageId: 'old' });
  await sending;
  await window.jarvisCloud.messageListener({ answer: 'Старый голосовой ответ', requestScope: {
    serverUrl: 'https://old.test', deviceId: 'old',
  } });
  assert.equal(renderedText(elements).includes('Старый текстовый ответ'), false);
  assert.equal(renderedText(elements).includes('Старый голосовой ответ'), false);
});

test('a delayed pending list cannot resurrect an acknowledged request in the same scope', async () => {
  let delayNext = false;
  let releaseList;
  const request = { clientMessageId: 'original-id', kind: 'text' };
  const { elements, window } = createRendererHarness(async () => ({ ok: true }), {
    async listPendingRequests() {
      if (delayNext) return new Promise((resolve) => { releaseList = resolve; });
      return { ok: true, requests: [request] };
    },
    async getRequestStatus() { return { ok: true, clientMessageId: request.clientMessageId,
      status: 'completed', response: { answer: 'Готово' } }; },
    async acknowledgeRequest() { return { ok: true }; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  delayNext = true;
  window.jarvisCloud.voiceListener({ type: 'error', enabled: false, phase: 'off' });
  await new Promise((resolve) => setImmediate(resolve));
  await elements['pending-requests'].children[0].children[1].listeners.get('click')();
  await new Promise((resolve) => setImmediate(resolve));
  releaseList({ ok: true, requests: [request] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements['pending-requests'].children.length, 0);
});
