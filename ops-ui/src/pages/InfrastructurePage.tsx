import { useMemo } from 'react';
import { getMetrics, getInventory, type Inventory } from '../api/client';
import { Sparkline } from '../components/Sparkline';
import { useOperationsRead } from '../hooks/useOperationsRead';
import { PageHeading } from '../components/PageHeading';
import { ReadState } from '../components/ReadState';

const labels: Record<string, { title: string; unit: string; scale?: number }> = {
  cpu_used_percent: { title: 'Процессор', unit: '%' },
  load_1: { title: 'Нагрузка за минуту', unit: '' }, memory_used_percent: { title: 'Память', unit: '%' },
  disk_used_percent: { title: 'Диск', unit: '%' }, inode_used_percent: { title: 'Индексные дескрипторы', unit: '%' },
  swap_used_percent: { title: 'Подкачка', unit: '%' },
  disk_free_bytes: { title: 'Свободно на диске', unit: 'GiB', scale: 2 ** 30 },
  memory_total_bytes: { title: 'Объём памяти', unit: 'GiB', scale: 2 ** 30 },
  network_rx_bytes: { title: 'Получено по сети', unit: 'GiB', scale: 2 ** 30 },
  network_tx_bytes: { title: 'Отправлено по сети', unit: 'GiB', scale: 2 ** 30 },
  uptime_seconds: { title: 'Время работы', unit: 'ч', scale: 3600 },
};
const primaryMetrics = ['cpu_used_percent', 'memory_used_percent', 'disk_used_percent', 'load_1'];
type MetricGroup = { name: string; title: string; unit: string; values: number[] };
function MetricGrid({ groups, label }: { groups: MetricGroup[]; label: string }) {
  return <div className="metric-grid" aria-label={label}>{groups.map((group) => {
    const value = group.values.at(-1);
    return <article className="metric-card" key={group.name}><small>{group.title}</small>
      <strong>{value === undefined ? '—' : value.toFixed(group.name === 'load_1' ? 2 : 1)}<i>{group.unit}</i></strong>
      <Sparkline values={group.values} /></article>;
  })}</div>;
}

export function InfrastructurePage({ refreshToken = 0 }: { refreshToken?: number }) {
  const telemetry = useOperationsRead(getMetrics, refreshToken);
  const components = useOperationsRead<Inventory>(getInventory, refreshToken);
  const metrics = telemetry.data ?? [];
  const inventory = components.data;
  const groups = useMemo(() => Object.entries(labels).map(([name, meta]) => ({ name, ...meta, values: metrics.filter((metric) => metric.name === name).map((metric) => metric.value / (meta.scale || 1)) })), [metrics]);
  return <><PageHeading title="Инфраструктура" description="Нагрузка, память и диски сервера" />
    <ReadState {...telemetry} hasData={telemetry.data !== null} label="метрики" />
    {telemetry.data ? <>
      <MetricGrid groups={primaryMetrics.map((name) => groups.find((group) => group.name === name)!)} label={telemetry.failed ? 'Последние полученные метрики' : 'Основные метрики хоста'} />
      <details className="additional-metrics"><summary>Дополнительные показатели</summary>
        <MetricGrid groups={groups.filter((group) => !primaryMetrics.includes(group.name))} label="Дополнительные метрики хоста" />
      </details>
    </> : null}
    <div className="notice quiet">Метрики записываются каждые 30 секунд. История на этом экране ограничена последними 24 часами.</div>
    <section className="inventory"><h2>Компоненты сервера</h2><p className="muted">Контейнеры и системные службы. Управление — в разделе «Сервисы».</p>
      <ReadState {...components} hasData={inventory !== null} label="компоненты" />
      {inventory ? <>{inventory.unavailable.length ? <div className="notice error">Недоступны источники: {inventory.unavailable.join(', ')}</div> : null}{inventory.items.map((item) => <article key={`${item.type}:${item.name}`}><b>{item.name}</b><small>{item.type}</small><span>{({ running: 'Запущен', active: 'Активен', stopped: 'Остановлен', inactive: 'Неактивен' } as Record<string, string>)[item.state] || item.state}</span></article>)}{!inventory.items.length ? <p className="muted">Компоненты пока не обнаружены.</p> : null}</> : null}
    </section></>;
}
