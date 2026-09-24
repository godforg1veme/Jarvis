const { MAX_FRAME_BYTES } = require('./visionSchemas');
const { composeScreenWorkspace } = require('./screenWorkspaceCompositor');
const { grayscaleSignatureFromBgra } = require('./sceneChangeDetector');

function normalizeCaptureSize(options = {}) {
  const maxWidth = Number(options.maxWidth || 1920);
  const maxHeight = Number(options.maxHeight || 1080);
  if (!Number.isInteger(maxWidth) || maxWidth < 320 || maxWidth > 7680) throw new Error('screen maxWidth is invalid');
  if (!Number.isInteger(maxHeight) || maxHeight < 200 || maxHeight > 7680) throw new Error('screen maxHeight is invalid');
  return { maxWidth, maxHeight };
}

function validateRegion(region, size) {
  if (region === undefined || region === null) return null;
  if (!region || typeof region !== 'object' || Array.isArray(region)) throw new Error('screen region is invalid');
  const result = {};
  for (const key of ['x', 'y', 'width', 'height']) {
    result[key] = Number(region[key]);
    if (!Number.isInteger(result[key])) throw new Error('screen region is invalid');
  }
  if (result.x < 0 || result.y < 0 || result.width < 32 || result.height < 32
    || result.x + result.width > size.width || result.y + result.height > size.height) {
    throw new Error('screen region is out of bounds');
  }
  return result;
}

class ScreenCaptureController {
  constructor(options = {}) {
    if (!options.desktopCapturer) throw new Error('ScreenCaptureController requires desktopCapturer');
    if (!options.screen) throw new Error('ScreenCaptureController requires screen');
    if (!options.nativeImage) throw new Error('ScreenCaptureController requires nativeImage');
    if (!options.sourceRegistry) throw new Error('ScreenCaptureController requires sourceRegistry');
    this.desktopCapturer = options.desktopCapturer;
    this.screen = options.screen;
    this.nativeImage = options.nativeImage;
    this.sourceRegistry = options.sourceRegistry;
    this.privacyGuard = options.privacyGuard || null;
    this.composeWorkspace = options.composeWorkspace || null;
  }

  listDisplays() {
    const displays = this.screen.getAllDisplays().slice(0, 8);
    const nativeIds = [];
    const sources = displays.map((display, index) => {
      const nativeId = String(display.id);
      nativeIds.push(nativeId);
      return this.sourceRegistry.upsert({
        type: 'display',
        nativeId,
        label: `Display ${index + 1}`,
        displayIndex: index,
        available: true,
      });
    });
    this.sourceRegistry.markUnavailableMissing('display', nativeIds);
    return sources;
  }

  async _screenSources(options = {}) {
    const { maxWidth, maxHeight } = normalizeCaptureSize(options);
    return this.desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: maxWidth, height: maxHeight },
      fetchWindowIcons: false,
    });
  }

  async _assertPrivacy() {
    if (!this.privacyGuard) return;
    const windows = await this.desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
    const result = this.privacyGuard.evaluate({ windows: windows.map((window) => ({ processName: window.name, title: window.name, visible: true })) });
    if (!result.allowed) {
      const error = new Error('screen capture paused by privacy denylist');
      error.code = 'VISION_PRIVACY_PAUSED';
      throw error;
    }
  }

  _frameFromCandidate(source, candidate, options = {}) {
    if (!candidate || !candidate.thumbnail || candidate.thumbnail.isEmpty()) throw new Error('display capture is unavailable');
    const fullSize = candidate.thumbnail.getSize();
    const region = validateRegion(options.region, fullSize);
    const image = region ? candidate.thumbnail.crop(region) : candidate.thumbnail;
    if (!image || image.isEmpty()) throw new Error('display capture is empty');
    const size = image.getSize();
    const quality = Math.max(40, Math.min(Number(options.jpegQuality || 82), 95));
    const bytes = image.toJPEG(quality);
    if (!bytes || bytes.length === 0 || bytes.length > MAX_FRAME_BYTES) throw new Error('display frame bytes are invalid');
    return {
      sourceId: source.sourceId,
      displayIndex: source.displayIndex,
      bytes,
      image,
      contentType: 'image/jpeg',
      width: size.width,
      height: size.height,
      capturedAt: new Date().toISOString(),
      signature: grayscaleSignatureFromBgra(image.toBitmap(), size.width, size.height),
      ...(region ? { region } : {}),
    };
  }

  async captureDisplay(sourceId, options = {}) {
    await this._assertPrivacy();
    const source = this.sourceRegistry.requireLocal(sourceId);
    if (source.type !== 'display' || !source.available || source.protected) throw new Error('display source is unavailable');
    const candidates = await this._screenSources(options);
    const candidate = candidates.find((item) => String(item.display_id) === String(source.nativeId));
    return this._frameFromCandidate(source, candidate, options);
  }

  async captureWorkspace(sourceIds, options = {}) {
    await this._assertPrivacy();
    if (!Array.isArray(sourceIds) || sourceIds.length < 1 || sourceIds.length > 8) {
      throw new Error('workspace display sources are invalid');
    }
    const sources = sourceIds.map((sourceId) => {
      const source = this.sourceRegistry.requireLocal(sourceId);
      if (source.type !== 'display' || !source.available || source.protected) throw new Error('display source is unavailable');
      return source;
    });
    const candidates = await this._screenSources(options);
    const frames = sources.map((source) => this._frameFromCandidate(
      source,
      candidates.find((item) => String(item.display_id) === String(source.nativeId)),
      options,
    ));
    const composed = this.composeWorkspace
      ? await this.composeWorkspace(frames, options)
      : composeScreenWorkspace(frames, { nativeImage: this.nativeImage, tileWidth: options.tileWidth, jpegQuality: options.jpegQuality });
    const signature = composed.image
      ? grayscaleSignatureFromBgra(composed.image.toBitmap(), composed.width, composed.height)
      : Uint8Array.from(frames.flatMap((frame) => [...frame.signature]).slice(0, 16384));
    return {
      bytes: composed.bytes,
      contentType: composed.contentType,
      width: composed.width,
      height: composed.height,
      tiles: composed.tiles,
      sourceId: String(options.workspaceSourceId || 'screen-workspace'),
      capturedAt: new Date().toISOString(),
      signature,
    };
  }
}

module.exports = {
  ScreenCaptureController,
  normalizeCaptureSize,
  validateRegion,
};
