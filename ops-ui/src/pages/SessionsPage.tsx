import { useRef, useState } from 'react';
import { getSessions, logout, revokeSession } from '../api/client';
import { dateLabel } from '../format';
import type { PanelSession } from '../types';
import { useOperationsRead } from '../hooks/useOperationsRead';
import { PageHeading } from '../components/PageHeading';
import { ReadState } from '../components/ReadState';

export function SessionsPage({ onLoggedOut }: { onLoggedOut: () => void }) {
  const sessionData = useOperationsRead<PanelSession[]>(getSessions);
  const sessions = sessionData.data;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const forget = async (session: PanelSession) => {
    if (pending.current || sessionData.failed || sessionData.loading) return;
    pending.current = true; setBusy(true); setError('');
    try { const result = await revokeSession(session.id); if (result.current) onLoggedOut(); else sessionData.retry(); } catch { setError('Не удалось забыть сессию'); }
    finally { pending.current = false; setBusy(false); }
  };
  const signOut = async () => {
    if (pending.current || sessionData.failed || sessionData.loading) return;
    pending.current = true; setBusy(true); setError('');
    try { await logout(); onLoggedOut(); } catch { setError('Не удалось завершить сессию'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <>
    <PageHeading title="Сессии" description="Браузеры с разрешённым доступом к панели" />
    <ReadState {...sessionData} hasData={sessions !== null} label="сессии" />
    {error ? <div className="notice error">{error}</div> : null}
    {sessions?.length === 0 ? <p className="notice">Сохранённых сессий нет.</p> : null}<div className="session-list">{sessions?.map((session) => <section className="session-row" key={session.id}><div><span className="browser-mark">WEB</span></div><div><b>{session.label || 'Браузер'}</b><small>{session.client_metadata?.userAgent || 'Данные браузера отсутствуют'}</small></div><div><small>создана {dateLabel(session.created_at)}</small><small>активность {dateLabel(session.last_used_at)}</small></div><div>{session.current ? <button className="secondary" disabled={busy || sessionData.failed || sessionData.loading} onClick={() => void signOut()}>Выйти</button> : <button className="danger" disabled={busy || sessionData.failed || sessionData.loading} onClick={() => void forget(session)}>Забыть</button>}</div></section>)}</div>
  </>;
}
