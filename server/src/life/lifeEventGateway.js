class LifeEventGateway {
  constructor(options = {}) {
    if (!options.repository) throw new Error('LifeEventGateway requires repository');
    this.repository = options.repository;
    this.enabled = options.enabled !== false;
    this.logger = options.logger || null;
  }

  async record(input) {
    if (!this.enabled) return null;
    try {
      return await this.repository.create(input);
    } catch (error) {
      if (this.logger && typeof this.logger.warn === 'function') {
        this.logger.warn({
          eventType: typeof input?.eventType === 'string' ? input.eventType.slice(0, 80) : 'invalid',
          sourceChannel: typeof input?.sourceChannel === 'string' ? input.sourceChannel.slice(0, 40) : 'invalid',
          errorCode: error?.name === 'ZodError' ? 'LIFE_EVENT_INVALID' : 'LIFE_EVENT_WRITE_FAILED',
        }, 'Life OS event was not recorded');
      }
      return null;
    }
  }
}

module.exports = { LifeEventGateway };
