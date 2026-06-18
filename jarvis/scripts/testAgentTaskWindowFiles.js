const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function run() {
  const html = read('renderer/agent-task/index.html');
  const css = read('renderer/agent-task/style.css');
  const js = read('renderer/agent-task/renderer.js');
  const preload = read('agents/agentTaskPreload.js');
  const windowModule = read('agents/agentTaskWindow.js');

  assert(html.includes('Desktop Agent'));
  assert(html.includes('Live process'));
  assert(html.includes('Plan draft'));
  assert(html.includes('reject-btn'));
  assert(css.includes('grid-template-columns: 190px'));
  assert(css.includes('.limits'));
  assert(js.includes('needs_input'));
  assert(js.includes('needs_confirmation'));
  assert(js.includes('requires_strong_confirmation'));
  assert(js.includes('strong_confirm'));
  assert(preload.includes('jarvisAgentTask'));
  assert(windowModule.includes('showInactive'));

  console.log('[testAgentTaskWindowFiles] agent task window files passed');
}

run();
