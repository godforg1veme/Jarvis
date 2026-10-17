const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  hideTranscriptionBar: () => ipcRenderer.invoke('hide-transcription-bar'),
});
contextBridge.exposeInMainWorld('jarvisVoice', {
  getState: () => ipcRenderer.invoke('voice:state'),
  onPartial: callback => ipcRenderer.on('voice:partial', (_event, payload) => callback(payload)),
  onStatus: callback => ipcRenderer.on('voice:status', (_event, payload) => callback(payload)),
});
