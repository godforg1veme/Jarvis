import { getHealthChecks, type HealthCheck } from '../api/client';
import { dateLabel, statusLabels } from '../format';
import { ServiceSymbol } from '../components/orbital/ServiceSymbol';
import type { Overview } from '../types';
import { useOperationsRead } from '../hooks/useOperationsRead';
import { PageHeading } from '../components/PageHeading';
import { ReadState } from '../components/ReadState';

export function OverviewPage({ initial, refreshToken = 0 }: { initial: Overview; refreshToken?: number }) {
  const overview = initial;
  const health = useOperationsRead<HealthCheck[]>(getHealthChecks, refreshToken);
  const checks = health.data ?? [];
  return <>
    <PageHeading title="Обзор" description="Состояние инфраструктуры и сервисов" />
    <ReadState {...health} hasData={health.data !== null} label="проверки состояния" />
    <section className="host-strip">
      <div><small>УЗЕЛ</small><strong>{overview.label}</strong><span>{overview.host_key}</span></div>
      <div><small>СОСТОЯНИЕ</small><strong className={overview.status}><i />{statusLabels[overview.status] || overview.status}</strong><span>опрос: {dateLabel(overview.last_contact_at)}</span></div>
      <div><small>Сервисы</small><strong>{overview.services.length}</strong><span>обнаружено</span></div>
    </section>
    {checks.length ? <section className="health-checks" aria-label="Проверки Jarvis">{checks.map((check) => <article key={check.key}><span className={check.state}>{statusLabels[check.state] || check.state}</span><b>{check.summary}</b><small>{dateLabel(check.checkedAt)}{check.key === 'provider' ? ' · раз в 6 часов' : ''}</small></article>)}</section> : null}
    <div className="section-heading"><h2>Сервисы</h2><small>Обновление каждые 30 секунд</small></div>
    <div className="service-grid">{overview.services.map((service) => <article className="service-card" key={service.key}>
      <ServiceSymbol serviceKey={service.key} />
      <div className="card-name"><b>{service.name}</b><small>{service.key}</small></div>
      <div className={`state ${service.state}`}><i />{statusLabels[service.state] || service.state}</div>
      <div className="observed">последний сигнал<br /><time>{dateLabel(service.observedAt)}</time></div>
    </article>)}</div>
  </>;
}
