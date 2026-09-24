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

const container = { classList: createClassList(['hidden']) };
const textBox = { innerText: '' };
const callbacks = {};
const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'voice-overlay.js'), 'utf8');

vm.runInNewContext(source, {
  document: {
    getElementById(id) {
      if (id === 'overlay-container') return container;
      if (id === 'voice-text') return textBox;
      throw new Error(`unexpected element id: ${id}`);
    },
  },
  window: {
    jarvisVoice: {
      onPartial: (callback) => { callbacks.partial = callback; },
      onStatus: (callback) => { callbacks.status = callback; },
    },
  },
  setTimeout: () => 1,
  clearTimeout: () => {},
});

callbacks.partial({ text: 'частичная команда' });
assert.strictEqual(textBox.innerText, 'частичная команда');
assert.strictEqual(container.classList.contains('hidden'), false);

callbacks.status({ type: 'stopped', message: 'Voice worker stopped.' });
assert.strictEqual(container.classList.contains('hidden'), true);

container.classList.remove('hidden');
callbacks.status({ status: 'stopped' });
assert.strictEqual(container.classList.contains('hidden'), false, 'legacy status field must not drive the current contract');

console.log('[testVoiceOverlayContract] overlay status contract passed');
