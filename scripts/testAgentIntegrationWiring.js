const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function run() {
  const preload = read('preload.js');
  const main = read('main.js');
  const renderer = read('renderer/renderer.js');

  assert(preload.includes('startAgentTask'));
  assert(main.includes("ipcMain.handle('agent-start-task'"));
  assert(main.includes("ipcMain.handle('agent-task-action'"));
  assert(main.includes("action === 'disable_steps'"));
  assert(main.includes('handleStartAgentTask'));
  assert(main.includes('sanitizeAgentInitialContext'));
  assert(main.includes('Автоматическая эскалация'));
  assert(main.includes('initialContext'));
  assert(main.includes('handleAgentTaskEvent'));
  assert(main.includes('handleAgentVoiceAction'));
  assert(main.includes('isAgentTaskWindowVisible'));
  assert(renderer.includes("trimmed.startsWith('/agent ')"));
  assert(renderer.includes("toolName === 'agent'"));
  assert(renderer.includes('window.jarvis.startAgentTask'));

  console.log('[testAgentIntegrationWiring] agent integration wiring passed');
}

run();
