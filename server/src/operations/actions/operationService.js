const crypto = require('node:crypto');

function hash(value) { return crypto.createHash('sha256').update(value).digest(); }
class OperationService {
  constructor(options) { this.repository = options.repository; this.client = options.client; this.hostId = options.hostId; }
  async serviceAction({ sessionId, serviceKey, action, idempotencyKey }) {
    const service = await this.repository.serviceCapability({ hostId: this.hostId, serviceKey, action });
    if (!service) { const error = new Error('service action is disabled'); error.code = 'SERVICE_ACTION_DISABLED'; throw error; }
    const operation = `service.${action}`;
    const fingerprint = hash(JSON.stringify({ operation, serviceKey }));
    const record = await this.repository.createOrGet({ id: crypto.randomUUID(), sessionId, hostId: this.hostId, operation, targetKey: serviceKey, idempotencyHash: hash(idempotencyKey), fingerprint });
    if (!record) throw new Error('operation record was not created');
    if (!Buffer.from(record.request_fingerprint).equals(fingerprint)) { const error = new Error('idempotency key conflict'); error.code = 'IDEMPOTENCY_CONFLICT'; throw error; }
    if (!record.created) return record;
    try {
      const response = await this.client.request({ version: 1, requestId: record.id, operation, arguments: { serviceId: serviceKey }, sentAt: new Date().toISOString() });
      const state = ['succeeded', 'failed', 'accepted'].includes(response.result.state) ? response.result.state : 'unknown';
      return this.repository.complete({ id: record.id, status: state, result: response.result.data || null, errorCode: response.result.errorCode || null });
    } catch (_) {
      return this.repository.complete({ id: record.id, status: 'unknown', errorCode: 'HOST_AGENT_UNREACHABLE' });
    }
  }
  async reconcile() {
    const records = await this.repository.recoverable(20);
    for (const record of records) {
      try {
        const response = await this.client.request({ version: 1, requestId: crypto.randomUUID(), operation: 'operation.status', arguments: { requestId: record.id }, sentAt: new Date().toISOString() });
        const original = response.result.data && response.result.data.response;
        if (response.result.data && response.result.data.found && original && original.result) {
          const state = ['succeeded', 'failed', 'accepted'].includes(original.result.state) ? original.result.state : 'unknown';
          await this.repository.complete({ id: record.id, status: state, result: original.result.data || null, errorCode: original.result.errorCode || null });
        } else if (Date.now() - new Date(record.created_at).getTime() > 10 * 60 * 1000) {
          await this.repository.complete({ id: record.id, status: 'unknown', errorCode: 'HOST_AGENT_RESULT_MISSING' });
        }
      } catch (_) { /* Leave it recoverable; never repeat the changing action. */ }
    }
  }
}
module.exports = { OperationService };
