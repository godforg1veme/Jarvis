const path = require('path');
const { BrowserWindow } = require('electron');

let agentTaskWindow = null;

function createAgentTaskWindow(options = {}) {
  if (agentTaskWindow && !agentTaskWindow.isDestroyed()) {
    return agentTaskWindow;
  }

  agentTaskWindow = new BrowserWindow({
    width: options.width || 1040,
    height: options.height || 680,
    minWidth: 860,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'agentTaskPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  agentTaskWindow.loadFile(path.join(__dirname, '..', 'renderer', 'agent-task', 'index.html'));
  agentTaskWindow.on('closed', () => {
    agentTaskWindow = null;
  });

  return agentTaskWindow;
}

function showAgentTaskWindow(options = {}) {
  const win = createAgentTaskWindow(options);
  if (options.noFocus && typeof win.showInactive === 'function') {
    win.showInactive();
  } else {
    win.show();
    if (!options.noFocus) win.focus();
  }
  return win;
}

function sendAgentTaskEvent(event) {
  if (!agentTaskWindow || agentTaskWindow.isDestroyed()) return;
  agentTaskWindow.webContents.send('agent-task-event', event);
}

function closeAgentTaskWindow() {
  if (agentTaskWindow && !agentTaskWindow.isDestroyed()) {
    agentTaskWindow.close();
  }
}

function getAgentTaskWindow() {
  return agentTaskWindow && !agentTaskWindow.isDestroyed() ? agentTaskWindow : null;
}

module.exports = {
  createAgentTaskWindow,
  showAgentTaskWindow,
  sendAgentTaskEvent,
  closeAgentTaskWindow,
  getAgentTaskWindow,
};
