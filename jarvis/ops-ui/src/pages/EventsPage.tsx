import { useEffect, useState } from 'react';
import { getEvents } from '../api/client';
import { dateLabel } from '../format';
import type { OpsEvent } from '../types';

export function EventsPage({ refreshToken = 0 }: { refreshToken?: number }) {
  const [error, setError] = useState('');
  const [items, setItems] = useState<OpsEvent[] | null>(null); useEffect(() => { let active = true; void getEvents().then((value) => { if (active) { setItems(value); setError(''); } }).catch(() => { if (active) setError('Не удалось загрузить журнал событий.'); }); return () => { active = false; }; }, [refreshToken]);
  if (error) return <div role="alert" className="notice error">{error}</div>;
  return <><div className="page-heading"><p>AUDIT / EVENT FEED</p><h1>События</h1><span>Ограниченный технический журнал без семейного содержимого</span></div><div className="event-table">{!items ? <div className="notice">Загрузка…</div> : items.length === 0 ? <div className="notice quiet">Событий пока нет.</div> : items.map((item) => <div key={item.id}><time>{dateLabel(item.createdAt)}</time><b>{item.type}</b><span>{item.serviceKey || 'host'}</span><code>{JSON.stringify(item.payload)}</code></div>)}</div></>;
}
