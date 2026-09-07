import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError, getOverview, pollApproval, requestApproval } from './api/client';
import { AppShell, type PageKey } from './components/AppShell';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { OverviewPage } from './pages/OverviewPage';
import { SessionsPage } from './pages/SessionsPage';
import { InfrastructurePage } from './pages/InfrastructurePage';
import { ServicesPage } from './pages/ServicesPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { ParserPage } from './pages/ParserPage';
import { EventsPage } from './pages/EventsPage';
import { BackupsPage } from './pages/BackupsPage';
import type { Overview } from './types';
import './styles.css';
import './extended.css';

const pages = new Set<PageKey>(['overview', 'infrastructure', 'services', 'connections', 'parser', 'incidents', 'events', 'backups', 'sessions']);
function pageFromHash(): PageKey {
  const candidate = window.location.hash.replace(/^#\/?/, '') as PageKey;
  return pages.has(candidate) ? candidate : 'overview';
}

function LoginView({ onApproved }: { onApproved: (overview: Overview) => void }) {
  const [approvalId, setApprovalId] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!approvalId) return undefined;
    const poll = async () => {
      try {
        const result = await pollApproval(approvalId);
        if (result.state === 'approved') onApproved(await getOverview());
        if (['denied', 'expired', 'consumed', 'not_found'].includes(result.state)) {
          setApprovalId(''); setError(result.state === 'denied' ? 'Владелец отклонил доступ' : 'Запрос подтверждения истёк');
        }
      } catch (pollError) { if (!(pollError instanceof ApiError && pollError.status === 401)) setError('Не удалось проверить подтверждение'); }
    };
    void poll(); const timer = window.setInterval(() => { void poll(); }, 2000);
    return () => window.clearInterval(timer);
  }, [approvalId, onApproved]);
  const request = async () => {
    setRequesting(true); setError('');
    try { const result = await requestApproval('Operations Browser'); setApprovalId(result.id); }
    catch { setError('Telegram недоступен или запрос не отправлен'); }
    finally { setRequesting(false); }
  };
  return <main className="login"><div className="login-brand">J</div><p>JARVIS / OWNER CONTROL</p><h1>Operations<br />Console</h1><section>{approvalId ? <><b>Проверьте Telegram</b><p>Разрешите доступ этому браузеру. Окно подтверждения действует пять минут.</p><div className="waiting"><i /> ожидание решения</div></> : <><b>Закрытый административный контур</b><p>Новый браузер получает доступ только после подтверждения владельцем через основной бот Jarvis.</p><button onClick={() => void request()} disabled={requesting}>{requesting ? 'Отправка…' : 'Подтвердить в Telegram'}</button></>}{error ? <div className="inline-error">{error}</div> : null}</section></main>;
}

function App() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [page, setPage] = useState<PageKey>(pageFromHash());
  const [liveRevision, setLiveRevision] = useState(0);
  const bootstrap = useCallback(async () => {
    try { setOverview(await getOverview()); setAuthorized(true); }
    catch (error) { if (error instanceof ApiError && error.status === 401) setAuthorized(false); else setAuthorized(false); }
  }, []);
  useEffect(() => { void bootstrap(); }, [bootstrap]);
  useEffect(() => { const handler = () => setPage(pageFromHash()); window.addEventListener('hashchange', handler); return () => window.removeEventListener('hashchange', handler); }, []);
  useEffect(() => {
    if (!authorized) return undefined;
    const stream = new EventSource('/ops/api/stream');
    const refresh = () => setLiveRevision((value) => value + 1);
    stream.addEventListener('snapshot', refresh); stream.addEventListener('event', refresh); stream.addEventListener('refresh', refresh);
    stream.addEventListener('error', () => { void getOverview().catch((error) => { if (error instanceof ApiError && error.status === 401) { stream.close(); setOverview(null); setAuthorized(false); } }); });
    const timer = window.setInterval(refresh, 30000);
    return () => { window.clearInterval(timer); stream.close(); };
  }, [authorized]);
  const navigate = (next: PageKey) => { window.location.hash = `/${next}`; setPage(next); };
  if (authorized === null) return <main className="boot">JARVIS OPS / INITIALIZING</main>;
  if (!authorized || !overview) return <LoginView onApproved={(value) => { setOverview(value); setAuthorized(true); }} />;
  return <AppShell page={page} onNavigate={navigate}>
    {page === 'overview' ? <OverviewPage initial={overview} refreshToken={liveRevision} /> : null}
    {page === 'infrastructure' ? <InfrastructurePage refreshToken={liveRevision} /> : null}
    {page === 'services' ? <ServicesPage refreshToken={liveRevision} /> : null}
    {page === 'connections' ? <ConnectionsPage refreshToken={liveRevision} /> : null}
    {page === 'parser' ? <ParserPage refreshToken={liveRevision} /> : null}
    {page === 'incidents' ? <IncidentsPage refreshToken={liveRevision} /> : null}
    {page === 'events' ? <EventsPage refreshToken={liveRevision} /> : null}
    {page === 'backups' ? <BackupsPage refreshToken={liveRevision} /> : null}
    {page === 'sessions' ? <SessionsPage onLoggedOut={() => { setOverview(null); setAuthorized(false); }} /> : null}
  </AppShell>;
}

createRoot(document.getElementById('root')!).render(<App />);
