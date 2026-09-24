const fs = require('fs');
const {
  getSttProfiles,
  saveSttProfile,
  saveSttSettings,
  sttPreviewSettingsPath,
  sttSettingsPath,
  validateSttSettings,
} = require('./sttSettings');
const { QualityMonitor } = require('./qualityMonitor');
const { LocalCalibrator } = require('./localCalibrator');
const { GeminiVoiceAdvisor } = require('../tools/geminiVoiceAdvisor');

class VoiceLabController {
  constructor({ voiceService, geminiAdvisor = null } = {}) {
    if (!voiceService) throw new Error('VoiceLabController requires a VoiceService.');
    this.voiceService = voiceService;
    this.monitor = new QualityMonitor();
    this.advisor = geminiAdvisor || new GeminiVoiceAdvisor();
    this.calibrator = new LocalCalibrator(this.monitor);
    this.previewBase = null;
    this.previewSettings = null;
    this.testState = null;
    this.lastAdvisor = null;
    this.geminiInFlight = false;
    this.lastMeterBroadcastAt = 0;
    this.voiceService.setVoiceLabController(this);
  }

  shouldBufferAudio() {
    return this.voiceService.sttSettings?.advisor?.allowAudio === true;
  }

  onPcm(pcmBuffer, settings) {
    const meter = this.monitor.acceptPcm(pcmBuffer, settings);
    const now = Date.now();
    if (now - this.lastMeterBroadcastAt >= 100) {
      this.lastMeterBroadcastAt = now;
      this.emit('meter', { meter, metrics: this.monitor.snapshot() });
    }
  }

  onFinalResult(text) {
    this.monitor.recordResult(text);
    this.emit('metrics', { metrics: this.monitor.snapshot() });
    this.maybeAnalyzeAutomatically().catch((error) => {
      this.emit('error', { error: error.message || 'Gemini analysis failed.' });
    });
  }

  onWorkerMetrics(metrics) {
    this.monitor.recordSegment(metrics);
    this.emit('metrics', { metrics: this.monitor.snapshot() });
  }

  onWorkerError(message) {
    this.monitor.recordWorkerError();
    this.emit('metrics', { metrics: this.monitor.snapshot(), message });
  }

  onInputDrop(count) {
    this.monitor.recordInputDrop(count);
    this.emit('metrics', { metrics: this.monitor.snapshot() });
  }

  emit(type, payload = {}) {
    this.voiceService.broadcastVoiceLab(type, payload);
  }

  getState() {
    const settings = validateSttSettings(this.voiceService.sttSettings || {});
    const advisor = this.advisor.getStatus(settings);
    const recentAudioLength = this.voiceService.getRecentPcm().length;
    return {
      settings,
      profiles: getSttProfiles(),
      metrics: this.monitor.snapshot(),
      calibration: this.calibrator.getState(),
      preview: {
        active: Boolean(this.previewSettings),
        settings: this.previewSettings,
      },
      test: this.testState,
      advisor: {
        ...advisor,
        lastResult: this.lastAdvisor
          ? {
            ok: this.lastAdvisor.ok,
            confidence: this.lastAdvisor.confidence,
            explanation: this.lastAdvisor.explanation,
            changes: this.lastAdvisor.changes,
          }
          : null,
      },
      recentAudio: {
        available: recentAudioLength > 0,
        durationMs: Math.round(recentAudioLength / 2 / 16),
      },
    };
  }

  async setPreviewSettings(settings) {
    const next = validateSttSettings(settings || {});
    if (!this.previewBase) this.previewBase = validateSttSettings(this.voiceService.sttSettings || {});
    saveSttSettings(next, sttPreviewSettingsPath());
    const result = await this.voiceService.restartForSettings(next, sttPreviewSettingsPath());
    if (!result.ok) {
      const fallback = this.previewBase;
      this.previewBase = null;
      this.previewSettings = null;
      try { fs.unlinkSync(sttPreviewSettingsPath()); } catch (e) {}
      await this.voiceService.restartForSettings(fallback, sttSettingsPath());
      throw new Error(result.error || 'Не удалось применить временный профиль.');
    }
    this.previewSettings = next;
    if (!next.advisor.allowAudio) this.voiceService.clearRecentPcm();
    this.emit('state', { state: this.getState() });
    return { ok: true, state: this.getState() };
  }

  async saveProfile({ id, name, source = 'manual' } = {}) {
    const settings = validateSttSettings(this.voiceService.sttSettings || {});
    const profile = saveSttProfile({
      id,
      name,
      deviceId: settings.capture.deviceId,
      settings,
      source,
    });
    this.previewBase = null;
    this.previewSettings = null;
    try { fs.unlinkSync(sttPreviewSettingsPath()); } catch (e) {}
    await this.voiceService.restartForSettings(settings, sttSettingsPath());
    this.emit('state', { state: this.getState() });
    return { ok: true, profile, state: this.getState() };
  }

  async revertPreview() {
    if (!this.previewBase) return { ok: true, state: this.getState() };
    const fallback = this.previewBase;
    this.previewBase = null;
    this.previewSettings = null;
    try { fs.unlinkSync(sttPreviewSettingsPath()); } catch (e) {}
    saveSttSettings(fallback, sttSettingsPath());
    await this.voiceService.restartForSettings(fallback, sttSettingsPath());
    this.voiceService.clearRecentPcm();
    this.emit('state', { state: this.getState() });
    return { ok: true, state: this.getState() };
  }

  startCalibration() {
    this.calibrator.start();
    this.emit('calibration', { state: this.getState() });
    return { ok: true, state: this.getState() };
  }

  nextCalibrationStep() {
    this.calibrator.next();
    this.emit('calibration', { state: this.getState() });
    return { ok: true, state: this.getState() };
  }

  async finishCalibration() {
    const result = this.calibrator.finish(this.voiceService.sttSettings);
    const preview = await this.setPreviewSettings(result.candidate);
    this.emit('calibration', { state: this.getState(), result });
    return { ok: true, result, preview, state: this.getState() };
  }

  startPreviewTest() {
    this.monitor.reset();
    this.testState = { active: true, startedAt: Date.now() };
    this.emit('test', { state: this.getState() });
    return { ok: true, state: this.getState() };
  }

  finishPreviewTest() {
    this.testState = { active: false, finishedAt: Date.now(), metrics: this.monitor.snapshot() };
    this.emit('test', { state: this.getState() });
    return { ok: true, state: this.getState() };
  }

  async requestGeminiAnalysis({ deep = false, includeAudio = false, force = true } = {}) {
    const settings = validateSttSettings(this.voiceService.sttSettings || {});
    if (settings.advisor.mode === 'off') {
      return { ok: false, reason: 'advisor-disabled', message: 'Помощь Gemini отключена в настройках.' };
    }
    if (includeAudio && settings.advisor.allowAudio !== true) {
      return { ok: false, reason: 'audio-not-allowed', message: 'Сначала разрешите отправку аудио в расширенных настройках.' };
    }
    const audioPcm = includeAudio ? this.voiceService.getRecentPcm() : null;
    if (includeAudio && audioPcm.length < 3200) {
      return { ok: false, reason: 'audio-not-ready', message: 'Нужно сначала произнести несколько команд после разрешения аудио.' };
    }

    const result = await this.advisor.analyze({
      settings,
      summary: this.monitor.snapshot(),
      audioPcm: deep || includeAudio ? audioPcm : null,
      force,
    });
    this.lastAdvisor = result;
    if (result.ok && result.candidate) {
      await this.setPreviewSettings(result.candidate);
      result.appliedTemporarily = true;
    }
    this.emit('advisor', { state: this.getState(), result });
    return { ...result, state: this.getState() };
  }

  async maybeAnalyzeAutomatically() {
    const settings = validateSttSettings(this.voiceService.sttSettings || {});
    if (this.geminiInFlight || !this.monitor.shouldRequestAdvisor(settings)) return null;
    if (!this.advisor.getStatus(settings).configured) return null;
    this.geminiInFlight = true;
    this.monitor.markAdvisorRequested(settings);
    try {
      return await this.requestGeminiAnalysis({ deep: false, includeAudio: false, force: false });
    } finally {
      this.geminiInFlight = false;
    }
  }
}

module.exports = { VoiceLabController };
