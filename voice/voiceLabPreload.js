const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisVoiceLab', {
  getState: () => ipcRenderer.invoke('voice-lab:get-state'),
  setPreview: (settings) => ipcRenderer.invoke('voice-lab:set-preview', { settings }),
  startCalibration: () => ipcRenderer.invoke('voice-lab:start-calibration'),
  nextCalibration: () => ipcRenderer.invoke('voice-lab:next-calibration'),
  finishCalibration: () => ipcRenderer.invoke('voice-lab:finish-calibration'),
  startTest: () => ipcRenderer.invoke('voice-lab:start-test'),
  finishTest: () => ipcRenderer.invoke('voice-lab:finish-test'),
  saveProfile: (payload) => ipcRenderer.invoke('voice-lab:save-profile', payload),
  revertPreview: () => ipcRenderer.invoke('voice-lab:revert-preview'),
  requestGeminiAnalysis: (payload) => ipcRenderer.invoke('voice-lab:gemini-analysis', payload),
  close: () => ipcRenderer.invoke('voice-lab:close'),
  onEvent: (callback) => ipcRenderer.on('voice-lab:event', (_event, payload) => callback(payload)),
});
