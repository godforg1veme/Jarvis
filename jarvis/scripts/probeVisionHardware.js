const electron = require('electron');
if (typeof electron === 'string') {
  console.error(JSON.stringify({ error: 'Run this hardware probe with Electron: npx electron scripts/probeVisionHardware.js' }));
  process.exit(1);
}
const { app, BrowserWindow, desktopCapturer, ipcMain, nativeImage, screen, session } = electron;
const { CameraCaptureController } = require('../vision/cameraCaptureController');
const { ScreenCaptureController } = require('../vision/screenCaptureController');
const { VisualSourceRegistry } = require('../vision/visualSourceRegistry');
const { allowCaptureMedia } = require('../vision/mediaPermissionPolicy');
const fs = require('node:fs/promises');
const report = {};

(async () => {
  await app.whenReady();
  const registry = new VisualSourceRegistry();
  const camera = new CameraCaptureController({ BrowserWindow, ipcMain, sourceRegistry: registry });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
    callback(allowCaptureMedia({
      requestingWebContentsId: webContents.id, permission, mediaTypes: details.mediaTypes,
      visionWebContentsId: camera.window && !camera.window.isDestroyed() ? camera.window.webContents.id : null,
    }));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details = {}) => allowCaptureMedia({
    requestingWebContentsId: webContents.id, permission, mediaTypes: details.mediaTypes,
    visionWebContentsId: camera.window && !camera.window.isDestroyed() ? camera.window.webContents.id : null,
  }));
  const screens = new ScreenCaptureController({ desktopCapturer, screen, nativeImage, sourceRegistry: registry, composeWorkspace: (frames, options) => camera.composeWorkspace(frames, options) });
  try {
    const cameras = await camera.listCameras({ requestPermission: true });
    const displays = screens.listDisplays();
    report.cameras = cameras.map((item) => ({ sourceId: item.sourceId, label: item.label || 'Unlabelled camera' }));
    report.displays = displays.map((item) => ({ sourceId: item.sourceId, displayIndex: item.displayIndex }));
    if (cameras.length) {
      const selected = cameras.find((item) => /camo/iu.test(item.label)) || cameras[0];
      await camera.start(selected.sourceId);
      const frame = await camera.capture({ maxWidth: 1280, maxHeight: 720, quality: .75 });
      report.cameraCapture = { label: selected.label || 'Unlabelled camera', width: frame.width, height: frame.height, byteLength: frame.bytes.length };
      await camera.stop();
    }
    if (displays.length) {
      const frame = await screens.captureWorkspace(displays.map((item) => item.sourceId), { workspaceSourceId: 'hardware-probe', tileWidth: 720, jpegQuality: 70 });
      report.workspaceCapture = { displayCount: displays.length, width: frame.width, height: frame.height, byteLength: frame.bytes.length };
    }
  } finally {
    if (process.env.JARVIS_VISION_PROBE_REPORT) await fs.writeFile(process.env.JARVIS_VISION_PROBE_REPORT, JSON.stringify(report), 'utf8');
    await camera.close();
    app.quit();
  }
})().catch(async (error) => {
  if (process.env.JARVIS_VISION_PROBE_REPORT) await fs.writeFile(process.env.JARVIS_VISION_PROBE_REPORT, JSON.stringify({ ...report, error: String(error.code || error.message || 'hardware probe failed').slice(0, 160) }), 'utf8').catch(() => {});
  console.error(JSON.stringify({ error: String(error.code || error.message || 'hardware probe failed').slice(0, 160) }));
  app.exit(1);
});
