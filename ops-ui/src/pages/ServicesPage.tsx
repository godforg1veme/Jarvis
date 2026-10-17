import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { getServiceLogs, getServices, runServiceAction } from '../api/client';
import { dateLabel, serviceTag, statusLabels } from '../format';
import type { Service } from '../types';
import './ServicesPage.css';

// Native modal dialogs make the background inert, including for nested confirmation.
function ServiceDialog({ className, labelledBy, onDismiss, children }: {
  className: string; labelledBy: string; onDismiss: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener?.isConnected) {
        const target = opener.matches(':disabled')
          ? opener.closest('dialog')?.querySelector<HTMLElement>('button:not(:disabled)')
          : opener;
        target?.focus();
      }
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
  const [selected, setSelected] = useState<Service | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [confirmAction, setConfirmAction] = useState<'start' | 'stop' | 'restart' | null>(null);
  const [operationState, setOperationState] = useState('');
  const [busy, setBusy] = useState(false);
  const operationBusy = useRef(false);
  const selection = useRef(0);
  const serviceTitle = useId();
  const confirmationTitle = useId();
  useEffect(() => {
    let active = true;
    void getServices().then((value) => { if (active) setServices(value); }).catch(() => { if (active) setError('Не удалось загрузить сервисы'); });
    return () => { active = false; };
  }, [refreshToken]);
  useEffect(() => () => { selection.current += 1; }, []);
  const close = () => { selection.current += 1; setConfirmAction(null); setSelected(null); };
  const open = async (service: Service) => {
    const revision = ++selection.current;
    setConfirmAction(null); setOperationState(''); setSelected(service); setLogs([]);
    try {
      const result = await getServiceLogs(service.key);
      if (selection.current === revision) setLogs(result.state === 'succeeded' ? result.logs.length ? result.logs : ['Записей нет'] : ['Логи временно недоступны']);
    } catch { if (selection.current === revision) setLogs(['Логи временно недоступны']); }
  };
  const execute = async () => {
    if (!selected || !confirmAction || operationBusy.current) return;
    operationBusy.current = true; setBusy(true);
    const key = selected.key; const action = confirmAction; const revision = selection.current;
    setConfirmAction(null); setOperationState('выполняется…');
    try {
      const result = await runServiceAction(key, action);
      if (selection.current === revision) setOperationState(result.status === 'succeeded' ? 'операция успешно завершена' : `результат: ${result.status}${result.errorCode ? ` / ${result.errorCode}` : ''}`);
    } catch {
      if (selection.current === revision) setOperationState('Ответ не получен. Повторная проверка этой команды использует прежний идентификатор.');
    } finally { operationBusy.current = false; setBusy(false); }
  };
  return <>
    <div className="page-heading"><p>RUNTIME / SERVICE CATALOG</p><h1>Сервисы</h1><span>Все управляемые и наблюдаемые контуры на VPS</span></div>
    {error ? <div className="notice error">{error}</div> : !services ? <div className="notice">Загрузка…</div> : <div className="service-table">{services.map((service) => <button key={service.key} onClick={() => void open(service)}><span className="tag">{serviceTag(service.key)}</span><b>{service.name}<small>{service.key} · {service.type || 'service'}</small></b><em className={service.state}><i />{statusLabels[service.state] || service.state}</em><time>{dateLabel(service.observedAt)}</time><strong>ОТКРЫТЬ →</strong></button>)}</div>}
    {selected ? <ServiceDialog className="drawer service-drawer" labelledBy={serviceTitle} onDismiss={close}>
      <button className="drawer-close" onClick={close} autoFocus>ЗАКРЫТЬ ×</button>
      <p>SERVICE / {selected.key}</p><h2 id={serviceTitle}>{selected.name}</h2>
      <div className={`state ${selected.state}`}><i />{statusLabels[selected.state] || selected.state}</div>
      <h3>УПРАВЛЕНИЕ</h3>
      {selected.capabilities?.length ? <div className="action-row">{selected.capabilities.map((action) => <button key={action} disabled={busy} className={action === 'stop' ? 'danger' : 'secondary'} onClick={() => setConfirmAction(action)}>{action.toUpperCase()}</button>)}</div> : <div className="notice quiet">READ ONLY — операции для этого сервиса выключены.</div>}
      {operationState ? <div className="operation-state" role="status">{operationState}</div> : null}
      <h3>ПОСЛЕДНИЕ ЛОГИ</h3><pre>{logs.length ? logs.join('\n') : 'загрузка…'}</pre>
    </ServiceDialog> : null}
    {selected && confirmAction ? <ServiceDialog className="confirm-dialog service-confirmation" labelledBy={confirmationTitle} onDismiss={() => setConfirmAction(null)}>
      <small>ПОДТВЕРЖДЕНИЕ ОПЕРАЦИИ</small><b id={confirmationTitle}>{confirmAction.toUpperCase()} / {selected.name}</b>
      <p>Команда будет отправлена Host Agent один раз и записана в журнал операций.</p>
      <div><button className="secondary" autoFocus onClick={() => setConfirmAction(null)}>Отмена</button><button disabled={busy} className={confirmAction === 'stop' ? 'danger' : 'secondary'} onClick={() => void execute()}>Выполнить</button></div>
    </ServiceDialog> : null}
  </>;
}
