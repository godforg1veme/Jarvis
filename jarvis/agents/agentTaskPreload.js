const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisAgentTask', {
  sendAction: (action, payload = {}) => ipcRenderer.invoke('agent-task-action', { action, payload }),
  onEvent: (callback) => ipcRenderer.on('agent-task-event', (_event, payload) => callback(payload)),
});
