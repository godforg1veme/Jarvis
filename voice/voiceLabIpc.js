const { ipcMain } = require('electron');

function setupVoiceLabIpc(controller, { isAllowedSender = () => true } = {}) {
  if (!controller) throw new Error('Voice Lab controller is required.');

  const invoke = (handler) => async (event, payload = {}) => {
    if (!isAllowedSender(event)) return { ok: false, error: 'Voice Lab access denied.' };
    try {
      return await handler(payload);
    } catch (error) {
      return { ok: false, error: error.message || 'Voice Lab operation failed.' };
    }
  };

  ipcMain.handle('voice-lab:get-state', invoke(() => ({ ok: true, state: controller.getState() })));
  ipcMain.handle('voice-lab:set-preview', invoke(({ settings } = {}) => controller.setPreviewSettings(settings)));
  ipcMain.handle('voice-lab:start-calibration', invoke(() => controller.startCalibration()));
  ipcMain.handle('voice-lab:next-calibration', invoke(() => controller.nextCalibrationStep()));
  ipcMain.handle('voice-lab:finish-calibration', invoke(() => controller.finishCalibration()));
  ipcMain.handle('voice-lab:start-test', invoke(() => controller.startPreviewTest()));
  ipcMain.handle('voice-lab:finish-test', invoke(() => controller.finishPreviewTest()));
  ipcMain.handle('voice-lab:save-profile', invoke((payload) => controller.saveProfile(payload)));
  ipcMain.handle('voice-lab:revert-preview', invoke(() => controller.revertPreview()));
  ipcMain.handle('voice-lab:gemini-analysis', invoke((payload) => controller.requestGeminiAnalysis(payload)));
}

module.exports = { setupVoiceLabIpc };
