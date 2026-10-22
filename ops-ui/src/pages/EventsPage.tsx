import { getEvents } from '../api/client';
import { PageHeading } from '../components/PageHeading';
import { ReadState } from '../components/ReadState';
import { dateLabel } from '../format';
import { useOperationsRead } from '../hooks/useOperationsRead';

const eventLabels: Record<string, string> = {
  'service.state_changed': 'Состояние сервиса изменилось',
  'service.observed': 'Сервис проверен',
  'connection.telegram_reassigned': 'Telegram переназначен',
  'connection.device_reassignment_started': 'Переназначение устройства начато',
};

export function EventsPage({ refreshToken = 0 }: { refreshToken?: number }) {
  const { data: items, loading, failed, retry } = useOperationsRead(getEvents, refreshToken);
  return <>
    <PageHeading title="События" description="Ограниченный технический журнал без семейного содержимого" />
    <ReadState loading={loading} failed={failed} hasData={items !== null} retry={retry} label="события" />
    {items !== null ? <div className="event-table">{items.length === 0
      ? <div className="notice quiet">{failed ? 'На момент последней проверки событий не было.' : 'Событий пока нет.'}</div>
      : items.map((item) => <div key={item.id}>
        <time>{dateLabel(item.createdAt)}</time><b>{eventLabels[item.type] || item.type}</b><span>{item.serviceKey || 'Узел'}</span>
        <details><summary>Технические данные</summary><code style={{ display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(item.payload)}</code></details>
      </div>)}</div> : null}
  </>;
}
