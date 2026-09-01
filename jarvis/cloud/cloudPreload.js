const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisCloud', {
  getState: () => ipcRenderer.invoke('cloud:get-state'),
  pair: (serverUrl, pairingCode) => ipcRenderer.invoke('cloud:pair', { serverUrl, pairingCode }),
  sendMessage: (text) => ipcRenderer.invoke('cloud:send-message', { text }),
  startVoice: () => ipcRenderer.invoke('cloud-voice:start'),
  stopVoice: () => ipcRenderer.invoke('cloud-voice:stop'),
  getVoiceState: () => ipcRenderer.invoke('cloud-voice:state'),
  onState: (callback) => ipcRenderer.on('cloud:state', (_event, state) => callback(state)),
  onVoiceStatus: (callback) => ipcRenderer.on('cloud:voice-status', (_event, state) => callback(state)),
  onMessage: (callback) => ipcRenderer.on('cloud:message', (_event, message) => callback(message)),
});
