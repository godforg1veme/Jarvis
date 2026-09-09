const assert = require('node:assert');
const { VisualSourceRegistry } = require('../vision/visualSourceRegistry');

let nextId = 0;
const registry = new VisualSourceRegistry({ createId: () => `source-${++nextId}` });
const cam = registry.upsert({ type: 'camera', nativeId: 'camo-private-id', label: 'Camo Camera' });
const sameCam = registry.upsert({ type: 'camera', nativeId: 'camo-private-id', label: 'Camo Camera updated' });
const display1 = registry.upsert({ type: 'display', nativeId: 'display-private-1', label: 'Display 1', displayIndex: 0 });
const display2 = registry.upsert({ type: 'display', nativeId: 'display-private-2', label: 'Display 2', displayIndex: 1 });

assert.strictEqual(cam.sourceId, sameCam.sourceId);
assert.strictEqual(registry.listLocal()[0].nativeId, 'camo-private-id');
assert.strictEqual(registry.listPublic()[0].nativeId, undefined);
assert.strictEqual(registry.listPublic()[0].label, undefined);
registry.setActive([cam.sourceId, display1.sourceId, display2.sourceId]);
assert.strictEqual(registry.getLocal(cam.sourceId).active, true);

const otherCam = registry.upsert({ type: 'camera', nativeId: 'usb-private-id', label: 'USB Camera' });
assert.throws(() => registry.setActive([cam.sourceId, otherCam.sourceId]), /only one camera/);
registry.markUnavailableMissing('camera', ['camo-private-id']);
assert.strictEqual(registry.getLocal(otherCam.sourceId).available, false);
assert.throws(() => registry.setActive([otherCam.sourceId]), /unavailable/);
assert.throws(() => registry.upsert({ type: 'audio', nativeId: 'mic-1' }), /source type/);

console.log('[testVisualSourceRegistry] visual source registry tests passed');

