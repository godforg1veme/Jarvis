const { MAX_FRAME_BYTES, validateVisionFrameMetadata, validateVisionObservation } = require('./visionSchemas');

class VisionTransport {
  constructor(options = {}) {
    if (!options.cloudClient) throw new Error('VisionTransport requires cloudClient');
    this.cloudClient = options.cloudClient;
  }

  async createLease(input) {
    const result = await this.cloudClient.createVisionLease(input);
    if (!result?.lease?.leaseId) throw new Error('vision lease response is invalid');
    return result.lease;
  }

  async requestCapture(leaseId, input) {
    const result = await this.cloudClient.createVisionCaptureRequest(leaseId, input);
    if (!result?.request?.captureRequestId) throw new Error('vision capture request response is invalid');
    return result.request;
  }

  async uploadFrame(leaseId, metadata, bytes, options = {}) {
    const image = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
    const validated = validateVisionFrameMetadata(metadata);
    if (validated.leaseId !== leaseId || validated.byteLength !== image.length || image.length > MAX_FRAME_BYTES) {
      throw new Error('vision frame upload is invalid');
    }
    const result = await this.cloudClient.sendVisionFrame(leaseId, validated, image, options);
    return { observation: validateVisionObservation(result.observation), memory: result.memory || null };
  }

  async stopLease(leaseId) {
    return this.cloudClient.stopVisionLease(leaseId);
  }


  async setSensitiveConsent(leaseId, sourceId, allow) {
    return this.cloudClient.setVisionSensitiveConsent(leaseId, sourceId, allow);
  }

  async listMemories(limit) { return this.cloudClient.listVisionMemories(limit); }
  async getMemory(memoryId) { return this.cloudClient.getVisionMemory(memoryId); }
  async updateMemory(memoryId, patch) { return this.cloudClient.updateVisionMemory(memoryId, patch); }
  async deleteMemory(memoryId) { return this.cloudClient.deleteVisionMemory(memoryId); }
}

module.exports = { VisionTransport };
