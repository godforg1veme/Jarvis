// Synthetic data shared by local UI preview and browser checks. No credentials.
const stamp = '2026-10-20T18:42:00.000Z';
const services = [
  { key: 'jarvis-server', name: 'Jarvis Server', type: 'docker', state: 'healthy', observedAt: stamp, capabilities: ['restart'] },
  { key: 'postgres', name: 'PostgreSQL', type: 'docker', state: 'healthy', observedAt: stamp, capabilities: [] },
  { key: 'cloudflared', name: 'Cloudflare Tunnel', type: 'systemd', state: 'healthy', observedAt: stamp, capabilities: [] },
  { key: 'telegram-parser', name: 'Telegram Parser', type: 'systemd', state: 'healthy', observedAt: stamp, capabilities: [] },
];
const overview = { host_key: 'demo-node', label: 'Демонстрационный узел', status: 'healthy', last_contact_at: stamp, services };
const profiles = [{ id: 'demo-owner', displayName: 'Владелец', role: 'owner', telegram: [{ id: 'demo-tg', externalId: '100000001', connectedAt: stamp }], devices: [{ id: 'demo-pc', name: 'Рабочий компьютер', status: 'online', kind: 'computer', lastSeenAt: stamp }] }];

function responseFor(api) {
  if (api === '/overview') return { overview };
  if (api === '/services') return { services };
  if (api === '/checks') return { checks: [
    { key: 'server', state: 'healthy', summary: 'Сервер Jarvis доступен', checkedAt: stamp },
    { key: 'provider', state: 'healthy', summary: 'Настроенная модель отвечает', checkedAt: stamp },
  ] };
  if (api === '/connections') return { profiles };
  if (api === '/inventory') return { inventory: { items: [{ name: 'jarvis-server', type: 'docker', state: 'running' }, { name: 'postgres', type: 'docker', state: 'running' }, { name: 'cloudflared.service', type: 'systemd', state: 'active' }], unavailable: [] } };
  if (api.includes('/metrics')) return { metrics: ['cpu_used_percent', 'memory_used_percent', 'disk_used_percent', 'load_1'].flatMap((name, k) => Array.from({ length: 24 }, (_, i) => ({ name, value: name === 'load_1' ? .3 + Math.sin(i * .4) * .12 : 20 + k * 11 + Math.sin(i * .45 + k) * 6, sampledAt: new Date(Date.parse(stamp) - (23 - i) * 30000).toISOString() }))) };
  if (api.includes('/logs')) return { state: 'succeeded', logs: ['[demo] Service ready', '[demo] Health check completed'] };
  if (api === '/parser') return { parser: { service: services[3], results: [{ id: 'demo-result', observedAt: stamp, kind: 'scan', summary: 'Демонстрационная проверка источников завершена' }] } };
  if (api === '/events') return { events: [{ id: 'demo-event', type: 'health_check', serviceKey: 'jarvis-server', createdAt: stamp, payload: { summary: 'Демонстрационная проверка завершена' } }] };
  if (api === '/incidents') return { incidents: [] };
  if (api === '/backups') return { backups: [] };
  if (api === '/sessions') return { sessions: [{ id: 'demo-session', label: 'Этот браузер', client_metadata: { userAgent: 'Локальное дизайн-превью' }, current: true, created_at: stamp, last_used_at: stamp }] };
  return null;
}
module.exports = { responseFor, overview, services, stamp };
