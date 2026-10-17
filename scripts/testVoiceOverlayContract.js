const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createClassList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
  };
}

const wrapper = { classList: createClassList(['hidden']) };
const container = { classList: createClassList(['is-empty']) };
const textBox = { innerText: '' };
const callbacks = {};
const timers = new Map();
let nextTimerId = 0;
const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'voice-overlay.js'), 'utf8');

vm.runInNewContext(source, {
  document: {
    readyState: 'complete',
    getElementById(id) {
      if (id === 'overlay-wrapper') return wrapper;
      if (id === 'overlay-container') return container;
      if (id === 'voice-text') return textBox;
      if (id === 'quantum-core-canvas' || id === 'core-stage') return null;
      throw new Error(`unexpected element id: ${id}`);
    },
  },
  window: {
    jarvisVoice: {
      onPartial: (callback) => { callbacks.partial = callback; },
      onStatus: (callback) => { callbacks.status = callback; },
    },
  },
  setTimeout: (callback, delay) => {
    const id = ++nextTimerId;
    timers.set(id, { callback, delay });
    return id;
  },
  clearTimeout: (id) => timers.delete(id),
});

callbacks.partial({ text: 'частичная команда' });
assert.strictEqual(textBox.innerText, 'частичная команда');
assert.strictEqual(wrapper.classList.contains('hidden'), false);
assert.strictEqual(container.classList.contains('is-empty'), false);

callbacks.status({ type: 'stopped', message: 'Voice worker stopped.' });
assert.strictEqual(wrapper.classList.contains('hidden'), false, 'terminal result remains visible briefly');
assert.strictEqual(timers.size, 1, 'terminal status replaces the previous hide timer');
const terminalTimer = [...timers.values()][0];
assert.strictEqual(terminalTimer.delay, 1800);
terminalTimer.callback();
assert.strictEqual(wrapper.classList.contains('hidden'), true);

wrapper.classList.remove('hidden');
timers.clear();
callbacks.status({ status: 'stopped' });
assert.strictEqual(wrapper.classList.contains('hidden'), false, 'legacy status field must not drive the current contract');
assert.strictEqual(timers.size, 0, 'legacy status must not schedule a transition');

console.log('[testVoiceOverlayContract] overlay status contract passed');
