import { getIncidents } from '../api/client';
import { PageHeading } from '../components/PageHeading';
import { ReadState } from '../components/ReadState';
import { dateLabel } from '../format';
import { useOperationsRead } from '../hooks/useOperationsRead';

const severityLabels: Record<string, string> = { warning: 'Предупреждение', error: 'Ошибка', critical: 'Критично' };
const stateLabels: Record<string, string> = { open: 'Открыт', resolved: 'Закрыт' };

export function IncidentsPage({ refreshToken = 0 }: { refreshToken?: number }) {
  const { data: items, loading, failed, retry } = useOperationsRead(getIncidents, refreshToken);
  return <>
    <PageHeading title="Инциденты" description="Сбои, деградации и отсутствие свежих данных" />
    <ReadState loading={loading} failed={failed} hasData={items !== null} retry={retry} label="инциденты" />
    {items !== null ? items.length === 0
      ? <div className="empty-state"><b>{failed ? 'ПОСЛЕДНИЕ ДАННЫЕ' : 'СИСТЕМА СПОКОЙНА'}</b><span>{failed ? 'На момент последней проверки инцидентов не было.' : 'Открытых и недавних инцидентов нет.'}</span></div>
      : <div className="incident-list">{items.map((item) => <article key={item.id} className={item.state}>
        <i>{severityLabels[item.severity] || 'Неизвестная важность'}</i><div><b>{item.summary}</b><small>{item.serviceName || 'Jarvis VPS'} · {item.kind}</small></div>
        <time>{dateLabel(item.lastObservedAt)}</time><em>{stateLabels[item.state] || 'Неизвестно'}</em>
      </article>)}</div> : null}
  </>;
}
