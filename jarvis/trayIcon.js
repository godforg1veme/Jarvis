const path = require("path");

const TRAY_ICON_PATH = path.join(__dirname, "assets", "tray-icon.png");

function getTrayIconPath() {
  return TRAY_ICON_PATH;
}

function createTrayIcon(nativeImage) {
  const image = nativeImage.createFromPath(TRAY_ICON_PATH);
  if (!image || image.isEmpty()) {
    throw new Error(`Tray icon not found or invalid: ${TRAY_ICON_PATH}`);
  }
  return image.resize({ width: 16, height: 16 });
}

module.exports = {
  createTrayIcon,
  getTrayIconPath,
};
