const { normalizeDevicePromptContext } = require('./devicePromptContext');

function isDeviceAttachmentQuestion(text) {
  const normalized = String(text || '').trim().toLowerCase();
  return /к\s+какому\s+(?:пк|компьютер(?:у|ом)?|устройств[уо]?)\s+(?:я\s+)?привязан/.test(normalized)
    || /какой\s+(?:пк|компьютер|компьютер[ыа]?|устройств[оа]?)\s+(?:у\s+меня\s+)?(?:подключ[её]н|привязан)/.test(normalized);
}

function attachmentReply(devices) {
  const safeDevices = normalizeDevicePromptContext(devices);
  if (safeDevices.length === 0) return 'К твоему аккаунту пока не привязан ни один компьютер.';
  const lines = safeDevices.map((device) => `«${device.name}» — ${device.status}`);
  return safeDevices.length === 1
    ? `К твоему аккаунту привязан компьютер ${lines[0]}.`
    : `К твоему аккаунту привязаны устройства:\n${lines.join('\n')}`;
}

module.exports = {
  attachmentReply,
  isDeviceAttachmentQuestion,
};
