const { validateVisionObservation, VISION_PROTOCOL_VERSION } = require('./visionSchemas');

class VisionProviderError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'VisionProviderError';
    this.code = code;
  }
}

class DisabledVisionProvider {
  async observe() {
    throw new VisionProviderError('VISION_PROVIDER_DISABLED');
  }
}

class FakeVisionProvider {
  constructor(options = {}) { this.fixture = options.fixture || null; }

  async observe(input) {
    const value = typeof this.fixture === 'function' ? await this.fixture(input) : this.fixture;
    return validateVisionObservation(value || {
      version: VISION_PROTOCOL_VERSION,
      frameId: input.metadata.frameId,
      sourceId: input.metadata.sourceId,
      capturedAt: input.metadata.capturedAt,
      observedAt: new Date().toISOString(),
      sceneSummary: 'Тестовый визуальный кадр обработан.',
      sensitivity: 'none', confidence: 1, objects: [], texts: [], events: [],
    });
  }
}

module.exports = { DisabledVisionProvider, FakeVisionProvider, VisionProviderError };
