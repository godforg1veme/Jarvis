const VISION_PROTOCOL_VERSION = 1;

const VISION_SOURCE_TYPES = Object.freeze([
  'camera',
  'display',
  'screen_workspace',
  'window',
]);

const VISION_CAPTURE_MODES = Object.freeze(['temporal', 'focused']);
const VISION_LEASE_STATES = Object.freeze([
  'off',
  'pending',
  'starting',
  'active',
  'stopping',
  'interrupted',
  'expired',
  'error',
]);
const VISION_SENSITIVITY = Object.freeze([
  'none',
  'possible',
  'sensitive',
]);
const VISION_MEMORY_STATES = Object.freeze([
  'pending_sensitive_consent',
  'stored',
  'rejected',
  'expired',
  'deleted',
]);

const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_EDGE = 7680;
const MAX_OBSERVATION_OBJECTS = 64;
const MAX_OBSERVATION_TEXTS = 64;
const MAX_OBSERVATION_EVENTS = 64;
const ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,128}$/;

const LEASE_TRANSITIONS = Object.freeze({
  off: Object.freeze(['pending', 'starting']),
  pending: Object.freeze(['starting', 'off', 'expired', 'error']),
  starting: Object.freeze(['active', 'off', 'interrupted', 'error']),
  active: Object.freeze(['stopping', 'interrupted', 'expired', 'error']),
  stopping: Object.freeze(['off', 'interrupted', 'expired', 'error']),
  interrupted: Object.freeze(['off']),
  expired: Object.freeze(['off']),
  error: Object.freeze(['off']),
});

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function rejectUnknownKeys(value, keys, label) {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${label} contains unknown field: ${unknown}`);
}

function requiredId(value, label) {
  const normalized = String(value || '').trim();
  if (!ID_PATTERN.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

function optionalText(value, maxLength, label) {
  if (value === undefined || value === null) return '';
  const normalized = String(value).trim();
  if (normalized.length > maxLength) throw new Error(`${label} is too long`);
  return normalized;
}

function requiredText(value, maxLength, label) {
  const normalized = optionalText(value, maxLength, label);
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function enumValue(value, allowed, label) {
  const normalized = String(value || '').trim();
  if (!allowed.includes(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

function boundedInteger(value, min, max, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function boundedNumber(value, min, max, label) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < min || normalized > max) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function isoTimestamp(value, label) {
  const normalized = requiredText(value, 40, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(normalized)
    || !Number.isFinite(Date.parse(normalized))) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function optionalConfidence(value, label = 'confidence') {
  if (value === undefined || value === null) return null;
  return boundedNumber(value, 0, 1, label);
}

function validateVisionSource(input) {
  const value = assertRecord(input, 'vision source');
  rejectUnknownKeys(value, [
    'sourceId', 'type', 'displayIndex', 'active', 'available', 'protected',
  ], 'vision source');
  const result = {
    sourceId: requiredId(value.sourceId, 'vision source id'),
    type: enumValue(value.type, VISION_SOURCE_TYPES, 'vision source type'),
    active: value.active === true,
    available: value.available !== false,
    protected: value.protected === true,
  };
  if (value.displayIndex !== undefined) {
    result.displayIndex = boundedInteger(value.displayIndex, 0, 31, 'display index');
  }
  return result;
}

function validateVisionFrameMetadata(input) {
  const value = assertRecord(input, 'vision frame metadata');
  rejectUnknownKeys(value, [
    'version', 'leaseId', 'captureRequestId', 'frameId', 'sourceId', 'sequence',
    'capturedAt', 'mode', 'contentType', 'byteLength', 'width', 'height',
    'changeScore', 'focusedReason',
  ], 'vision frame metadata');
  if (value.version !== VISION_PROTOCOL_VERSION) throw new Error('unsupported vision protocol version');
  const contentType = enumValue(value.contentType, ['image/jpeg', 'image/webp'], 'vision content type');
  const result = {
    version: VISION_PROTOCOL_VERSION,
    leaseId: requiredId(value.leaseId, 'vision lease id'),
    captureRequestId: requiredId(value.captureRequestId, 'vision capture request id'),
    frameId: requiredId(value.frameId, 'vision frame id'),
    sourceId: requiredId(value.sourceId, 'vision source id'),
    sequence: boundedInteger(value.sequence, 0, Number.MAX_SAFE_INTEGER, 'vision frame sequence'),
    capturedAt: isoTimestamp(value.capturedAt, 'vision capturedAt'),
    mode: enumValue(value.mode, VISION_CAPTURE_MODES, 'vision capture mode'),
    contentType,
    byteLength: boundedInteger(value.byteLength, 1, MAX_FRAME_BYTES, 'vision frame byteLength'),
    width: boundedInteger(value.width, 1, MAX_IMAGE_EDGE, 'vision frame width'),
    height: boundedInteger(value.height, 1, MAX_IMAGE_EDGE, 'vision frame height'),
  };
  if (value.changeScore !== undefined) {
    result.changeScore = boundedNumber(value.changeScore, 0, 1, 'vision changeScore');
  }
  if (value.focusedReason !== undefined) {
    result.focusedReason = optionalText(value.focusedReason, 160, 'vision focusedReason');
  }
  return result;
}

function validateObservationObject(input, index) {
  const value = assertRecord(input, `vision object ${index}`);
  rejectUnknownKeys(value, [
    'providerId', 'type', 'description', 'location', 'state', 'confidence',
  ], `vision object ${index}`);
  return {
    providerId: optionalText(value.providerId, 128, `vision object ${index} providerId`),
    type: requiredText(value.type, 100, `vision object ${index} type`),
    description: optionalText(value.description, 500, `vision object ${index} description`),
    location: optionalText(value.location, 500, `vision object ${index} location`),
    state: optionalText(value.state, 300, `vision object ${index} state`),
    confidence: optionalConfidence(value.confidence, `vision object ${index} confidence`),
  };
}

function validateObservationText(input, index) {
  const value = assertRecord(input, `vision text ${index}`);
  rejectUnknownKeys(value, ['text', 'kind', 'sensitive', 'confidence'], `vision text ${index}`);
  return {
    text: requiredText(value.text, 4000, `vision text ${index} text`),
    kind: optionalText(value.kind, 80, `vision text ${index} kind`),
    sensitive: value.sensitive === true,
    confidence: optionalConfidence(value.confidence, `vision text ${index} confidence`),
  };
}

function validateObservationEvent(input, index) {
  const value = assertRecord(input, `vision event ${index}`);
  rejectUnknownKeys(value, ['type', 'subjectHint', 'description', 'confidence'], `vision event ${index}`);
  return {
    type: requiredText(value.type, 100, `vision event ${index} type`),
    subjectHint: optionalText(value.subjectHint, 128, `vision event ${index} subjectHint`),
    description: optionalText(value.description, 500, `vision event ${index} description`),
    confidence: optionalConfidence(value.confidence, `vision event ${index} confidence`),
  };
}

function boundedArray(value, max, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} is invalid`);
  return value;
}

function validateVisionObservation(input) {
  const value = assertRecord(input, 'vision observation');
  rejectUnknownKeys(value, [
    'version', 'frameId', 'sourceId', 'capturedAt', 'observedAt', 'sceneSummary',
    'sensitivity', 'confidence', 'objects', 'texts', 'events',
  ], 'vision observation');
  if (value.version !== VISION_PROTOCOL_VERSION) throw new Error('unsupported vision observation version');
  return {
    version: VISION_PROTOCOL_VERSION,
    frameId: requiredId(value.frameId, 'vision observation frame id'),
    sourceId: requiredId(value.sourceId, 'vision observation source id'),
    capturedAt: isoTimestamp(value.capturedAt, 'vision observation capturedAt'),
    observedAt: isoTimestamp(value.observedAt, 'vision observation observedAt'),
    sceneSummary: requiredText(value.sceneSummary, 4000, 'vision sceneSummary'),
    sensitivity: enumValue(value.sensitivity, VISION_SENSITIVITY, 'vision sensitivity'),
    confidence: optionalConfidence(value.confidence),
    objects: boundedArray(value.objects, MAX_OBSERVATION_OBJECTS, 'vision objects')
      .map(validateObservationObject),
    texts: boundedArray(value.texts, MAX_OBSERVATION_TEXTS, 'vision texts')
      .map(validateObservationText),
    events: boundedArray(value.events, MAX_OBSERVATION_EVENTS, 'vision events')
      .map(validateObservationEvent),
  };
}

function validateVisionMemoryMetadata(input) {
  const value = assertRecord(input, 'vision memory metadata');
  rejectUnknownKeys(value, [
    'memoryId', 'episodeId', 'frameId', 'sourceId', 'state', 'sensitivity',
    'capturedAt', 'expiresAt', 'pinned', 'byteLength', 'contentHash',
  ], 'vision memory metadata');
  const result = {
    memoryId: requiredId(value.memoryId, 'vision memory id'),
    episodeId: requiredId(value.episodeId, 'vision episode id'),
    frameId: requiredId(value.frameId, 'vision memory frame id'),
    sourceId: requiredId(value.sourceId, 'vision memory source id'),
    state: enumValue(value.state, VISION_MEMORY_STATES, 'vision memory state'),
    sensitivity: enumValue(value.sensitivity, VISION_SENSITIVITY, 'vision memory sensitivity'),
    capturedAt: isoTimestamp(value.capturedAt, 'vision memory capturedAt'),
    pinned: value.pinned === true,
    byteLength: boundedInteger(value.byteLength, 1, MAX_FRAME_BYTES, 'vision memory byteLength'),
    contentHash: requiredText(value.contentHash, 128, 'vision memory contentHash'),
  };
  if (!/^[a-f0-9]{64}$/i.test(result.contentHash)) throw new Error('vision memory contentHash is invalid');
  if (value.expiresAt !== undefined && value.expiresAt !== null) {
    result.expiresAt = isoTimestamp(value.expiresAt, 'vision memory expiresAt');
  }
  return result;
}

function canTransitionVisionLease(from, to) {
  const fromState = enumValue(from, VISION_LEASE_STATES, 'vision lease state');
  const toState = enumValue(to, VISION_LEASE_STATES, 'vision lease state');
  return fromState === toState || LEASE_TRANSITIONS[fromState].includes(toState);
}

function assertVisionLeaseTransition(from, to) {
  if (!canTransitionVisionLease(from, to)) {
    throw new Error(`invalid vision lease transition: ${from} -> ${to}`);
  }
  return to;
}

module.exports = {
  ID_PATTERN,
  LEASE_TRANSITIONS,
  MAX_FRAME_BYTES,
  MAX_IMAGE_EDGE,
  MAX_OBSERVATION_EVENTS,
  MAX_OBSERVATION_OBJECTS,
  MAX_OBSERVATION_TEXTS,
  VISION_CAPTURE_MODES,
  VISION_LEASE_STATES,
  VISION_MEMORY_STATES,
  VISION_PROTOCOL_VERSION,
  VISION_SENSITIVITY,
  VISION_SOURCE_TYPES,
  assertVisionLeaseTransition,
  canTransitionVisionLease,
  isRecord,
  requiredId,
  validateVisionFrameMetadata,
  validateVisionMemoryMetadata,
  validateVisionObservation,
  validateVisionSource,
};
