import { getParser } from '../api/client';
import { PageHeading } from '../components/PageHeading';
import { ReadState } from '../components/ReadState';
import { dateLabel, statusLabels } from '../format';
import { useOperationsRead } from '../hooks/useOperationsRead';

export function ParserPage({ refreshToken = 0 }: { refreshToken?: number }) {
  const { data, loading, failed, retry } = useOperationsRead(getParser, refreshToken);
  return <>
    <PageHeading title="Telegram Parser" description="Наблюдение без изменения установленного парсера" />
    <ReadState loading={loading} failed={failed} hasData={data !== null} retry={retry} label="данные парсера" />
    {data ? <>
      <section className="parser-hero"><div><small>СОСТОЯНИЕ СЕРВИСА{failed ? ' · ПОСЛЕДНИЕ ДАННЫЕ' : ''}</small>
        <strong className={failed ? 'unknown' : data.service?.state || 'unknown'}><i />{statusLabels[data.service?.state || 'unknown'] || data.service?.state || 'Нет данных'}{failed ? ' · ранее' : ''}</strong></div>
        <div><small>ПОСЛЕДНИЙ СИГНАЛ</small><strong>{dateLabel(data.service?.observedAt || null)}</strong></div>
        <span>Только наблюдение · исходники, сессии и настройки не затрагиваются</span></section>
      {data.results.length ? <div className="timeline">{data.results.map((result) => <div key={result.id}>
        <time>{dateLabel(result.observedAt)}</time><b>{result.kind}</b><span>{result.summary}</span>
      </div>)}</div> : <div className="notice quiet">{data.service
        ? failed ? 'На момент последней проверки операционных ошибок не было.' : 'Операционных ошибок парсера пока не записано.'
        : 'Данные о сервисе парсера пока не получены.'}</div>}
    </> : null}
  </>;
}
