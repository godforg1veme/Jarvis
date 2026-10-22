import { getBackups } from '../api/client';
import { PageHeading } from '../components/PageHeading';
import { ReadState } from '../components/ReadState';
import { dateLabel } from '../format';
import { useOperationsRead } from '../hooks/useOperationsRead';

const backupStatuses: Record<string, string> = {
  succeeded: 'Завершено', failed: 'Ошибка', running: 'Выполняется', queued: 'В очереди', cancelled: 'Отменено', unknown: 'Итог неизвестен',
};

export function BackupsPage({ refreshToken = 0 }: { refreshToken?: number }) {
  const { data: items, loading, failed, retry } = useOperationsRead(getBackups, refreshToken);
  return <>
    <PageHeading title="Резервные копии" description="История запусков резервного копирования без остановки Jarvis" />
    <ReadState loading={loading} failed={failed} hasData={items !== null} retry={retry} label="резервные копии" />
    {items !== null ? items.length === 0
      ? <div className="empty-state warning"><b>НЕТ ЗАПИСАННЫХ ЗАПУСКОВ</b><span>{failed ? 'На момент последней проверки записей не было.' : 'Панель ещё не получила результат резервного копирования.'}</span></div>
      : <div className="backup-grid">{items.map((item) => <article key={item.id}>
        <span className={item.status}>{backupStatuses[item.status] || 'Статус неизвестен'}</span>
        <b>{item.source === 'manual' ? 'Ручной запуск' : item.source === 'scheduled' ? 'Плановый запуск' : 'Источник не указан'}</b>
        <time>{dateLabel(item.startedAt)}</time><small>{item.detail || 'Без дополнительного сообщения'}</small>
      </article>)}</div> : null}
  </>;
}
