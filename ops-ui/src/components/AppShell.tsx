import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { dateLabel, statusLabels } from '../format';
import type { Overview } from '../types';
import { dockForPage, dockItems, pageLabels, planetForPage, pagesForPlanet, type PageKey, type SceneSelection } from './orbital/navigation';
import { InterfaceIcon } from './orbital/InterfaceIcon';
import { SectionSearch } from './orbital/SectionSearch';
import { SharedSky } from './orbital/SharedSky';
export type { PageKey } from './orbital/navigation';

const OrbitalScene = lazy(() => import('./orbital/OrbitalScene'));

class SceneBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function hasRoute() { return /^#\/?[a-z]+$/.test(window.location.hash); }

export function AppShell({ page, onNavigate, children, overview, dataStale = false }: {
  page: PageKey; onNavigate: (page: PageKey) => void; children: ReactNode; overview?: Overview; dataStale?: boolean;
}) {
  const [open, setOpen] = useState(hasRoute);
  const [shown, setShown] = useState(hasRoute);
  const [expanded, setExpanded] = useState(false);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const focusWorkspace = useRef(false);
  const reducedMotion = useReducedMotion();
  const selected: SceneSelection = open ? planetForPage(page) : null;
  const retained = useRef({ page, children });
  if (open) retained.current = { page, children };
  const displayPage = open ? page : retained.current.page;
  const group = dockForPage(displayPage).pages;

  useEffect(() => {
    if (open) { setShown(true); return; }
    if (reducedMotion) { setShown(false); return; }
    const timer = window.setTimeout(() => setShown(false), 450);
    return () => window.clearTimeout(timer);
  }, [open, reducedMotion]);

  useEffect(() => { setOpen(hasRoute()); }, [page]);
  useEffect(() => {
    const sync = () => { setOpen(hasRoute()); setExpanded(false); };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const close = useCallback(() => {
    const origin = dockForPage(page).key;
    setOpen(false); setExpanded(false); window.location.hash = '';
    document.querySelector<HTMLButtonElement>(`[data-nav="${origin}"]`)?.focus({ preventScroll: true });
  }, [page]);
  useEffect(() => {
    if (open && focusWorkspace.current) {
      document.getElementById('workspace-content')?.focus({ preventScroll: true });
      if (window.innerWidth <= 900) document.querySelector('.orbital-workspace')?.scrollIntoView({ block: 'start', behavior: 'instant' });
      focusWorkspace.current = false;
    }
  }, [open, page]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      // Native service dialogs own Escape while open.
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open], .modal-backdrop')) close();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [close]);

  const navigate = (next: PageKey) => {
    if (document.querySelector('dialog[open], .modal-backdrop')) return;
    focusWorkspace.current = true; setOpen(true); setExpanded(false); onNavigate(next);
  };
  const select = (key: Exclude<SceneSelection, null>) => { const next = pagesForPlanet(key)[0]; if (next) navigate(next); };
  const working = overview?.services.filter((service) => ['healthy', 'online'].includes(service.state)).length ?? 0;

  return <div className={`orbital-app${open ? ' is-focused' : shown ? ' is-returning' : ''}${expanded ? ' is-expanded' : ''}`}>
    <SharedSky animate={!paused && !reducedMotion && !failed} />
    <a className="skip-to-workspace" href={open ? '#workspace-content' : '#orbital-navigation'} onClick={(event) => { event.preventDefault(); document.getElementById(open ? 'workspace-content' : 'orbital-navigation')?.focus(); }}>Перейти к разделам</a>
    <header className="orbital-header"><SectionSearch onNavigate={navigate} /></header>
    <div className="orbital-body">
      <section className="universe" aria-label="Система Jarvis">
        {!open && <h1 className="sr-only">Система Jarvis.</h1>}
        <div className="orbital-canvas" data-testid="orbital-canvas" data-scene-state={failed ? 'fallback' : ready ? 'ready' : 'loading'}>
          {!failed ? <SceneBoundary onFailure={() => setFailed(true)}><Suspense fallback={null}><OrbitalScene selected={selected} onSelect={select} paused={paused} reducedMotion={reducedMotion} onReady={() => setReady(true)} onFailure={() => setFailed(true)} /></Suspense></SceneBoundary> : <div className="scene-fallback" aria-hidden="true"><i /><i /><i /><b /></div>}
        </div>
        {!open && <div className="core-caption" aria-hidden="true">J A R V I S</div>}
        <div className="universe-bottom"><span>{failed ? '3D недоступно · разделы доступны ниже' : !ready ? 'Загрузка пространства…' : ''}</span><button onClick={() => setPaused(!paused)} aria-pressed={paused} disabled={failed || reducedMotion} aria-label={paused ? 'Продолжить анимацию' : 'Приостановить анимацию'} title={reducedMotion ? 'Уменьшение движения включено в системе' : paused ? 'Продолжить анимацию' : 'Пауза'}><InterfaceIcon name={paused || reducedMotion ? 'play' : 'pause'} /></button></div>
      </section>
      {(open || shown) && <section className={`orbital-workspace${!open ? ' is-closing' : ''}`} inert={!open} aria-hidden={!open || undefined} aria-label={`Рабочая область: ${pageLabels[displayPage]}`}>
        <div className="workspace-toolbar"><span className="workspace-crumb">{pageLabels[displayPage]}</span><div><button onClick={() => setExpanded(!expanded)} aria-label={expanded ? 'Свернуть рабочую область' : 'Расширить рабочую область'} aria-pressed={expanded}><InterfaceIcon name={expanded ? 'collapse' : 'expand'} /></button><button onClick={close} aria-label="Закрыть рабочую область"><InterfaceIcon name="close" /></button></div></div>
        {group.length > 1 && <nav className="workspace-tabs" aria-label="Подразделы">{group.map((key) => <button key={key} onClick={() => navigate(key)} aria-current={page === key ? 'page' : undefined}>{pageLabels[key]}</button>)}</nav>}
        <main id="workspace-content" tabIndex={-1} key={displayPage}>{open ? children : retained.current.children}</main>
      </section>}
    </div>
    <nav id="orbital-navigation" className="orbital-navigation" aria-label="Основная навигация" tabIndex={-1}>
      {dockItems.map((item) => <button key={item.key} data-nav={item.key} className={open && dockForPage(page).key === item.key ? 'active' : ''} onClick={() => navigate(item.pages[0])} aria-label={item.label} title={item.label} aria-current={open && dockForPage(page).key === item.key ? 'page' : undefined}><InterfaceIcon name={item.icon} /></button>)}
    </nav>
    <footer className="orbital-footer"><span><i className={`status-dot ${dataStale ? 'unknown' : overview?.status ?? 'unknown'}`} />{dataStale ? 'Нет связи · последние данные' : overview ? statusLabels[overview.status] || overview.status : 'Нет данных'}<span className="footer-divider">/</span>{overview ? `${working} из ${overview.services.length} сервисов работают` : 'Сервисы не загружены'}</span><span>Последний сигнал: {dateLabel(overview?.last_contact_at ?? null)}</span></footer>
  </div>;
}
