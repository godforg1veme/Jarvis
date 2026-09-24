const crypto = require('node:crypto');
const { VisionPrivacyController } = require('./visionPrivacyController');
const { FrameSampler } = require('./frameSampler');
const { SceneChangeDetector } = require('./sceneChangeDetector');

function errorResult(error, fallback) {
  const code = String(error?.code || 'VISION_FAILED').slice(0, 80);
  const publicMessage = code === 'VISION_PRIVACY_PAUSED'
    ? 'Vision приостановлен: на экране открыто защищённое приложение.'
    : code === 'VISION_CAPTURE_CANCELLED' ? 'Визуальный анализ остановлен.' : fallback;
  return { ok: false, error: publicMessage, code };
}

class VisionRuntime {
  constructor(options = {}) {
    for (const name of ['sourceRegistry', 'camera', 'screenCapture', 'transport', 'getDeviceState']) {
      if (!options[name]) throw new Error(`VisionRuntime requires ${name}`);
    }
    this.sourceRegistry = options.sourceRegistry;
    this.camera = options.camera;
    this.screenCapture = options.screenCapture;
    this.transport = options.transport;
    this.getDeviceState = options.getDeviceState;
    this.emitState = options.emitState || (() => {});
    this.emitSensitiveConsentRequired = options.emitSensitiveConsentRequired || (() => {});
    this.workspaceDisplayIds = [];
    this.sequence = new Map();
    this.preview = null;
    this.lastObservationAt = null;
    this.lastTemporalError = '';
    this.lastRemoteUseAt = null;
    this.temporalRetryAt = 0;
    this.temporalBusy = false;
    this.focusedInFlight = 0;
    this.captureEpoch = 0;
    this.pendingConsentSources = new Set();
    this.activeUploads = new Set();
    this.sampler = options.sampler || new FrameSampler();
    this.changeDetector = options.changeDetector || new SceneChangeDetector();
    this.temporalTimer = setInterval(() => { void this._pollTemporal(); }, Number(options.temporalPollMs || 500));
    if (typeof this.temporalTimer.unref === 'function') this.temporalTimer.unref();
    this.expiryTimer = setInterval(() => {
      this.privacy.checkExpiry().catch(() => {});
    }, Number(options.expiryPollMs || 1000));
    if (typeof this.expiryTimer.unref === 'function') this.expiryTimer.unref();
    this.privacy = options.privacy || new VisionPrivacyController({
      onState: (state) => this.emitState(this.publicState(state)),
      openSources: ({ sources }) => this._openSources(sources),
      closeSources: () => this._closeSources(),
    });
  }

  publicState(snapshot = this.privacy.getState()) {
    return {
      ...snapshot,
      sources: this.sourceRegistry.listPublic(),
      preview: this.preview,
      lastObservationAt: this.lastObservationAt,
      lastTemporalError: this.lastTemporalError,
      pendingSensitiveSourceIds: [...this.pendingConsentSources],
      lastRemoteUseAt: this.lastRemoteUseAt,
    };
  }

  async discover(options = {}) {
    const [cameras, displays] = await Promise.all([this.camera.listCameras({ requestPermission: options.requestCameraAccess === true }), Promise.resolve(this.screenCapture.listDisplays())]);
    let workspace = null;
    if (displays.length) {
      workspace = this.sourceRegistry.upsert({ type: 'screen_workspace', nativeId: 'all-displays', label: 'All displays', available: true });
      this.workspaceDisplayIds = displays.map((source) => source.sourceId);
    }
    return { ok: true, cameras: cameras.map((source) => ({ sourceId: source.sourceId, label: source.label || 'Камера' })), displays: displays.map((source) => ({ sourceId: source.sourceId, label: source.label })), workspace: workspace ? { sourceId: workspace.sourceId, label: 'Оба монитора' } : null };
  }

  async _openSources(sources) {
    this.sourceRegistry.setActive(sources.map((source) => source.sourceId));
    const camera = sources.find((source) => source.type === 'camera');
    if (camera) await this.camera.start(camera.sourceId);
  }

  async _closeSources() {
    this.captureEpoch += 1;
    for (const controller of this.activeUploads) controller.abort();
    this.activeUploads.clear();
    await this.camera.stop().catch(() => {});
    this.sourceRegistry.setActive([]);
    this.preview = null;
    this.sampler.reset();
    this.changeDetector.reset();
    this.pendingConsentSources.clear();
    this.temporalRetryAt = 0;
  }

  async start({ cameraSourceId, includeCamera = Boolean(cameraSourceId), includeScreens = true, kind = 'active' } = {}) {
    const device = this.getDeviceState();
    if (!device?.paired || !device.deviceId) return { ok: false, error: 'Сначала подключите Desktop к Jarvis.' };
    if (this.privacy.getState().state !== 'off') return { ok: true, state: this.publicState() };
    try {
      const discovered = await this.discover({ requestCameraAccess: includeCamera });
      const sources = [];
      const selectedCameraId = cameraSourceId || (includeCamera
        ? (discovered.cameras.find((item) => /camo/iu.test(item.label)) || discovered.cameras[0])?.sourceId : '');
      if (includeCamera && !selectedCameraId) {
        throw new Error('Камера не найдена. Запустите Camo Studio и убедитесь, что телефон подключён.');
      }
      if (selectedCameraId) sources.push(this.sourceRegistry.requireLocal(selectedCameraId));
      if (includeScreens) {
        const workspace = this.sourceRegistry.listLocal().find((source) => source.type === 'screen_workspace' && source.available);
        if (workspace) sources.push(workspace);
      }
      if (!sources.length) throw new Error('Не найдено доступных источников зрения.');
      const publicSources = sources.map((source) => ({ sourceId: source.sourceId, type: source.type, active: true, available: true, protected: false }));
      const remote = await this.transport.createLease({ sources: publicSources, durationMs: kind === 'short' ? 30_000 : 60 * 60 * 1000 });
      try {
        await this.privacy.startLocal({ explicitIntent: true, ownerId: device.deviceId, leaseId: remote.leaseId, kind, sources: publicSources });
      } catch (error) {
        await this.transport.stopLease(remote.leaseId).catch(() => {});
        throw error;
      }
      return { ok: true, state: this.publicState() };
    } catch (error) { return errorResult(error, error.message || 'Не удалось включить зрение.'); }
  }

  async _captureLocal(source) {
    return source.type === 'camera'
      ? this.camera.capture()
      : this.screenCapture.captureWorkspace(this.workspaceDisplayIds, { workspaceSourceId: source.sourceId });
  }

  _assertCaptureCurrent(epoch) {
    if (epoch !== this.captureEpoch || this.privacy.getState().state !== 'active') {
      const error = new Error('vision capture was cancelled');
      error.code = 'VISION_CAPTURE_CANCELLED';
      throw error;
    }
  }

  async _uploadFrame(source, prompt, mode, frame, decision = {}, epoch = this.captureEpoch) {
    this._assertCaptureCurrent(epoch);
    const leaseId = this.privacy.getState().leaseId;
    const request = await this.transport.requestCapture(leaseId, { sourceId: source.sourceId, mode, prompt });
    this._assertCaptureCurrent(epoch);
    const sequence = (this.sequence.get(source.sourceId) || 0) + 1;
    this.sequence.set(source.sourceId, sequence);
    const metadata = {
      version: 1, leaseId, captureRequestId: request.captureRequestId,
      frameId: `frame-${crypto.randomUUID()}`, sourceId: source.sourceId, sequence,
      capturedAt: frame.capturedAt, mode, contentType: frame.contentType,
      byteLength: frame.bytes.length, width: frame.width, height: frame.height,
      ...(mode === 'focused' ? { focusedReason: 'explicit_user_request' } : {}),
      ...(Number.isFinite(decision.changeScore) ? { changeScore: Math.max(0, Math.min(decision.changeScore, 1)) } : {}),
    };
    const controller = new AbortController();
    this.activeUploads.add(controller);
    let uploaded;
    try {
      uploaded = await this.transport.uploadFrame(leaseId, metadata, frame.bytes, { signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        const cancelled = new Error('vision capture was cancelled');
        cancelled.code = 'VISION_CAPTURE_CANCELLED';
        throw cancelled;
      }
      throw error;
    } finally {
      this.activeUploads.delete(controller);
    }
    this.preview = { sourceId: source.sourceId, contentType: frame.contentType, dataUrl: `data:${frame.contentType};base64,${frame.bytes.toString('base64')}`, capturedAt: frame.capturedAt };
    this.lastObservationAt = uploaded.observation?.observedAt || new Date().toISOString();
    this.lastTemporalError = '';
    this.temporalRetryAt = 0;
    if (mode === 'temporal' && uploaded.memory?.retentionConsentRequired
      && !this.pendingConsentSources.has(source.sourceId)) {
      this.pendingConsentSources.add(source.sourceId);
      this.emitSensitiveConsentRequired({ sourceIds: [source.sourceId] });
    }
    this.emitState(this.publicState());
    return { observation: uploaded.observation, memory: uploaded.memory };
  }

  async _captureSource(source, prompt) {
    const epoch = this.captureEpoch;
    const frame = await this._captureLocal(source);
    const budget = this.sampler.consider({ sourceId: source.sourceId, mode: 'focused' });
    if (!budget.send) {
      const error = new Error('vision focused capture rate limited');
      error.code = 'VISION_RATE_LIMITED';
      throw error;
    }
    return this._uploadFrame(source, prompt, 'focused', frame, {}, epoch);
  }

  async _pollTemporal() {
    if (this.temporalBusy || this.focusedInFlight > 0 || Date.now() < this.temporalRetryAt
      || this.privacy.getState().state !== 'active' || this.privacy.getState().kind !== 'active') return;
    this.temporalBusy = true;
    try {
      for (const source of this.sourceRegistry.listLocal().filter((item) => item.active)) {
        try {
          const epoch = this.captureEpoch;
          const frame = await this._captureLocal(source);
          this._assertCaptureCurrent(epoch);
          const decision = this.changeDetector.consider({ sourceId: source.sourceId, signature: frame.signature });
          if (!decision.send) continue;
          const budget = this.sampler.consider({ sourceId: source.sourceId, mode: 'temporal' });
          if (!budget.send) {
            this.changeDetector.reset(source.sourceId);
            continue;
          }
          await this._uploadFrame(source, 'Track meaningful changes in the scene.', 'temporal', frame, decision, epoch);
        } catch (error) {
          this.changeDetector.reset(source.sourceId);
          this.lastTemporalError = String(error?.code || 'VISION_TEMPORAL_FAILED').slice(0, 80);
          this.temporalRetryAt = Date.now() + (this.lastTemporalError === 'VISION_PRIVACY_PAUSED' ? 5000 : 2000);
        }
      }
      if (this.lastTemporalError) this.emitState(this.publicState());
    } catch (error) {
      this.lastTemporalError = String(error?.code || 'VISION_TEMPORAL_FAILED').slice(0, 80);
      this.emitState(this.publicState());
    } finally {
      this.temporalBusy = false;
    }
  }

  async analyze({ prompt = 'Что ты видишь?', sourceId = '', target = 'all', origin = 'local' } = {}) {
    const device = this.getDeviceState();
    let focusedReserved = false;
    try {
      this.privacy.use({ ownerId: device.deviceId, origin });
      if (origin === 'remote') {
        this.lastRemoteUseAt = new Date().toISOString();
        this.emitState(this.publicState());
      }
      const active = this.sourceRegistry.listLocal().filter((source) => source.active);
      const selected = sourceId ? active.filter((source) => source.sourceId === sourceId)
        : target === 'camera' ? active.filter((source) => source.type === 'camera')
        : target === 'screen' ? active.filter((source) => source.type === 'screen_workspace') : active;
      if (!selected.length) throw new Error('Выбранный источник не активен.');
      const observations = [];
      const captures = [];
      this.focusedInFlight += 1;
      focusedReserved = true;
      for (const source of selected) captures.push(await this._captureSource(source, prompt));
      observations.push(...captures.map((item) => item.observation));
      if (this.privacy.getState().kind === 'short') this.privacy.markAnswerComplete({ ownerId: device.deviceId });
      return {
        ok: true, observations,
        retentionConsentSources: captures.filter((item) => item.memory?.retentionConsentRequired).map((item) => item.observation.sourceId),
        answer: observations.map((item) => item.sceneSummary).join('\n\n'),
      };
    } catch (error) { return errorResult(error, 'Не удалось проанализировать изображение.'); }
    finally { if (focusedReserved) this.focusedInFlight = Math.max(0, this.focusedInFlight - 1); }
  }

  async stop(reason = 'user_stop') {
    const leaseId = this.privacy.getState().leaseId;
    await this.privacy.stop(reason);
    if (leaseId) await this.transport.stopLease(leaseId).catch(() => {});
    this.sequence.clear();
    this.lastTemporalError = '';
    this.lastRemoteUseAt = null;
    this.temporalRetryAt = 0;
    return { ok: true, state: this.publicState() };
  }


  async setSensitiveConsent(sourceId, allow) {
    const leaseId = this.privacy.getState().leaseId;
    if (!leaseId) throw new Error('vision lease is not active');
    const result = await this.transport.setSensitiveConsent(leaseId, sourceId, allow);
    this.pendingConsentSources.delete(sourceId);
    this.emitState(this.publicState());
    return result;
  }

  async close() {
    clearInterval(this.expiryTimer);
    clearInterval(this.temporalTimer);
    await this.stop('app_shutdown');
    await this.camera.close();
  }
}

module.exports = { VisionRuntime, errorResult };
