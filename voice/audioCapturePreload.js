const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisAudioCapture', {
  sendPcm: (arrayBuffer) => ipcRenderer.send('voice:audio-capture-pcm', arrayBuffer),
  sendError: (message) => ipcRenderer.send('voice:audio-capture-error', message),
  onCommand: (callback) => {
    ipcRenderer.on('voice:audio-capture-command', (_event, command) => callback(command));
  },
});
