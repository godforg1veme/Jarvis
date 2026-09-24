import { useEffect, useState } from 'react';
import { getSessions, logout, revokeSession } from '../api/client';
import { dateLabel } from '../format';
import type { PanelSession } from '../types';

export function SessionsPage({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [sessions, setSessions] = useState<PanelSession[] | null>(null);
  const [error, setError] = useState('');
  const load = () => getSessions().then(setSessions).catch(() => setError('Не удалось загрузить сессии'));
  useEffect(() => { void load(); }, []);
  const forget = async (session: PanelSession) => {
    try { const result = await revokeSession(session.id); if (result.current) onLoggedOut(); else await load(); } catch { setError('Не удалось забыть сессию'); }
  };
  const signOut = async () => { try { await logout(); onLoggedOut(); } catch { setError('Не удалось завершить сессию'); } };
  return <>
    <div className="page-heading"><p>SECURITY / APPROVED BROWSERS</p><h1>Сессии</h1><span>Доступ сохраняется до явного отзыва владельцем</span></div>
    {error ? <div className="notice error">{error}</div> : null}
    <div className="session-list">{sessions?.map((session) => <section className="session-row" key={session.id}><div><span className="browser-mark">WEB</span></div><div><b>{session.label || 'Браузер'}</b><small>{session.client_metadata?.userAgent || 'Данные браузера отсутствуют'}</small></div><div><small>создана {dateLabel(session.created_at)}</small><small>активность {dateLabel(session.last_used_at)}</small></div><div>{session.current ? <button className="secondary" onClick={() => void signOut()}>Выйти</button> : <button className="danger" onClick={() => void forget(session)}>Забыть</button>}</div></section>) || <div className="notice">Загрузка сессий…</div>}</div>
  </>;
}
