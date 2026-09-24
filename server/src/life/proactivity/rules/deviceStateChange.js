const { defineRule } = require('../proactivityRule');
module.exports = defineRule({ id: 'device.state_attention', version: 1, inputKinds: ['device_change'], cooldownMs: 3600000, evaluate(signal) {
  if (!signal.deviceId || !['offline', 'degraded', 'storage_low', 'battery_low'].includes(signal.deviceState)) return null;
  return { title: 'Проверить состояние устройства', explanation: `Устройство сообщило важное состояние: ${signal.deviceState}.`, confidence: signal.confidence || 0.95,
    riskClass: 'safe', actionName: 'device.status.request', actionArguments: signal.actions?.requestDeviceStatus || {} };
} });
