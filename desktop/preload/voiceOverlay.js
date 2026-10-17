const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  onCoreMode: callback => ipcRenderer.on('jarvis:core-mode', (_event, payload) => callback(payload)),
});
contextBridge.exposeInMainWorld('jarvisVoice', {
  onPartial: callback => ipcRenderer.on('voice:partial', (_event, payload) => callback(payload)),
  onStatus: callback => ipcRenderer.on('voice:status', (_event, payload) => callback(payload)),
});
