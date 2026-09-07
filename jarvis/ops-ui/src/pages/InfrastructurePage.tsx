import { useEffect, useMemo, useState } from 'react';
import { getMetrics, getInventory, type Inventory } from '../api/client';
import { Sparkline } from '../components/Sparkline';
import type { Metric } from '../types';

const labels: Record<string, { title: string; unit: string; scale?: number }> = {
  cpu_used_percent: { title: 'ПРОЦЕССОР', unit: '%' },
  load_1: { title: 'LOAD / 1 MIN', unit: '' }, memory_used_percent: { title: 'ПАМЯТЬ', unit: '%' },
  disk_used_percent: { title: 'ДИСК', unit: '%' }, inode_used_percent: { title: 'INODES', unit: '%' },
  swap_used_percent: { title: 'SWAP', unit: '%' },
  disk_free_bytes: { title: 'СВОБОДНО НА ДИСКЕ', unit: 'GiB', scale: 2 ** 30 },
  memory_total_bytes: { title: 'ОБЪЁМ ПАМЯТИ', unit: 'GiB', scale: 2 ** 30 },
  network_rx_bytes: { title: 'СЕТЬ: ПОЛУЧЕНО С ЗАПУСКА', unit: 'GiB', scale: 2 ** 30 },
  network_tx_bytes: { title: 'СЕТЬ: ОТПРАВЛЕНО С ЗАПУСКА', unit: 'GiB', scale: 2 ** 30 },
  uptime_seconds: { title: 'ВРЕМЯ РАБОТЫ VPS', unit: 'ч', scale: 3600 },
};

export function InfrastructurePage({ refreshToken = 0 }: { refreshToken?: number }) {
  const [metrics, setMetrics] = useState<Metric[]>([]); const [error, setError] = useState('');
  const [inventory, setInventory] = useState<Inventory | null>(null);
  useEffect(() => { let active = true; void getInventory().then((value) => { if (active) setInventory(value || null); }).catch(() => { if (active) setInventory({ items: [], unavailable: ['docker', 'systemd'] }); }); return () => { active = false; }; }, [refreshToken]);
  useEffect(() => { let active = true; void getMetrics().then((value) => { if (active) { setMetrics(value); setError(''); } }).catch(() => { if (active) setError('Метрики хоста временно недоступны'); }); return () => { active = false; }; }, [refreshToken]);
  const groups = useMemo(() => Object.entries(labels).map(([name, meta]) => ({ name, ...meta, values: metrics.filter((metric) => metric.name === name).map((metric) => metric.value / (meta.scale || 1)) })), [metrics]);
  return <><div className="page-heading"><p>HOST / TELEMETRY</p><h1>Инфраструктура</h1><span>Нагрузка, память, диск и inode-фонд Jarvis VPS</span></div>
    {error ? <div className="notice error">{error}</div> : <div className="metric-grid">{groups.map((group) => { const value = group.values.at(-1); return <article className="metric-card" key={group.name}><small>{group.title}</small><strong>{value === undefined ? '—' : value.toFixed(group.name === 'load_1' ? 2 : 1)}<i>{group.unit}</i></strong><Sparkline values={group.values} /></article>; })}</div>}
    <div className="notice quiet">Метрики записываются каждые 30 секунд. История на этом экране ограничена последними 24 часами.</div>
    {inventory ? <section className="inventory"><h2>Компоненты VPS</h2><p className="muted">Обнаруженные контейнеры и системные службы. Доступные команды находятся в разделе «Сервисы».</p>{inventory.unavailable.length ? <div className="notice error">Недоступны источники: {inventory.unavailable.join(', ')}</div> : null}{inventory.items.map((item) => <article key={`${item.type}:${item.name}`}><b>{item.name}</b><small>{item.type}</small><span>{item.state}</span></article>)}</section> : null}</>;
}
