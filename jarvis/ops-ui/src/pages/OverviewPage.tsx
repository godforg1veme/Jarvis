import { useEffect, useState } from 'react';
import { getOverview, getHealthChecks, type HealthCheck } from '../api/client';
import { dateLabel, serviceTag, statusLabels } from '../format';
import type { Overview } from '../types';

export function OverviewPage({ initial, refreshToken = 0 }: { initial: Overview; refreshToken?: number }) {
  const [overview, setOverview] = useState(initial);
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; void Promise.all([getOverview(), getHealthChecks()]).then(([value, health]) => { if (active) { setOverview(value); setChecks(health || []); setError(''); } }).catch(() => { if (active) setError('Данные обзора временно недоступны. Ниже — последнее полученное состояние.'); }); return () => { active = false; }; }, [refreshToken]);
  return <>
    <div className="page-heading"><p>SYSTEM / OVERVIEW</p><h1>Обзор</h1><span>Состояние инфраструктуры и сервисов</span></div>
    {error ? <div role="alert" className="notice error">{error}</div> : null}
    <section className="host-strip">
      <div><small>УЗЕЛ</small><strong>{overview.label}</strong><span>{overview.host_key}</span></div>
      <div><small>СОСТОЯНИЕ</small><strong className={overview.status}><i />{statusLabels[overview.status] || overview.status}</strong><span>опрос: {dateLabel(overview.last_contact_at)}</span></div>
      <div><small>СЕРВИСЫ</small><strong>{overview.services.length.toString().padStart(2, '0')}</strong><span>обнаружено</span></div>
    </section>
    {checks.length ? <section className="health-checks" aria-label="Проверки Jarvis">{checks.map((check) => <article key={check.key}><span className={check.state}>{statusLabels[check.state] || check.state}</span><b>{check.summary}</b><small>{dateLabel(check.checkedAt)}{check.key === 'provider' ? ' · раз в 6 часов' : ''}</small></article>)}</section> : null}
    <div className="section-heading"><div><p>REAL-TIME INVENTORY</p><h2>Сервисы</h2></div><small>обновление каждые 30 секунд</small></div>
    <div className="service-grid">{overview.services.map((service, index) => <article className="service-card" key={service.key}>
      <div className="card-index">{String(index + 1).padStart(2, '0')}</div><div className="tag">{serviceTag(service.key)}</div>
      <div className="card-name"><b>{service.name}</b><small>{service.key}</small></div>
      <div className={`state ${service.state}`}><i />{statusLabels[service.state] || service.state}</div>
      <div className="observed">последний сигнал<br /><time>{dateLabel(service.observedAt)}</time></div>
    </article>)}</div>
  </>;
}
