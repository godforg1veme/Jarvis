const { ObjectReconciler } = require('./objectReconciler');

class SceneStateStore {
  constructor(options = {}) {
    this.reconciler = options.reconciler || new ObjectReconciler();
    this.now = options.now || (() => Date.now());
    this.historyLimit = Number(options.historyLimit || 20);
    this.freshnessMs = Number(options.freshnessMs || 30_000);
    this.sources = new Map();
  }

  key(ownerId, deviceId, sourceId) { return `${ownerId}:${deviceId}:${sourceId}`; }

  update({ ownerId, deviceId, observation }) {
    const key = this.key(ownerId, deviceId, observation.sourceId);
    const previous = this.sources.get(key);
    const at = Date.parse(observation.observedAt) || this.now();
    const objects = this.reconciler.reconcile({ previous: previous?.objects || [], observed: observation.objects || [], at });
    const entry = {
      frameId: observation.frameId, capturedAt: observation.capturedAt,
      observedAt: observation.observedAt, sceneSummary: observation.sceneSummary,
      sensitivity: observation.sensitivity, confidence: observation.confidence,
      objects, events: (observation.events || []).slice(0, 20),
    };
    const history = [...(previous?.history || []), entry].slice(-this.historyLimit);
    const state = { sourceId: observation.sourceId, updatedAt: at, objects, history, current: entry };
    this.sources.set(key, state);
    return this.compact(state);
  }

  contextFor({ ownerId, deviceId, sourceId }) {
    const state = this.sources.get(this.key(ownerId, deviceId, sourceId));
    return state ? this.compact(state) : null;
  }

  compact(state) {
    const ageMs = Math.max(0, this.now() - state.updatedAt);
    return {
      sourceId: state.sourceId, observedAt: state.current.observedAt,
      fresh: ageMs <= this.freshnessMs, ageMs,
      sceneSummary: state.current.sceneSummary, confidence: state.current.confidence,
      objects: state.objects.slice(0, 20).map((item) => ({
        objectId: item.objectId, type: item.type, description: item.description,
        location: item.location, state: item.state, confidence: item.confidence,
      })),
      events: state.current.events, historyCount: state.history.length,
    };
  }

  clearDevice(ownerId, deviceId) {
    const prefix = `${ownerId}:${deviceId}:`;
    for (const key of this.sources.keys()) if (key.startsWith(prefix)) this.sources.delete(key);
  }
}

module.exports = { SceneStateStore };
