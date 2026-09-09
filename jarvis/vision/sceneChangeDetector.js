const DEFAULTS = Object.freeze({
  pixelDeltaThreshold: 0.12,
  significantScore: 0.18,
  changedRatioThreshold: 0.08,
  stableScore: 0.035,
  settleMs: 450,
  heartbeatMs: 30000,
});

function validateSignature(value, label) {
  if (!(value instanceof Uint8Array) || value.length < 64 || value.length > 16384) {
    throw new Error(`${label} signature is invalid`);
  }
  return value;
}

function compareSignatures(previousInput, currentInput, options = {}) {
  const previous = validateSignature(previousInput, 'previous');
  const current = validateSignature(currentInput, 'current');
  if (previous.length !== current.length) throw new Error('vision signatures must have the same length');
  const pixelDeltaThreshold = Number(options.pixelDeltaThreshold || DEFAULTS.pixelDeltaThreshold);
  let previousMean = 0;
  let currentMean = 0;
  for (let index = 0; index < previous.length; index += 1) {
    previousMean += previous[index];
    currentMean += current[index];
  }
  previousMean /= previous.length;
  currentMean /= current.length;
  const brightnessDelta = (currentMean - previousMean) / 255;
  let total = 0;
  let normalizedTotal = 0;
  let changed = 0;
  for (let index = 0; index < previous.length; index += 1) {
    const raw = Math.abs(current[index] - previous[index]) / 255;
    const normalized = Math.abs((current[index] - currentMean) - (previous[index] - previousMean)) / 255;
    total += raw;
    normalizedTotal += normalized;
    if (normalized >= pixelDeltaThreshold) changed += 1;
  }
  return {
    rawScore: total / previous.length,
    changeScore: normalizedTotal / previous.length,
    changedRatio: changed / previous.length,
    brightnessDelta,
  };
}

class SceneChangeDetector {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.states = new Map();
  }

  reset(sourceId) {
    if (sourceId) this.states.delete(String(sourceId));
    else this.states.clear();
  }

  consider({ sourceId, signature, at = Date.now() }) {
    const id = String(sourceId || '').trim();
    if (!id) throw new Error('vision source id is required');
    const sample = validateSignature(signature, 'current');
    const timestamp = Number(at);
    if (!Number.isFinite(timestamp)) throw new Error('vision sample time is invalid');
    const state = this.states.get(id);
    if (!state) {
      this.states.set(id, {
        accepted: sample.slice(),
        acceptedAt: timestamp,
        pending: null,
        motionAt: 0,
      });
      return { send: true, reason: 'first_frame', changeScore: 1, changedRatio: 1 };
    }

    const acceptedDiff = compareSignatures(state.accepted, sample, this.options);
    if (timestamp - state.acceptedAt >= this.options.heartbeatMs) {
      state.accepted = sample.slice();
      state.acceptedAt = timestamp;
      state.pending = null;
      state.motionAt = 0;
      return { send: true, reason: 'heartbeat', ...acceptedDiff };
    }

    if (state.pending) {
      const pendingDiff = compareSignatures(state.pending, sample, this.options);
      state.pending = sample.slice();
      if (pendingDiff.changeScore <= this.options.stableScore
        && timestamp - state.motionAt >= this.options.settleMs) {
        state.accepted = sample.slice();
        state.acceptedAt = timestamp;
        state.pending = null;
        state.motionAt = 0;
        return { send: true, reason: 'post_motion_stable', ...acceptedDiff };
      }
      return { send: false, reason: 'motion_settling', ...acceptedDiff };
    }

    const significant = acceptedDiff.changeScore >= this.options.significantScore
      || acceptedDiff.changedRatio >= this.options.changedRatioThreshold;
    if (significant) {
      state.motionAt = timestamp;
      state.pending = sample.slice();
      return { send: false, reason: 'motion_pending', ...acceptedDiff };
    }

    return { send: false, reason: 'unchanged', ...acceptedDiff };
  }
}

function grayscaleSignatureFromBgra(bitmap, width, height, options = {}) {
  if (!Buffer.isBuffer(bitmap) && !(bitmap instanceof Uint8Array)) throw new Error('BGRA bitmap is invalid');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || bitmap.length < width * height * 4) throw new Error('BGRA bitmap dimensions are invalid');
  const targetWidth = Math.max(1, Math.min(Number(options.width || 64), width));
  const targetHeight = Math.max(1, Math.min(Number(options.height || 36), height));
  const result = new Uint8Array(targetWidth * targetHeight);
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceY = Math.min(height - 1, Math.floor((targetY + 0.5) * height / targetHeight));
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceX = Math.min(width - 1, Math.floor((targetX + 0.5) * width / targetWidth));
      const index = (sourceY * width + sourceX) * 4;
      const blue = bitmap[index];
      const green = bitmap[index + 1];
      const red = bitmap[index + 2];
      result[targetY * targetWidth + targetX] = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
    }
  }
  return result;
}

module.exports = {
  DEFAULTS,
  SceneChangeDetector,
  compareSignatures,
  grayscaleSignatureFromBgra,
};
