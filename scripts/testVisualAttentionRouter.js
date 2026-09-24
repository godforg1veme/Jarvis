const assert = require('node:assert');
const { regionAroundPoint, resolveVisualAttention } = require('../vision/visualAttentionRouter');

const sources = [
  { sourceId: 'camera-1', type: 'camera', active: true, available: true },
  { sourceId: 'display-1', type: 'display', displayIndex: 0, active: true, available: true },
  { sourceId: 'display-2', type: 'display', displayIndex: 1, active: true, available: true },
  { sourceId: 'workspace-1', type: 'screen_workspace', active: true, available: true },
];

assert.deepStrictEqual(resolveVisualAttention({ sources, text: 'Посмотри на втором мониторе' }), {
  kind: 'resolved', sourceId: 'display-2', sourceType: 'display', confidence: 1, reason: 'explicit_second_display',
});
assert.strictEqual(resolveVisualAttention({ sources, text: 'Что видно в камере?' }).sourceId, 'camera-1');
assert.strictEqual(resolveVisualAttention({ sources, text: 'Посмотри на оба экрана' }).sourceId, 'workspace-1');
assert.strictEqual(resolveVisualAttention({ sources, text: 'Что здесь?', cursorDisplayIndex: 0 }).sourceId, 'display-1');
assert.strictEqual(resolveVisualAttention({ sources, requestedSourceId: 'missing' }).kind, 'unavailable');
assert.strictEqual(resolveVisualAttention({ sources, text: 'Что происходит?' }).kind, 'ambiguous');
assert.strictEqual(resolveVisualAttention({ sources: [sources[0]], text: 'Что происходит?' }).sourceId, 'camera-1');

assert.deepStrictEqual(regionAroundPoint(
  { x: 10, y: 20 },
  { width: 1920, height: 1080 },
  { width: 900, height: 600 },
), { x: 0, y: 0, width: 900, height: 600 });
assert.deepStrictEqual(regionAroundPoint(
  { x: 1910, y: 1070 },
  { width: 1920, height: 1080 },
  { width: 900, height: 600 },
), { x: 1020, y: 480, width: 900, height: 600 });

console.log('[testVisualAttentionRouter] visual attention router tests passed');

