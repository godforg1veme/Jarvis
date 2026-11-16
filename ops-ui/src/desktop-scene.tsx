import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import OrbitalScene from './components/orbital/OrbitalScene';
import { SharedSky } from './components/orbital/SharedSky';
import type { SceneSelection } from './components/orbital/navigation';
import './desktop-scene.css';

const destinations = { core: 'assistant', infrastructure: 'life', services: 'memory', connections: 'devices', parser: 'jobs', activity: 'operations', maintenance: 'documents' } as const;
const captions = { core: 'JARVIS', infrastructure: 'Life OS', services: 'Память', connections: 'Устройства', parser: 'Поиск работы', activity: 'Панель управления', maintenance: 'Документы' };

function DesktopScene() {
  const [paused, setPaused] = useState(document.body.dataset.scenePaused === 'true');
  const [reduced, setReduced] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<SceneSelection>(null);
  const onReady = useCallback(() => setReady(true), []);
  const onFailure = useCallback(() => setFailed(true), []);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = (event: Event) => setPaused((event as CustomEvent).detail?.paused === true);
    const preference = () => setReduced(query.matches);
    const selection = () => {
      const page = document.body.dataset.desktopView;
      const key = Object.keys(destinations).find((key) => destinations[key as keyof typeof destinations] === page);
      setSelected((key as SceneSelection) ?? null);
    };
    const observer = new MutationObserver(selection);
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-desktop-view'] });
    selection();
    window.addEventListener('desktop:motion', motion);
    query.addEventListener('change', preference);
    return () => { observer.disconnect(); window.removeEventListener('desktop:motion', motion); query.removeEventListener('change', preference); };
  }, []);
  const select = (key: Exclude<SceneSelection, null>) => {
    document.querySelector<HTMLButtonElement>(`[data-desktop-page="${destinations[key]}"]`)?.click();
  };
  return <>
    <SharedSky animate={!paused && !reduced} assetBase="../orbital/assets/" />
    <div className="desktop-original-universe" data-scene-state={failed ? 'fallback' : ready ? 'ready' : 'loading'}>
      {!failed && <OrbitalScene selected={selected} onSelect={select} paused={paused} reducedMotion={reduced}
        navigationLabels={captions}
        onReady={onReady} onFailure={onFailure} />}
      {failed && <div className="desktop-original-fallback" aria-hidden="true"><i /><b /></div>}
    </div>
  </>;
}

const mount = document.getElementById('desktop-original-scene');
if (mount) createRoot(mount).render(<DesktopScene />);
