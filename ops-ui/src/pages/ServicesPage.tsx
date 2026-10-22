import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { getServiceLogs, getServices, runServiceAction } from '../api/client';
import { dateLabel, statusLabels } from '../format';
import { ServiceSymbol } from '../components/orbital/ServiceSymbol';
import type { Service } from '../types';
import './ServicesPage.css';

type Action = 'start' | 'stop' | 'restart';
type NoticeTone = 'pending' | 'success' | 'error' | 'unknown';
type OperationNotice = { tone: NoticeTone; message: string };
const healthy = (service: Service) => service.state === 'healthy' || service.state === 'online';
const actionNames: Record<Action, string> = { start: 'Запустить', stop: 'Остановить', restart: 'Перезапустить' };
function operationNotice(status: string): OperationNotice {
  switch (status) {
    case 'succeeded': return { tone: 'success', message: 'Операция успешно завершена.' };
    case 'failed': return { tone: 'error', message: 'Команда не выполнена. Проверьте журнал операций.' };
    case 'cancelled': return { tone: 'error', message: 'Операция отменена.' };
    case 'queued': return { tone: 'pending', message: 'Команда принята в очередь. Результат ожидается.' };
    case 'running': return { tone: 'pending', message: 'Команда выполняется. Результат ожидается.' };
    default: return { tone: 'unknown', message: 'Итог операции не подтверждён. Проверьте журнал операций перед новой командой.' };
  }
}

function ServiceDialog({ className, labelledBy, onDismiss, fallbackFocus, children }: { className: string; labelledBy: string; onDismiss: () => void; fallbackFocus?: () => HTMLElement | null; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      dialog.close();
      const target = opener?.isConnected && !opener.matches(':disabled') ? opener : fallbackFocus?.();
      target?.focus();
    };
  }, []);
  return <dialog ref={ref} className={className} aria-labelledby={labelledBy} aria-modal="true"
    onCancel={(event) => { event.preventDefault(); onDismiss(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onDismiss();
    }}>{children}</dialog>;
}

export function ServicesPage({ refreshToken = 0 }: { refreshToken?: number }) {
  const [services, setServices] = useState<Service[] | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [logsKey, setLogsKey] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[] | null>(null);
  const [logsError, setLogsError] = useState(false);
  const [confirm, setConfirm] = useState<{ key: string; name: string; action: Action } | null>(null);
  const [operationStates, setOperationStates] = useState<Record<string, OperationNotice>>({});
  const [busy, setBusy] = useState(false);
  const operationBusy = useRef(false);
  const mounted = useRef(true);
  const servicesRef = useRef<Service[] | null>(null);
  const initialSelection = useRef(false);
  const selection = useRef(0);
  const logsRevision = useRef(0);
  const logsTitle = useId();
  const confirmationTitle = useId();

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getServices().then((value) => {
      if (!active) return;
      servicesRef.current = value;
      setServices(value); setError(''); setLoading(false);
      setExpandedKey((current) => {
        if (!initialSelection.current) {
          initialSelection.current = true;
          return value.find((service) => service.key === 'jarvis-server')?.key ?? value[0]?.key ?? null;
        }
        return current && !value.some((service) => service.key === current) ? null : current;
      });
    }).catch(() => {
      if (!active) return;
      setError(servicesRef.current ? 'Не удалось обновить сервисы. Показаны последние загруженные данные.' : 'Не удалось загрузить сервисы.'); setLoading(false);
    });
    return () => { active = false; };
  }, [refreshToken, refreshCount]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; selection.current += 1; logsRevision.current += 1; };
  }, []);

  const toggle = (key: string) => { selection.current += 1; setConfirm(null); setExpandedKey((current) => current === key ? null : key); };
  const fetchLogs = async (key: string) => {
    const revision = ++logsRevision.current;
    setLogs(null); setLogsError(false);
    try {
      const result = await getServiceLogs(key);
      if (logsRevision.current === revision) {
        if (result.state === 'succeeded') setLogs(result.logs.length ? result.logs : ['Записей нет']);
        else setLogsError(true);
      }
    } catch { if (logsRevision.current === revision) setLogsError(true); }
  };
  const openLogs = (service: Service) => { setLogsKey(service.key); void fetchLogs(service.key); };
  const closeLogs = () => { logsRevision.current += 1; setLogsKey(null); };
  const execute = async () => {
    if (!confirm || operationBusy.current || confirm.key !== expandedKey) return;
    const { key, action } = confirm;
    if (error) {
      setConfirm(null);
      setOperationStates((current) => ({ ...current, [key]: { tone: 'error', message: 'Состояние сервиса устарело. Сначала обновите список.' } }));
      return;
    }
    if (!servicesRef.current?.find((service) => service.key === key)?.capabilities?.includes(action)) {
      setConfirm(null);
      setOperationStates((current) => ({ ...current, [key]: { tone: 'error', message: 'Команда больше недоступна. Обновите состояние сервиса.' } }));
      return;
    }
    operationBusy.current = true; setBusy(true);
    setConfirm(null);
    setOperationStates((current) => ({ ...current, [key]: { tone: 'pending', message: 'Операция выполняется…' } }));
    try {
      const result = await runServiceAction(key, action);
      if (mounted.current) setOperationStates((current) => ({ ...current, [key]: operationNotice(result.status) }));
    } catch {
      if (mounted.current) setOperationStates((current) => ({ ...current, [key]: { tone: 'unknown', message: 'Ответ не получен. Итог операции не подтверждён; проверьте журнал перед повтором.' } }));
    } finally { operationBusy.current = false; if (mounted.current) setBusy(false); }
  };
  const triggerFor = (key: string) => Array.from(document.querySelectorAll<HTMLElement>('.service-accordion-item'))
    .find((item) => item.dataset.serviceKey === key)?.querySelector<HTMLElement>('.service-accordion-trigger') ?? null;

  const working = services?.filter(healthy).length ?? 0;
  const attention = (services?.length ?? 0) - working;
  const filtered = services?.filter((service) => filter === 'all' || !healthy(service)) ?? [];
  const logsService = services?.find((service) => service.key === logsKey);
  return <section className="service-catalog" aria-label="Каталог сервисов">
    <div className="service-catalog-sticky"><header className="service-catalog-heading"><div className="service-catalog-heading-row"><h1>Сервисы</h1><button type="button" className="service-catalog-refresh" onClick={() => setRefreshCount((value) => value + 1)} disabled={loading} aria-label="Обновить список сервисов">{loading && services ? 'Обновление…' : 'Обновить'}</button></div><p>{loading && !services ? 'Загрузка состояния сервисов…' : error && services
      ? `Последние данные: ${working} из ${services.length} работали` : services ? `${working} из ${services.length} работают${loading ? ' · обновление…' : ''}` : 'Данные сервисов недоступны'}</p></header>
    {error ? <p className="service-catalog-error" role="alert">{error}</p> : null}
    {services ? <div className="service-catalog-filters" role="group" aria-label="Фильтр сервисов">
        <button type="button" className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Все ({services.length})</button>
        <button type="button" className={filter === 'attention' ? 'active' : ''} aria-pressed={filter === 'attention'} onClick={() => setFilter('attention')}>Требуют внимания ({attention})</button>
      </div> : null}</div>
    {services ? <>
      {filtered.length ? <div className="service-accordion">{filtered.map((service) => {
        const expanded = expandedKey === service.key;
        const detailId = `service-detail-${service.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        return <article className={`service-accordion-item${expanded ? ' expanded' : ''}`} key={service.key} data-service-key={service.key}>
          <button type="button" className="service-accordion-trigger" aria-expanded={expanded} aria-controls={detailId} onClick={() => toggle(service.key)}>
            <ServiceSymbol serviceKey={service.key} />
            <span className="service-accordion-name">{service.name}</span>
            <span className={`service-accordion-status ${error ? 'stale' : service.state}`}><i aria-hidden="true" />{statusLabels[service.state] || service.state}{error ? ' · ранее' : ''}</span>
            <span className="service-accordion-chevron" aria-hidden="true">⌄</span>
          </button>
          {expanded ? <div className="service-accordion-detail" id={detailId}>
            <p className="service-accordion-observed">{error ? 'Последний сохранённый сигнал: ' : 'Последний сигнал: '}<time>{dateLabel(service.observedAt)}</time></p>
            <div className="service-accordion-actions">
              {service.capabilities?.length ? service.capabilities.map((action) => <button type="button" key={action}
                className={action === 'start' || action === 'restart' ? 'service-action-primary' : 'service-action-secondary'}
                disabled={busy || Boolean(error) || ['pending', 'unknown'].includes(operationStates[service.key]?.tone)} onClick={() => setConfirm({ key: service.key, name: service.name, action })}>{actionNames[action]}</button>)
                : <span className="service-accordion-readonly">Только наблюдение — управление этим сервисом недоступно.</span>}
            </div>
            {service.capabilities?.length ? <p className="service-accordion-hint">{error ? 'Команды недоступны до успешного обновления списка.' : 'Для команды потребуется подтверждение.'}</p> : null}
            {operationStates[service.key] ? <p className={`service-accordion-result ${operationStates[service.key].tone}`} role="status">{operationStates[service.key].message}</p> : null}
            <button type="button" className="service-action-logs" onClick={() => void openLogs(service)}>
              <svg width="24" height="28" viewBox="0 0 24 28" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M5 2h9l5 5v19H5zM14 2v6h5M8 13h8M8 17h8M8 21h5" /></svg>
              <span>Логи<small>Просмотр логов сервиса</small></span><span aria-hidden="true">›</span>
            </button>
          </div> : null}
        </article>;
      })}</div> : <p className="service-catalog-empty">{filter === 'attention' ? 'Сервисов, требующих внимания, нет.' : 'Сервисы пока не найдены.'}</p>}
    </> : loading ? <p className="service-catalog-loading" role="status">Загрузка…</p> : null}
    {logsKey ? <ServiceDialog className="service-logs-dialog" labelledBy={logsTitle} onDismiss={closeLogs}>
      <div className="service-dialog-heading"><div><small>ЖУРНАЛ СЕРВИСА</small><h2 id={logsTitle}>{logsService?.name || logsKey}</h2></div><button type="button" onClick={closeLogs} aria-label="Закрыть логи">×</button></div>
      {logsError ? <div className="service-logs-error" role="alert"><p>Логи временно недоступны.</p><button type="button" onClick={() => void fetchLogs(logsKey)}>Повторить загрузку логов</button></div>
        : <pre>{logs ? logs.join('\n') : 'Загрузка логов…'}</pre>}
    </ServiceDialog> : null}
    {confirm ? <ServiceDialog className="service-confirmation" labelledBy={confirmationTitle} onDismiss={() => setConfirm(null)} fallbackFocus={() => triggerFor(confirm.key)}>
      <small>ПОДТВЕРЖДЕНИЕ ОПЕРАЦИИ</small><h2 id={confirmationTitle}>{actionNames[confirm.action]} / {confirm.name}</h2>
      <p>Команда будет отправлена Host Agent один раз и записана в журнал операций.</p>
      <div className="service-confirmation-actions"><button type="button" autoFocus onClick={() => setConfirm(null)}>Отмена</button><button type="button" disabled={busy} onClick={() => void execute()}>Выполнить</button></div>
    </ServiceDialog> : null}
  </section>;
}
