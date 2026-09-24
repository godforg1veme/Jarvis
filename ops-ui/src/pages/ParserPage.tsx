import { useEffect, useState } from 'react';
import { getParser } from '../api/client';
import { dateLabel, statusLabels } from '../format';
import type { ParserData } from '../types';

export function ParserPage({ refreshToken = 0 }: { refreshToken?: number }) {
  const [data, setData] = useState<ParserData | null>(null);
  useEffect(() => { void getParser().then(setData).catch(() => setData({ service: null, results: [] })); }, [refreshToken]);
  return <><div className="page-heading"><p>EXTERNAL / READ ONLY</p><h1>Telegram Parser</h1><span>Наблюдение без изменения установленного парсера</span></div>{!data ? <div className="notice">Загрузка…</div> : <><section className="parser-hero"><div><small>СОСТОЯНИЕ UNIT</small><strong className={data.service?.state || 'unknown'}><i />{statusLabels[data.service?.state || 'unknown'] || data.service?.state || 'нет данных'}</strong></div><div><small>ПОСЛЕДНИЙ СИГНАЛ</small><strong>{dateLabel(data.service?.observedAt || null)}</strong></div><span>READ ONLY / исходники, сессии и настройки не затрагиваются</span></section>{data.results.length ? <div className="timeline">{data.results.map((result) => <div key={result.id}><time>{dateLabel(result.observedAt)}</time><b>{result.kind}</b><span>{result.summary}</span></div>)}</div> : <div className="notice quiet">Операционных ошибок парсера пока не записано.</div>}</>}</>;
}
