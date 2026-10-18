const PERMISSIONS = Object.freeze([
  'assistant',
  'jobs',
  'life',
  'memory',
  'documents',
  'devices',
  'vpn',
  'operations',
]);
const LEGACY_PERMISSIONS = Object.freeze([
  'assistant',
  'life',
  'memory',
  'documents',
  'devices',
]);
const catalog = PERMISSIONS.map((id) => ({
  id,
  label: {
    assistant: 'Ассистент',
    jobs: 'Поиск работы',
    life: 'Life OS',
    memory: 'Память',
    documents: 'Документы',
    devices: 'Устройства',
    vpn: 'VPN',
    operations: 'Управление системой',
  }[id],
}));
module.exports = { PERMISSIONS, LEGACY_PERMISSIONS, catalog };
