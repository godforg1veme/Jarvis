const crypto = require('node:crypto');

const { validateResponse } = require('../operations/hostAgentProtocol');
const { safeHostData } = require('./vpnCommandService');

class VpnRecoveryWorker {
  constructor(options = {}) {
    this.repository = options.repository;
    this.client = options.client;
    this.clients = options.clients || (options.client ? { de: options.client } : {});
    this.logger = options.logger || { warn() {}, info() {} };
    this.intervalMs = Math.min(Math.max(Number(options.intervalMs || 30_000), 5_000), 300_000);
    this.now = options.now || (() => new Date());
    this.timer = null;
    this.running = false;
  }

  async reconcile(record) {
    // Probe credential handoff spans two hosts.  A connection loss can leave
    // either side changed, so it is intentionally never replayed or inferred.
    if (record.action === 'probe.install' || record.action === 'probe.rotate') return false;
    const node = record.arguments?.node === 'nl' ? 'nl' : 'de';
    const client = this.clients[node] || (node === 'de' ? this.client : null);
    if (!client) throw new Error(`VPN recovery client unavailable for ${node}`);
    const response = await client.request({
      version: 1,
      requestId: crypto.randomUUID(),
      operation: 'operation.status',
      arguments: { requestId: record.id },
      sentAt: this.now().toISOString(),
    });
    const original = response.result.state === 'succeeded'
      ? response.result.data?.response
      : null;
    if (!original) return false;

    let validated;
    try {
      validated = validateResponse(original);
    } catch (_) {
      await this.repository.complete({ requestId: record.id, status: 'failed', errorCode: 'HOST_AGENT_RESPONSE_INVALID' });
      await this.repository.audit({
        userId: record.user_id,
        requestId: record.id,
        type: 'vpn.action.recovery_failed',
        metadata: { action: record.action, node, errorCode: 'HOST_AGENT_RESPONSE_INVALID' },
      });
      return true;
    }

    const state = validated.result.state;
    if (state === 'unknown' || state === 'accepted') return false;
    const success = state === 'succeeded';
    const errorCode = validated.result.errorCode || null;
    await this.repository.complete({
      requestId: record.id,
      status: success ? 'succeeded' : 'failed',
      result: safeHostData(validated.result.data || {}),
      errorCode,
    });
    await this.repository.audit({
      userId: record.user_id,
      requestId: record.id,
      type: success ? 'vpn.action.recovered' : 'vpn.action.recovery_failed',
      metadata: { action: record.action, node, errorCode },
    });
    return true;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const records = await this.repository.recoverable();
      for (const record of records) {
        try {
          await this.reconcile(record);
        } catch (error) {
          this.logger.warn({ err: error, requestId: record.id }, 'VPN action reconciliation failed');
        }
      }
    } finally {
      this.running = false;
    }
  }

  start() {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { VpnRecoveryWorker };
