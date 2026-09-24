const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisVisionCapture', {
  onCommand(callback) {
    ipcRenderer.on('vision:capture:command', (_event, payload) => callback(payload));
  },
  sendResult(payload) {
    ipcRenderer.send('vision:capture:result', payload);
  },
});

