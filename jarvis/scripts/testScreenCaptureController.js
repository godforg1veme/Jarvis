const assert = require('node:assert');
const { VisualSourceRegistry } = require('../vision/visualSourceRegistry');
const { ScreenCaptureController, validateRegion } = require('../vision/screenCaptureController');
const { buildWorkspaceSvg } = require('../vision/screenWorkspaceCompositor');

class FakeImage {
  constructor(width, height, marker = 'image') {
    this.width = width;
    this.height = height;
    this.marker = marker;
  }
  getSize() { return { width: this.width, height: this.height }; }
  isEmpty() { return false; }
  resize({ width, height }) { return new FakeImage(width, height, `${this.marker}:resized`); }
  crop({ width, height }) { return new FakeImage(width, height, `${this.marker}:cropped`); }
  toPNG() { return Buffer.from(`png:${this.marker}`); }
  toJPEG() { return Buffer.from([0xff, 0xd8, 0xff, 0xd9]); }
  toBitmap() { return Buffer.alloc(this.width * this.height * 4, 100); }
}

let composedSvg = '';
const nativeImage = {
  createFromDataURL(dataUrl) {
    composedSvg = Buffer.from(dataUrl.split(',')[1], 'base64').toString('utf8');
    const match = /width="(\d+)" height="(\d+)"/.exec(composedSvg);
    return new FakeImage(Number(match[1]), Number(match[2]), 'workspace');
  },
};

let id = 0;
const registry = new VisualSourceRegistry({ createId: () => `source-display-${++id}` });
let captureCalls = 0;
const controller = new ScreenCaptureController({
  screen: {
    getAllDisplays: () => [
      { id: 101, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
      { id: 202, bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.25 },
    ],
  },
  desktopCapturer: {
    getSources: async () => {
      captureCalls += 1;
      return [
        { display_id: '101', thumbnail: new FakeImage(1920, 1080, 'left') },
        { display_id: '202', thumbnail: new FakeImage(1920, 1080, 'right') },
      ];
    },
  },
  nativeImage,
  sourceRegistry: registry,
});

(async () => {
  const displays = controller.listDisplays();
  assert.strictEqual(displays.length, 2);
  assert.strictEqual(displays[1].displayIndex, 1);
  assert.strictEqual(registry.listPublic()[0].nativeId, undefined);

  const frame = await controller.captureDisplay(displays[0].sourceId, { region: { x: 10, y: 20, width: 900, height: 600 } });
  assert.strictEqual(frame.width, 900);
  assert.strictEqual(frame.height, 600);
  assert.strictEqual(frame.image.marker, 'left:cropped');
  assert.throws(() => validateRegion({ x: 1900, y: 0, width: 100, height: 100 }, { width: 1920, height: 1080 }), /out of bounds/);

  const workspace = await controller.captureWorkspace(displays.map((display) => display.sourceId), {
    workspaceSourceId: 'workspace-owner-1',
    tileWidth: 960,
  });
  assert.strictEqual(workspace.sourceId, 'workspace-owner-1');
  assert.strictEqual(captureCalls, 2, 'one call for focused capture and one shared call for the workspace');
  assert.strictEqual(workspace.tiles.length, 2);
  assert.match(composedSvg, /DISPLAY 1/);
  assert.match(composedSvg, /DISPLAY 2/);
  assert.match(composedSvg, /data:image\/png;base64,/);
  assert.strictEqual(workspace.bytes[0], 0xff);

  const escaped = buildWorkspaceSvg([{ sourceId: 'x', displayIndex: 0, image: new FakeImage(800, 600) }]);
  assert.match(escaped.svg, /DISPLAY 1/);
  console.log('[testScreenCaptureController] screen capture controller tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
