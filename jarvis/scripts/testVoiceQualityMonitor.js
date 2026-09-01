const assert = require('assert');
const { QualityMonitor, pcmRms } = require('../voice/qualityMonitor');
const { LocalCalibrator } = require('../voice/localCalibrator');
const { getSttSettings } = require('../voice/sttSettings');

function pcm(level, samples = 1600) {
  const value = Math.round(level * 32767);
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE(value, index * 2);
  return buffer;
}

const settings = getSttSettings();
const monitor = new QualityMonitor({ maxMeters: 20, maxResults: 10 });
assert(pcmRms(pcm(0.05)) > 0.049);

for (let index = 0; index < 6; index += 1) monitor.acceptPcm(pcm(0.002), settings);
for (let index = 0; index < 8; index += 1) monitor.acceptPcm(pcm(0.06), settings);
for (let index = 0; index < 5; index += 1) monitor.recordResult('открой стим');
monitor.recordResult('');
monitor.recordResult('');

const snapshot = monitor.snapshot();
assert(snapshot.meterCount <= 20);
assert(snapshot.noiseFloor > 0);
assert(snapshot.speechRms > snapshot.noiseFloor);
assert(snapshot.signalToNoiseDb > 6);
assert.strictEqual(snapshot.resultCount, 7);
assert.strictEqual(snapshot.emptyResults, 2);
assert(monitor.anomaly({ advisor: { minSamples: 5 } }));

const calibrationMonitor = new QualityMonitor();
const calibrator = new LocalCalibrator(calibrationMonitor);
calibrator.start();
for (let index = 0; index < 5; index += 1) calibrationMonitor.acceptPcm(pcm(0.002), settings);
calibrator.next();
for (let index = 0; index < 5; index += 1) calibrationMonitor.acceptPcm(pcm(0.06), settings);
const calibration = calibrator.finish(settings);
assert.strictEqual(calibration.step, 'complete');
assert(calibration.candidate.fasterWhisper.startRms > 0);
assert(calibration.candidate.fasterWhisper.continueRms > 0);

console.log('[test] Voice quality monitor and local calibration OK');
