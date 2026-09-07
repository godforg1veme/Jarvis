import { useEffect, useState } from 'react';
import { getIncidents } from '../api/client';
import { dateLabel } from '../format';
import type { Incident } from '../types';

export function IncidentsPage({ refreshToken = 0 }: { refreshToken?: number }) {
  const [items, setItems] = useState<Incident[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; void getIncidents().then((value) => { if (active) { setItems(value); setError(''); } }).catch(() => { if (active) setError('Не удалось проверить инциденты. Состояние системы неизвестно.'); }); return () => { active = false; }; }, [refreshToken]);
  if (error) return <div role="alert" className="notice error">{error}</div>;
  return <><div className="page-heading"><p>HEALTH / INCIDENTS</p><h1>Инциденты</h1><span>Сбои, деградации и отсутствие свежих данных</span></div>{!items ? <div className="notice">Загрузка…</div> : items.length === 0 ? <div className="empty-state"><b>СИСТЕМА СПОКОЙНА</b><span>Открытых и недавних инцидентов нет.</span></div> : <div className="incident-list">{items.map((item) => <article key={item.id} className={item.state}><i>{item.severity.toUpperCase()}</i><div><b>{item.summary}</b><small>{item.serviceName || 'Jarvis VPS'} · {item.kind}</small></div><time>{dateLabel(item.lastObservedAt)}</time><em>{item.state === 'open' ? 'ОТКРЫТ' : 'ЗАКРЫТ'}</em></article>)}</div>}</>;
}
