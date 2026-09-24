const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.classList = { toggle() {} };
  }

  set innerHTML(value) {
    this.children = [];
    this._innerHTML = value;
  }

  get innerHTML() {
    return this._innerHTML || '';
  }

  get lastChild() {
    return this.children[this.children.length - 1];
  }

  appendChild(child) {
    this.children.push(child);
    this.scrollHeight = this.children.length;
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  addEventListener(name, handler) {
    this.listeners.set(name, handler);
  }
}

function run() {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, new FakeElement());
    return elements.get(id);
  };
  const phases = ['created', 'observing', 'planning', 'needs_input', 'needs_confirmation', 'executing', 'finalized', 'failed']
    .map((phase) => {
      const element = new FakeElement();
      element.setAttribute('data-phase', phase);
      return element;
    });

  let eventHandler = null;
  const context = {
    console,
    document: {
      getElementById: getElement,
      createElement: (tagName) => new FakeElement(tagName),
      querySelectorAll: (selector) => selector === '.phase' ? phases : [],
    },
    window: {
      jarvisAgentTask: {
        onEvent(handler) {
          eventHandler = handler;
        },
        sendAction() {},
      },
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'agent-task', 'renderer.js'), 'utf8');
  vm.runInNewContext(source, context, { filename: 'renderer/agent-task/renderer.js' });
  assert.strictEqual(typeof eventHandler, 'function');

  eventHandler({
    task_id: 'task-one',
    type: 'plan_draft',
    payload: {
      plan: [{ id: 'step-1', title: 'Первый план', args: { path: 'C:\\large\\payload.png' } }],
      state: { task_id: 'task-one', user_command: 'Первая задача', phase: 'planning', plan: [] },
    },
  });
  eventHandler({ task_id: 'task-one', type: 'error', payload: { error: 'Старая ошибка' } });

  eventHandler({ task_id: 'task-two', type: 'phase_changed', payload: { phase: 'observing' } });
  const eventList = getElement('event-list');
  assert.strictEqual(eventList.children.length, 1, 'new task must clear prior timeline events');
  assert.strictEqual(eventList.children[0].lastChild.textContent, 'observing');
  assert.strictEqual(getElement('task-command').textContent, 'Ожидаю описание задачи');

  eventHandler({
    task_id: 'task-two',
    type: 'plan_draft',
    payload: {
      plan: [{ id: 'step-2', title: 'Новый план', args: { path: 'C:\\secret\\very-long-name.png' } }],
      state: { task_id: 'task-two', user_command: 'Вторая задача', phase: 'planning', plan: [] },
    },
  });
  const latestMessage = eventList.children[eventList.children.length - 1].lastChild.textContent;
  assert.strictEqual(latestMessage, 'План подготовлен: 1 шагов.');
  assert(!latestMessage.includes('secret'), 'timeline must not dump raw plan payloads');

  console.log('[testAgentTaskRendererBehavior] task reset and compact timeline passed');
}

run();
