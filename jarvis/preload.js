const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  // Execute a tool (run, powershell, find, sys)
  executeTool: (tool, args) => ipcRenderer.invoke('execute-tool', { tool, args }),

  // Launch a candidate app directly from the selection UI
  launchSelectedApp: (candidateId) => ipcRenderer.invoke('launch-selected-app', { candidateId }),
  selectAppRecovery: (recoveryId, candidateId) => ipcRenderer.invoke('app-recovery-select', { recoveryId, candidateId }),
  confirmAppRecovery: (recoveryId) => ipcRenderer.invoke('app-recovery-confirm', { recoveryId }),
  cancelAppRecovery: (recoveryId) => ipcRenderer.invoke('app-recovery-cancel', { recoveryId }),
  getAppRecoveryDetails: (recoveryId, candidateId) => ipcRenderer.invoke('app-recovery-details', { recoveryId, candidateId }),
  onAppRecoveryState: (callback) => ipcRenderer.on('app-recovery-state', (_event, snapshot) => callback(snapshot)),

  // Confirm dangerous command
  confirmCommand: (tool, args) => ipcRenderer.invoke('confirm-command', { tool, args }),

  // History
  getHistory: () => ipcRenderer.invoke('get-history'),
  saveHistory: (entry) => ipcRenderer.invoke('save-history', entry),

  // Apps
  getApps: () => ipcRenderer.invoke('get-apps'),
  refreshApps: () => ipcRenderer.invoke('refresh-apps'),
  addApp: (args) => ipcRenderer.invoke('add-app', args),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  addScanRoot: (path) => ipcRenderer.invoke('add-scan-root', { path }),
  openVoiceLab: () => ipcRenderer.invoke('voice-lab:open'),

  // Hide window (after app launch)
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  hideTranscriptionBar: () => ipcRenderer.invoke('hide-transcription-bar'),
  translateSelected: () => ipcRenderer.invoke('translate-selected'),
  analyzeVisualArea: (command) => ipcRenderer.invoke('visual-analyze', { command }),
  continueVisualDialog: (command) => ipcRenderer.invoke('visual-continue', { command }),
  clearVisualContext: () => ipcRenderer.invoke('visual-clear-context'),
  startAgentTask: (command, options = {}) => ipcRenderer.invoke('agent-start-task', { command, options }),

  // Focus input listener from main process
  onFocusInput: (callback) => ipcRenderer.on('focus-input', (_event, ...args) => callback(...args)),

  // Index status listener
  onIndexStatus: (callback) => ipcRenderer.on('index-status', (_event, data) => callback(data)),

  // 3D Quantum Core mode listener
  onCoreMode: (callback) => ipcRenderer.on('jarvis:core-mode', (_event, payload) => callback(payload)),

  // 3D Holographic Desktop Companion Widget APIs
  toggleHologramWidget: (visible) => ipcRenderer.invoke('hologram-widget:toggle', { visible }),
  setHologramPin: (pinned) => ipcRenderer.invoke('hologram-widget:set-pin', { pinned }),
  moveHologramWindow: (dx, dy) => ipcRenderer.send('hologram-widget:move', { dx, dy }),
  showMainWindow: () => ipcRenderer.invoke('show-main-window'),
});

// Voice API
contextBridge.exposeInMainWorld("jarvisVoice", {
  start: () => ipcRenderer.invoke("voice:start"),
  stop: () => ipcRenderer.invoke("voice:stop"),
  getState: () => ipcRenderer.invoke("voice:state"),
  sendPcm: (arrayBuffer) => ipcRenderer.send("voice:pcm", arrayBuffer),
  onStatus: (callback) => {
    ipcRenderer.on("voice:status", (_event, payload) => callback(payload));
  },
  onPartial: (callback) => {
    ipcRenderer.on("voice:partial", (_event, payload) => callback(payload));
  },
  onAutoStart: (callback) => {
    ipcRenderer.on("voice:auto-start", (_event) => callback());
  },
});
