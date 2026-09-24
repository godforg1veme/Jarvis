import { useEffect, useState } from 'react';
import { getBackups } from '../api/client';
import { dateLabel } from '../format';
import type { Backup } from '../types';

export function BackupsPage({ refreshToken = 0 }: { refreshToken?: number }) {
  const [error, setError] = useState('');
  const [items, setItems] = useState<Backup[] | null>(null); useEffect(() => { let active = true; void getBackups().then((value) => { if (active) { setItems(value); setError(''); } }).catch(() => { if (active) setError('Не удалось проверить резервные копии. Данные временно недоступны.'); }); return () => { active = false; }; }, [refreshToken]);
  if (error) return <div role="alert" className="notice error">{error}</div>;
  return <><div className="page-heading"><p>RECOVERY / ARCHIVE</p><h1>Резервные копии</h1><span>История безопасных backup-запусков без остановки Jarvis</span></div>{!items ? <div className="notice">Загрузка…</div> : items.length === 0 ? <div className="empty-state warning"><b>НЕТ ЗАПИСАННЫХ BACKUP-ЗАПУСКОВ</b><span>Панель ещё не получила машиночитаемый результат резервного копирования.</span></div> : <div className="backup-grid">{items.map((item) => <article key={item.id}><span className={item.status}>{item.status}</span><b>{item.source === 'manual' ? 'Ручной запуск' : 'Плановый запуск'}</b><time>{dateLabel(item.startedAt)}</time><small>{item.detail || item.errorCode || 'без дополнительного сообщения'}</small></article>)}</div>}</>;
}
