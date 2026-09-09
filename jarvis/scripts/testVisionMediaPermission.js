const assert = require('node:assert/strict');
const { allowCaptureMedia } = require('../vision/mediaPermissionPolicy');

const base = { permission: 'media', voiceWebContentsId: 10, visionWebContentsId: 20 };
assert.equal(allowCaptureMedia({ ...base, requestingWebContentsId: 10, mediaTypes: ['audio'] }), true);
assert.equal(allowCaptureMedia({ ...base, requestingWebContentsId: 10, mediaTypes: ['video'] }), false);
assert.equal(allowCaptureMedia({ ...base, requestingWebContentsId: 20, mediaTypes: ['video'] }), true);
assert.equal(allowCaptureMedia({ ...base, requestingWebContentsId: 20, mediaType: 'video' }), true);
assert.equal(allowCaptureMedia({ ...base, requestingWebContentsId: 10, mediaType: 'audio' }), true);
assert.equal(allowCaptureMedia({ ...base, requestingWebContentsId: 20, mediaType: 'audio' }), false);
assert.equal(allowCaptureMedia({ ...base, requestingWebContentsId: undefined, mediaType: 'video' }), false);
assert.equal(allowCaptureMedia({ ...base, requestingWebContentsId: 20, mediaTypes: ['audio', 'video'] }), false);
assert.equal(allowCaptureMedia({ ...base, requestingWebContentsId: 30, mediaTypes: ['video'] }), false);
assert.equal(allowCaptureMedia({ ...base, requestingWebContentsId: 20, mediaTypes: [] }), false);
console.log('Vision media permission tests passed.');
