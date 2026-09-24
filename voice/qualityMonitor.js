const DEFAULT_MAX_METERS = 240;
const DEFAULT_MAX_RESULTS = 100;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = clamp(Math.round((sorted.length - 1) * fraction), 0, sorted.length - 1);
  return sorted[index];
}

function pcmRms(pcmBuffer) {
  if (!pcmBuffer || pcmBuffer.length < 2) return 0;
  const samples = Buffer.isBuffer(pcmBuffer)
    ? new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, Math.floor(pcmBuffer.length / 2))
    : new Int16Array(pcmBuffer);
  if (!samples.length) return 0;

  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const normalized = samples[index] / 32768;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / samples.length);
}

function summarizeMeters(meters) {
  const rmsValues = meters.map((item) => item.rms);
  const noiseValues = meters.filter((item) => item.state !== 'speech').map((item) => item.rms);
  const speechValues = meters.filter((item) => item.state === 'speech').map((item) => item.rms);
  const noiseRms = noiseValues.length ? percentile(noiseValues, 0.5) : 0;
  const speechRms = speechValues.length ? percentile(speechValues, 0.75) : 0;
  const signalToNoise = noiseRms > 0 && speechRms > 0
    ? 20 * Math.log10(speechRms / noiseRms)
    : 0;

  return {
    noiseRms,
    speechRms,
    peakRms: rmsValues.length ? Math.max(...rmsValues) : 0,
    signalToNoiseDb: Number.isFinite(signalToNoise) ? Number(signalToNoise.toFixed(2)) : 0,
    meterCount: meters.length,
  };
}

class QualityMonitor {
  constructor(options = {}) {
    this.maxMeters = Number(options.maxMeters || DEFAULT_MAX_METERS);
    this.maxResults = Number(options.maxResults || DEFAULT_MAX_RESULTS);
    this.reset();
  }

  reset() {
    this.startedAt = Date.now();
    this.meters = [];
    this.results = [];
    this.segments = [];
    this.workerErrors = 0;
    this.inputDrops = 0;
    this.noiseFloor = 0.004;
    this.speechRms = 0;
    this.lastMeter = null;
    this.lastAdvisorFingerprint = '';
    this.lastAdvisorAt = 0;
    this.phase = null;
    this.phaseMeters = [];
  }

  acceptPcm(pcmBuffer, settings = {}) {
    const rms = pcmRms(pcmBuffer);
    const fw = settings.fasterWhisper || {};
    const startRms = Number(fw.startRms || 0.022);
    const continueRms = Number(fw.continueRms || 0.012);
    const previousNoiseFloor = this.noiseFloor;
    let state = 'silence';

    if (rms >= startRms) {
      state = 'speech';
      this.speechRms = this.speechRms === 0 ? rms : (this.speechRms * 0.85) + (rms * 0.15);
    } else if (rms >= Math.max(continueRms, previousNoiseFloor * 1.8)) {
      state = 'noise';
    }

    if (state !== 'speech') {
      this.noiseFloor = (this.noiseFloor * 0.92) + (rms * 0.08);
    }

    const signalToNoise = this.noiseFloor > 0 && this.speechRms > 0
      ? 20 * Math.log10(this.speechRms / this.noiseFloor)
      : 0;
    const meter = {
      timestamp: Date.now(),
      rms: Number(rms.toFixed(6)),
      noiseFloor: Number(this.noiseFloor.toFixed(6)),
      speechRms: Number(this.speechRms.toFixed(6)),
      signalToNoiseDb: Number.isFinite(signalToNoise) ? Number(signalToNoise.toFixed(2)) : 0,
      state,
    };

    this.meters.push(meter);
    if (this.meters.length > this.maxMeters) this.meters.shift();
    if (this.phase) this.phaseMeters.push(meter);
    this.lastMeter = meter;
    return meter;
  }

  recordResult(text) {
    const normalized = String(text || '').trim();
    this.results.push({ timestamp: Date.now(), empty: !normalized });
    if (this.results.length > this.maxResults) this.results.shift();
  }

  recordSegment(segment = {}) {
    this.segments.push({
      timestamp: Date.now(),
      totalMs: Number(segment.totalMs || 0),
      speechMs: Number(segment.speechMs || 0),
      silenceMs: Number(segment.silenceMs || 0),
    });
    if (this.segments.length > this.maxResults) this.segments.shift();
    if (segment.resultEmpty === true) this.recordResult('');
  }

  recordWorkerError() {
    this.workerErrors += 1;
  }

  recordInputDrop(count = 1) {
    const normalized = Number(count);
    if (Number.isFinite(normalized) && normalized > 0) this.inputDrops += normalized;
  }

  beginPhase(name) {
    this.phase = String(name || 'sample');
    this.phaseMeters = [];
  }

  endPhase() {
    const name = this.phase;
    const summary = summarizeMeters(this.phaseMeters);
    this.phase = null;
    this.phaseMeters = [];
    return { name, ...summary };
  }

  snapshot() {
    const summary = summarizeMeters(this.meters);
    const resultCount = this.results.length;
    const emptyResults = this.results.filter((item) => item.empty).length;
    const emptyRate = resultCount ? emptyResults / resultCount : 0;
    const shortSegments = this.segments.filter((item) => item.totalMs > 0 && item.totalMs < 1000).length;
    const quality = summary.meterCount === 0
      ? 'unknown'
      : summary.signalToNoiseDb >= 12
        ? 'good'
        : summary.signalToNoiseDb >= 6
          ? 'fair'
          : 'poor';

    return {
      ...summary,
      noiseFloor: Number(this.noiseFloor.toFixed(6)),
      current: this.lastMeter,
      quality,
      resultCount,
      emptyResults,
      emptyRate: Number(emptyRate.toFixed(3)),
      segmentCount: this.segments.length,
      shortSegments,
      workerErrors: this.workerErrors,
      inputDrops: this.inputDrops,
      phase: this.phase,
      startedAt: this.startedAt,
    };
  }

  anomaly(settings = {}) {
    const advisor = settings.advisor || {};
    const snapshot = this.snapshot();
    const minSamples = Number(advisor.minSamples || 20);
    if (snapshot.resultCount < minSamples) return null;

    const reasons = [];
    if (snapshot.emptyRate >= 0.25) reasons.push('много пустых результатов распознавания');
    if (snapshot.segmentCount >= minSamples && snapshot.shortSegments / snapshot.segmentCount >= 0.25) {
      reasons.push('фразы часто завершаются слишком рано');
    }
    if (snapshot.quality === 'poor') reasons.push('низкое отношение голоса к шуму');
    if (snapshot.inputDrops > 0) reasons.push('часть аудио не успевает обработаться');
    if (snapshot.workerErrors > 0) reasons.push('ошибки STT-процесса');
    if (!reasons.length) return null;

    return {
      reasons,
      snapshot,
      createdAt: Date.now(),
    };
  }

  shouldRequestAdvisor(settings = {}) {
    const advisor = settings.advisor || {};
    if (advisor.mode !== 'problems-only') return false;
    const anomaly = this.anomaly(settings);
    if (!anomaly) return false;
    const fingerprint = JSON.stringify({
      quality: anomaly.snapshot.quality,
      emptyRate: anomaly.snapshot.emptyRate,
      inputDrops: anomaly.snapshot.inputDrops,
      workerErrors: anomaly.snapshot.workerErrors,
      startRms: settings.fasterWhisper?.startRms,
      continueRms: settings.fasterWhisper?.continueRms,
    });
    const cooldownMs = Number(advisor.cooldownMs || 1800000);
    if (Date.now() - this.lastAdvisorAt < cooldownMs) return false;
    if (fingerprint === this.lastAdvisorFingerprint) return false;
    return true;
  }

  markAdvisorRequested(settings = {}) {
    const snapshot = this.snapshot();
    this.lastAdvisorFingerprint = JSON.stringify({
      quality: snapshot.quality,
      emptyRate: snapshot.emptyRate,
      inputDrops: snapshot.inputDrops,
      workerErrors: snapshot.workerErrors,
      startRms: settings.fasterWhisper?.startRms,
      continueRms: settings.fasterWhisper?.continueRms,
    });
    this.lastAdvisorAt = Date.now();
  }
}

module.exports = {
  QualityMonitor,
  pcmRms,
  summarizeMeters,
};
