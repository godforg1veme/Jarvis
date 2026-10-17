const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  onCoreMode: callback => ipcRenderer.on('jarvis:core-mode', (_event, payload) => callback(payload)),
  toggleHologramWidget: visible => ipcRenderer.invoke('hologram-widget:toggle', { visible }),
  setHologramPin: pinned => ipcRenderer.invoke('hologram-widget:set-pin', { pinned }),
  moveHologramWindow: (dx, dy) => ipcRenderer.send('hologram-widget:move', { dx, dy }),
  showMainWindow: () => ipcRenderer.invoke('show-main-window'),
});
