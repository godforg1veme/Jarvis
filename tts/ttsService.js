const fs = require('fs');
const path = require('path');
const sileroService = require('./sileroService');
const piperService = require('./piperService');
const windowsSapiService = require('./windowsSapiService');

const PROJECT_ROOT = path.join(__dirname, '..');
const SETTINGS_PATH = path.join(PROJECT_ROOT, 'data', 'tts-settings.json');

const DEFAULT_SETTINGS = {
  enabled: true,
  provider: 'silero',
  fallbackProvider: 'piper',
  speakVoiceResults: true,
};

function loadJSON(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function resolveSettings(rawSettings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    provider: String(rawSettings.provider || DEFAULT_SETTINGS.provider),
    fallbackProvider: rawSettings.fallbackProvider === false
      ? false
      : String(rawSettings.fallbackProvider || DEFAULT_SETTINGS.fallbackProvider),
  };
}

function createTtsService(options = {}) {
  const providerCache = new Map();

  function getSettings() {
    if (options.settings) {
      return resolveSettings(options.settings);
    }

    return resolveSettings(loadJSON(options.settingsPath || SETTINGS_PATH, DEFAULT_SETTINGS));
  }

  function getProviderSettings(provider) {
    return {
      ...getSettings(),
      provider,
    };
  }

  function getProviderService(provider) {
    const settings = getProviderSettings(provider);
    const cacheKey = JSON.stringify(settings);

    if (providerCache.has(provider)) {
      const cached = providerCache.get(provider);
      if (cached.cacheKey === cacheKey) {
        return cached.service;
      }
      if (cached.service && typeof cached.service.destroyWorker === 'function') {
        cached.service.destroyWorker();
      }
      providerCache.delete(provider);
    }

    let service = null;
    if (provider === 'silero') {
      service = options.sileroService
        || (options.createSileroService || sileroService.createSileroService)({ settings });
    }
    if (provider === 'piper') {
      service = options.piperService
        || (options.createPiperService || piperService.createPiperService)({ settings });
    }
    if (provider === 'windows-sapi') {
      service = options.windowsSapiService
        || (options.createWindowsSapiService || windowsSapiService.createWindowsSapiService)({ settings });
    }

    if (!service) return null;

    providerCache.set(provider, { cacheKey, service });
    return service;
  }

  async function speak(text) {
    const settings = getSettings();
    const content = String(text || '').trim();

    if (!settings.enabled) {
      return { ok: false, skipped: true, reason: 'TTS disabled' };
    }
    if (!content) {
      return { ok: false, skipped: true, reason: 'empty text' };
    }

    const provider = settings.provider;
    const service = getProviderService(provider);
    if (!service || typeof service.speak !== 'function') {
      throw new Error(`Unsupported TTS provider: ${provider}`);
    }

    try {
      const result = await service.speak(content);
      return { ...result, provider };
    } catch (error) {
      const fallbackProvider = settings.fallbackProvider;
      const fallbackService = fallbackProvider ? getProviderService(fallbackProvider) : null;

      if (!fallbackService || typeof fallbackService.speak !== 'function' || fallbackProvider === provider) {
        throw error;
      }

      const fallbackResult = await fallbackService.speak(content);
      return {
        ...fallbackResult,
        provider: fallbackProvider,
        fallbackFrom: provider,
        primaryError: error.message,
      };
    }
  }

  async function prepare() {
    const settings = getSettings();

    if (!settings.enabled || settings.speakVoiceResults === false) {
      return { ok: false, skipped: true, reason: 'TTS disabled' };
    }

    const service = getProviderService(settings.provider);
    if (!service || typeof service.prepare !== 'function') {
      return { ok: true, skipped: true, reason: 'Provider has no prepare hook' };
    }

    return service.prepare();
  }

  return {
    prepare,
    speak,
    getSettings,
  };
}

const defaultService = createTtsService();

module.exports = {
  DEFAULT_SETTINGS,
  createTtsService,
  resolveSettings,
  prepare: defaultService.prepare,
  getSettings: defaultService.getSettings,
  speak: defaultService.speak,
};
