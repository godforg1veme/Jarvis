const { ipcMain } = require('electron');

/**
 * Legacy voice IPC compatibility layer.
 * Now delegates all voice lifecycle to VoiceService.
 * Kept for backward compatibility with the UI.
 */
function setupVoiceIpc(mainWindow, voiceService) {
  // If voiceService is provided, the old IPC handlers are overridden by VoiceService
  // We only keep this for setting up the UI listeners if no voiceService is used
  if (voiceService) {
    // VoiceService already registered all necessary handlers.
    // This function is kept as a no-op for backward compatibility.
    return;
  }

  // Legacy mode (no VoiceService — shouldn't happen, but keep for safety)
  console.warn('[voiceIpc] setupVoiceIpc called without voiceService — legacy mode');
}

module.exports = { setupVoiceIpc };