import { useEffect, useState } from 'react';
import { SkyParticles } from './SkyParticles';
import './shared-sky.css';

// One sky spans the scene and workspace. The UI only adds translucent shading;
// there is no independently moving wallpaper inside the inspector.
export function SharedSky({ animate }: { animate: boolean }) {
  const [hidden, setHidden] = useState(() => document.hidden);
  const [failed, setFailed] = useState(false);
  const [lowResolutionOnly, setLowResolutionOnly] = useState(false);
  useEffect(() => {
    const sync = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  const running = animate && !hidden;
  const assets = `${(import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL}assets/`;
  return <div className="shared-space" aria-hidden="true" data-motion={running ? 'running' : 'paused'}>
    {!failed && <img key={lowResolutionOnly ? '4k-fallback' : 'responsive'} className="shared-space__milky-way" src={`${assets}milky-way-gaia-4k.webp`} srcSet={lowResolutionOnly ? undefined : `${assets}milky-way-gaia-4k.webp 4096w, ${assets}milky-way-gaia-8k.webp 8192w`} sizes="(min-aspect-ratio: 3/1) 320vw, (min-aspect-ratio: 2/1) 240vw, (max-width: 900px) 490vh, 360vh" alt="" draggable={false} onError={() => { if (lowResolutionOnly) setFailed(true); else setLowResolutionOnly(true); }} />}
    <div className="shared-space__veil" />
    <SkyParticles animate={running} />
  </div>;
}
