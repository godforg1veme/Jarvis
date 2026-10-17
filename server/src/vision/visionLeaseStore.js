const { randomUUID } = require('node:crypto');
const { requiredId, validateVisionSource } = require('./visionSchemas');
const { visionError } = require('./visionErrors');

const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const MAX_LEASE_MS = 60 * 60 * 1000;
const REQUEST_TTL_MS = 2 * 60 * 1000;

class VisionLeaseStore {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now());
    this.id = options.id || (() => randomUUID());
    this.maxLeases = options.maxLeases ?? 1000;
    this.maxRequestsPerLease = options.maxRequestsPerLease ?? 256;
    if (![this.maxLeases, this.maxRequestsPerLease].every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new TypeError('invalid vision store capacity');
    }
    this.leases = new Map();
    this.leaseSweepCursor = this.leases.entries();
  }

  sweepLeases(now, preserveId) {
    const budget = Math.min(32, this.leases.size);
    for (let i = 0; i < budget; i += 1) {
      let item = this.leaseSweepCursor.next();
      if (item.done) {
        this.leaseSweepCursor = this.leases.entries();
        item = this.leaseSweepCursor.next();
      }
      if (item.done) break;
      const [id, lease] = item.value;
      if (id !== preserveId && (lease.state !== 'active' || now >= lease.expiresAt)) this.leases.delete(id);
    }
  }

  sweepRequests(lease, now, preserveId) {
    const budget = Math.min(32, lease.requests.size);
    for (let i = 0; i < budget; i += 1) {
      let item = lease.requestSweepCursor.next();
      if (item.done) {
        lease.requestSweepCursor = lease.requests.entries();
        item = lease.requestSweepCursor.next();
      }
      if (item.done) break;
      const [id, request] = item.value;
      // Keep consumed IDs until expiry so cleanup cannot weaken the replay guard.
      if (id !== preserveId && now >= request.expiresAt) lease.requests.delete(id);
    }
  }

  getStats() {
    // Only aggregate counts, on explicit inspection; never include device/owner IDs.
    let requests = 0;
    for (const lease of this.leases.values()) requests += lease.requests.size;
    return { leases: this.leases.size, requests, maxLeases: this.maxLeases, maxRequestsPerLease: this.maxRequestsPerLease };
  }

  create({ ownerId, deviceId, sources, durationMs = DEFAULT_LEASE_MS }) {
    const normalizedSources = sources.map(validateVisionSource);
    if (normalizedSources.length === 0 || normalizedSources.length > 8) {
      throw visionError(400, 'VISION_SOURCES_INVALID');
    }
    if (new Set(normalizedSources.map((source) => source.sourceId)).size !== normalizedSources.length) {
      throw visionError(400, 'VISION_SOURCES_INVALID');
    }
    const boundedDuration = Math.min(Math.max(Number(durationMs) || DEFAULT_LEASE_MS, 30_000), MAX_LEASE_MS);
    const createdAt = this.now();
    this.sweepLeases(createdAt);
    if (this.leases.size >= this.maxLeases) throw visionError(503, 'VISION_LEASE_CAPACITY');
    const lease = {
      id: this.id(), ownerId: requiredId(ownerId, 'vision owner id'),
      deviceId: requiredId(deviceId, 'vision device id'), sources: normalizedSources,
      state: 'active', createdAt, expiresAt: createdAt + boundedDuration,
      requests: new Map(), lastSequence: new Map(),
      sensitiveConsent: new Map(),
    };
    lease.requestSweepCursor = lease.requests.entries();
    this.leases.set(lease.id, lease);
    return this.publicLease(lease);
  }

  getAuthorized(leaseId, device, options = {}) {
    const normalizedId = requiredId(leaseId, 'vision lease id');
    // Preserve the requested record's scope/expiry errors; reclaimed IDs remain unusable.
    this.sweepLeases(this.now(), normalizedId);
    const lease = this.leases.get(normalizedId);
    if (!lease) throw visionError(404, 'VISION_LEASE_NOT_FOUND');
    if (String(device.user_id) !== lease.ownerId) throw visionError(403, 'VISION_OWNER_MISMATCH');
    if (!options.allowOwnerClient && String(device.id) !== lease.deviceId) {
      throw visionError(403, 'VISION_DEVICE_MISMATCH');
    }
    if (lease.state !== 'active') throw visionError(409, 'VISION_LEASE_INACTIVE');
    if (this.now() >= lease.expiresAt) {
      lease.state = 'expired';
      throw visionError(410, 'VISION_LEASE_EXPIRED');
    }
    return lease;
  }

  createRequest({ leaseId, device, sourceId, mode = 'focused', prompt = '' }) {
    const lease = this.getAuthorized(leaseId, device);
    const normalizedSourceId = requiredId(sourceId, 'vision source id');
    if (!lease.sources.some((source) => source.sourceId === normalizedSourceId && source.active)) {
      throw visionError(400, 'VISION_SOURCE_NOT_ACTIVE');
    }
    this.sweepRequests(lease, this.now());
    if (lease.requests.size >= this.maxRequestsPerLease) throw visionError(503, 'VISION_REQUEST_CAPACITY');
    const request = {
      id: this.id(), sourceId: normalizedSourceId, mode,
      prompt: String(prompt || '').trim().slice(0, 4000),
      createdAt: this.now(), expiresAt: Math.min(lease.expiresAt, this.now() + REQUEST_TTL_MS),
      consumed: false,
    };
    lease.requests.set(request.id, request);
    return { captureRequestId: request.id, expiresAt: new Date(request.expiresAt).toISOString() };
  }

  acceptFrame({ leaseId, device, metadata }) {
    const lease = this.getAuthorized(leaseId, device);
    if (metadata.leaseId !== lease.id) throw visionError(400, 'VISION_LEASE_MISMATCH');
    this.sweepRequests(lease, this.now(), metadata.captureRequestId);
    const request = lease.requests.get(metadata.captureRequestId);
    if (!request || request.sourceId !== metadata.sourceId || request.mode !== metadata.mode) {
      throw visionError(409, 'VISION_CAPTURE_REQUEST_INVALID');
    }
    if (request.consumed) throw visionError(409, 'VISION_CAPTURE_REPLAY');
    if (this.now() >= request.expiresAt) throw visionError(410, 'VISION_CAPTURE_REQUEST_EXPIRED');
    const previous = lease.lastSequence.get(metadata.sourceId);
    if (previous !== undefined && metadata.sequence <= previous) {
      throw visionError(409, 'VISION_SEQUENCE_REPLAY');
    }
    request.consumed = true;
    lease.lastSequence.set(metadata.sourceId, metadata.sequence);
    return { lease, request };
  }

  stop({ leaseId, device }) {
    const lease = this.getAuthorized(leaseId, device);
    lease.state = 'off';
    lease.requests.clear();
    return this.publicLease(lease);
  }

  getSensitiveConsent(lease, sourceId) {
    return lease.sensitiveConsent.has(sourceId) ? lease.sensitiveConsent.get(sourceId) : null;
  }

  setSensitiveConsent({ leaseId, device, sourceId, allow }) {
    const lease = this.getAuthorized(leaseId, device);
    const normalized = requiredId(sourceId, 'vision source id');
    if (!lease.sources.some((source) => source.sourceId === normalized)) throw visionError(400, 'VISION_SOURCE_NOT_ACTIVE');
    lease.sensitiveConsent.set(normalized, allow === true);
  }

  publicLease(lease) {
    return {
      leaseId: lease.id, state: lease.state,
      createdAt: new Date(lease.createdAt).toISOString(),
      expiresAt: new Date(lease.expiresAt).toISOString(),
      sources: lease.sources,
    };
  }
}

module.exports = { DEFAULT_LEASE_MS, MAX_LEASE_MS, REQUEST_TTL_MS, VisionLeaseStore };
