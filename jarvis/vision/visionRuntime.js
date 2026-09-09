const crypto = require('node:crypto');
const { VisionPrivacyController } = require('./visionPrivacyController');

function errorResult(error, fallback) {
  return { ok: false, error: fallback, code: String(error?.code || 'VISION_FAILED').slice(0, 80) };
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
    this.workspaceDisplayIds = [];
    this.sequence = new Map();
    this.preview = null;
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
    return { ...snapshot, sources: this.sourceRegistry.listPublic(), preview: this.preview };
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
    await this.camera.stop().catch(() => {});
    this.sourceRegistry.setActive([]);
    this.preview = null;
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

  async _captureSource(source, prompt) {
    const leaseId = this.privacy.getState().leaseId;
    const request = await this.transport.requestCapture(leaseId, { sourceId: source.sourceId, mode: 'focused', prompt });
    const frame = source.type === 'camera'
      ? await this.camera.capture()
      : await this.screenCapture.captureWorkspace(this.workspaceDisplayIds, { workspaceSourceId: source.sourceId });
    const sequence = (this.sequence.get(source.sourceId) || 0) + 1;
    this.sequence.set(source.sourceId, sequence);
    const metadata = {
      version: 1, leaseId, captureRequestId: request.captureRequestId,
      frameId: `frame-${crypto.randomUUID()}`, sourceId: source.sourceId, sequence,
      capturedAt: frame.capturedAt, mode: 'focused', contentType: frame.contentType,
      byteLength: frame.bytes.length, width: frame.width, height: frame.height,
      focusedReason: 'explicit_user_request',
    };
    const uploaded = await this.transport.uploadFrame(leaseId, metadata, frame.bytes);
    this.preview = { sourceId: source.sourceId, contentType: frame.contentType, dataUrl: `data:${frame.contentType};base64,${frame.bytes.toString('base64')}`, capturedAt: frame.capturedAt };
    this.emitState(this.publicState());
    return { observation: uploaded.observation, memory: uploaded.memory };
  }

  async analyze({ prompt = 'Что ты видишь?', sourceId = '', target = 'all', origin = 'local' } = {}) {
    const device = this.getDeviceState();
    try {
      this.privacy.use({ ownerId: device.deviceId, origin });
      const active = this.sourceRegistry.listLocal().filter((source) => source.active);
      const selected = sourceId ? active.filter((source) => source.sourceId === sourceId)
        : target === 'camera' ? active.filter((source) => source.type === 'camera')
        : target === 'screen' ? active.filter((source) => source.type === 'screen_workspace') : active;
      if (!selected.length) throw new Error('Выбранный источник не активен.');
      const observations = [];
      const captures = [];
      for (const source of selected) captures.push(await this._captureSource(source, prompt));
      observations.push(...captures.map((item) => item.observation));
      if (this.privacy.getState().kind === 'short') this.privacy.markAnswerComplete({ ownerId: device.deviceId });
      return {
        ok: true, observations,
        retentionConsentSources: captures.filter((item) => item.memory?.retentionConsentRequired).map((item) => item.observation.sourceId),
        answer: observations.map((item) => item.sceneSummary).join('\n\n'),
      };
    } catch (error) { return errorResult(error, 'Не удалось проанализировать изображение.'); }
  }

  async stop(reason = 'user_stop') {
    const leaseId = this.privacy.getState().leaseId;
    await this.privacy.stop(reason);
    if (leaseId) await this.transport.stopLease(leaseId).catch(() => {});
    this.sequence.clear();
    return { ok: true, state: this.publicState() };
  }


  async setSensitiveConsent(sourceId, allow) {
    const leaseId = this.privacy.getState().leaseId;
    if (!leaseId) throw new Error('vision lease is not active');
    return this.transport.setSensitiveConsent(leaseId, sourceId, allow);
  }

  async close() {
    clearInterval(this.expiryTimer);
    await this.stop('app_shutdown');
    await this.camera.close();
  }
}

module.exports = { VisionRuntime, errorResult };
