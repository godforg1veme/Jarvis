const assert = require('node:assert/strict');
const { ObjectReconciler } = require('../server/src/vision/objectReconciler');

let nextId = 0;
const reconciler = new ObjectReconciler({ createId: () => `object-${++nextId}` });
const first = reconciler.reconcile({ observed: [{ providerId: 'cup-1', type: 'cup', description: 'red ceramic cup', location: 'left table' }], at: 1000 });
const moved = reconciler.reconcile({ previous: first, observed: [{ providerId: 'cup-1', type: 'cup', description: 'red ceramic cup', location: 'right table' }], at: 2000 });
assert.equal(moved[0].objectId, first[0].objectId);
assert.equal(moved[0].location, 'right table');
const withoutProviderId = reconciler.reconcile({ previous: moved, observed: [{ type: 'cup', description: 'red ceramic cup', location: 'right table' }], at: 2200 });
assert.equal(withoutProviderId[0].objectId, first[0].objectId);

const ambiguousPrevious = [
  { ...first[0], objectId: 'object-a', providerId: '', lastSeenAt: 2000 },
  { ...first[0], objectId: 'object-b', providerId: '', lastSeenAt: 2000 },
];
const uncertain = reconciler.reconcile({ previous: ambiguousPrevious, observed: [{ type: 'cup', description: 'red ceramic cup', location: 'table' }], at: 2500 });
assert.notEqual(uncertain[0].objectId, 'object-a');
assert.notEqual(uncertain[0].objectId, 'object-b');
console.log('Object reconciler tests passed.');
