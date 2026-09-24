import type { ReactNode } from 'react';

export type PageKey = 'overview' | 'infrastructure' | 'services' | 'connections' | 'parser' | 'incidents' | 'events' | 'backups' | 'sessions';
const items: { key: PageKey; index: string; label: string }[] = [
  { key: 'overview', index: '01', label: 'Обзор' },
  { key: 'infrastructure', index: '02', label: 'Инфраструктура' },
  { key: 'services', index: '03', label: 'Сервисы' },
  { key: 'connections', index: '04', label: 'Устройства' },
  { key: 'parser', index: '05', label: 'Парсер' },
  { key: 'incidents', index: '06', label: 'Инциденты' },
  { key: 'events', index: '07', label: 'События' },
  { key: 'backups', index: '08', label: 'Резервные копии' },
  { key: 'sessions', index: '09', label: 'Сессии' },
];

export function AppShell({ page, onNavigate, children }: { page: PageKey; onNavigate: (page: PageKey) => void; children: ReactNode }) {
  return <div className="app-shell">
    <aside>
      <div className="brand"><span>J</span><div><b>JARVIS</b><small>OPERATIONS</small></div></div>
      <nav aria-label="Основная навигация">{items.map((item) => <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => onNavigate(item.key)}><i>{item.index}</i>{item.label}</button>)}</nav>
      <div className="aside-foot"><span className="signal" /> защищённый контур</div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div><span className="signal" /> LIVE DATA</div><small>OWNER CONSOLE / VPS-01</small></header>
      <main>{children}</main>
    </div>
  </div>;
}
