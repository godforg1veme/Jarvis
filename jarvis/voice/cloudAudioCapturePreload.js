const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisAudioCapture', {
  sendPcm: (arrayBuffer) => ipcRenderer.send('cloud-voice:audio-capture-pcm', arrayBuffer),
  sendError: (message) => ipcRenderer.send('cloud-voice:audio-capture-error', message),
  onCommand: (callback) => {
    ipcRenderer.on('cloud-voice:audio-capture-command', (_event, command) => callback(command));
  },
});
