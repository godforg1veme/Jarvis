const { defineRule } = require('../proactivityRule');
module.exports = defineRule({ id: 'smart_home.attention', version: 1, inputKinds: ['smart_home'], cooldownMs: 30 * 60000, evaluate(signal) {
  if (!signal.deviceId || !['warning', 'critical'].includes(signal.severity)) return null;
  return { title: 'Проверить домашнее устройство', explanation: `Умный дом передал сигнал уровня ${signal.severity}.`, confidence: signal.confidence || 0.95,
    riskClass: 'safe', actionName: 'device.status.request', actionArguments: signal.actions?.requestDeviceStatus || {} };
} });
