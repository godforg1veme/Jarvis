const { MAX_FRAME_BYTES } = require('./visionSchemas');

const DEFAULT_TILE_WIDTH = 960;
const LABEL_HEIGHT = 30;
const TILE_GAP = 8;

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeFrames(frames, tileWidth) {
  if (!Array.isArray(frames) || frames.length === 0 || frames.length > 8) {
    throw new Error('screen workspace frames are invalid');
  }
  return frames.map((frame, index) => {
    if (!frame || !frame.image || typeof frame.image.getSize !== 'function') {
      throw new Error('screen workspace frame image is invalid');
    }
    const size = frame.image.getSize();
    if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width < 1 || size.height < 1) {
      throw new Error('screen workspace frame size is invalid');
    }
    const width = Math.min(tileWidth, Math.round(size.width));
    const height = Math.max(1, Math.round(size.height * (width / size.width)));
    const resized = width === size.width ? frame.image : frame.image.resize({ width, height, quality: 'good' });
    const png = resized.toPNG();
    if (!png || png.length === 0 || png.length > MAX_FRAME_BYTES) {
      throw new Error('screen workspace tile bytes are invalid');
    }
    return {
      image: resized,
      sourceId: String(frame.sourceId || ''),
      displayIndex: Number.isInteger(frame.displayIndex) ? frame.displayIndex : index,
      label: `DISPLAY ${Number.isInteger(frame.displayIndex) ? frame.displayIndex + 1 : index + 1}`,
      width,
      height,
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    };
  });
}

function buildWorkspaceSvg(frames, options = {}) {
  const tileWidth = Math.max(320, Math.min(Number(options.tileWidth || DEFAULT_TILE_WIDTH), 1920));
  const normalized = normalizeFrames(frames, tileWidth);
  const width = normalized.reduce((sum, frame) => sum + frame.width, 0) + TILE_GAP * (normalized.length - 1);
  const height = Math.max(...normalized.map((frame) => frame.height)) + LABEL_HEIGHT;
  let x = 0;
  const tiles = [];
  const elements = normalized.map((frame) => {
    const currentX = x;
    tiles.push({
      sourceId: frame.sourceId,
      displayIndex: frame.displayIndex,
      x: currentX,
      y: LABEL_HEIGHT,
      width: frame.width,
      height: frame.height,
    });
    x += frame.width + TILE_GAP;
    return [
      `<rect x="${currentX}" y="0" width="${frame.width}" height="${LABEL_HEIGHT}" fill="#171a18"/>`,
      `<text x="${currentX + 12}" y="20" font-family="Arial, sans-serif" font-size="13" fill="#d8ff65">${escapeXml(frame.label)}</text>`,
      `<image x="${currentX}" y="${LABEL_HEIGHT}" width="${frame.width}" height="${frame.height}" href="${frame.dataUrl}"/>`,
    ].join('');
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#0b0d0c"/>${elements}</svg>`;
  return { svg, width, height, tiles };
}

function composeScreenWorkspace(frames, options = {}) {
  if (!options.nativeImage || typeof options.nativeImage.createFromDataURL !== 'function') {
    throw new Error('nativeImage is required for screen workspace composition');
  }
  const built = buildWorkspaceSvg(frames, options);
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(built.svg, 'utf8').toString('base64')}`;
  const image = options.nativeImage.createFromDataURL(dataUrl);
  if (!image || image.isEmpty()) throw new Error('screen workspace composition failed');
  const quality = Math.max(40, Math.min(Number(options.jpegQuality || 82), 95));
  const bytes = image.toJPEG(quality);
  if (!bytes || bytes.length === 0 || bytes.length > MAX_FRAME_BYTES) {
    throw new Error('screen workspace bytes are invalid');
  }
  return {
    bytes,
    image,
    contentType: 'image/jpeg',
    width: built.width,
    height: built.height,
    tiles: built.tiles,
  };
}

module.exports = {
  DEFAULT_TILE_WIDTH,
  LABEL_HEIGHT,
  TILE_GAP,
  buildWorkspaceSvg,
  composeScreenWorkspace,
  escapeXml,
};
