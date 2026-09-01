const { SETTINGS_BOUNDS, validateSttSettings } = require('./sttSettings');

function clamp(value, bounds) {
  return Math.max(bounds[0], Math.min(bounds[1], value));
}

function proposeSettings(currentSettings, phases) {
  const current = validateSttSettings(currentSettings);
  const currentFw = current.fasterWhisper;
  const quiet = phases.quiet || {};
  const speech = phases.speech || {};
  const noiseRms = Number(quiet.noiseRms || quiet.peakRms || 0);
  const speechRms = Number(speech.speechRms || speech.peakRms || 0);

  if (quiet.meterCount < 3 || speech.meterCount < 3 || speechRms <= 0) {
    throw new Error('Недостаточно данных для калибровки. Повторите оба этапа ближе к микрофону.');
  }

  const safeNoise = Math.max(noiseRms, SETTINGS_BOUNDS.startRms[0] / 2);
  const safeSpeech = Math.max(speechRms, currentFw.startRms);
  const startRms = clamp(Math.max(safeNoise * 3, safeSpeech * 0.14), SETTINGS_BOUNDS.startRms);
  const continueRms = clamp(Math.min(startRms * 0.55, Math.max(safeNoise * 2, safeSpeech * 0.06)), SETTINGS_BOUNDS.continueRms);
  const preRollMs = clamp(
    Math.max(currentFw.preRollMs, speech.signalToNoiseDb >= 8 ? 450 : 300),
    SETTINGS_BOUNDS.preRollMs,
  );

  return validateSttSettings({
    ...current,
    fasterWhisper: {
      ...currentFw,
      startRms: Number(startRms.toFixed(6)),
      continueRms: Number(Math.min(continueRms, startRms).toFixed(6)),
      preRollMs: Math.round(preRollMs),
    },
  });
}

class LocalCalibrator {
  constructor(monitor) {
    this.monitor = monitor;
    this.cancel();
  }

  start() {
    this.active = true;
    this.step = 'quiet';
    this.phases = {};
    this.candidate = null;
    this.monitor.beginPhase('quiet');
    return this.getState();
  }

  next() {
    if (!this.active) throw new Error('Калибровка не запущена.');
    if (this.step === 'quiet') {
      this.phases.quiet = this.monitor.endPhase();
      this.step = 'speech';
      this.monitor.beginPhase('speech');
      return this.getState();
    }
    throw new Error('Сейчас нужно завершить этап с голосом.');
  }

  finish(currentSettings) {
    if (!this.active || this.step !== 'speech') throw new Error('Сначала пройдите этапы калибровки.');
    this.phases.speech = this.monitor.endPhase();
    this.candidate = proposeSettings(currentSettings, this.phases);
    this.active = false;
    this.step = 'complete';
    return {
      ...this.getState(),
      candidate: this.candidate,
      phases: this.phases,
    };
  }

  cancel() {
    if (this.monitor && this.monitor.phase) this.monitor.endPhase();
    this.active = false;
    this.step = 'idle';
    this.phases = {};
    this.candidate = null;
  }

  getState() {
    return {
      active: this.active,
      step: this.step,
      phases: this.phases,
      candidate: this.candidate,
    };
  }
}

module.exports = {
  LocalCalibrator,
  proposeSettings,
};
