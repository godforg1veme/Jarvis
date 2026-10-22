import { useEffect, useState } from 'react';

// One sky spans the scene and workspace. The UI only adds translucent shading;
// there is no independently moving wallpaper inside the inspector.
export function SharedSky({ animate }: { animate: boolean }) {
  const [hidden, setHidden] = useState(() => document.hidden);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const sync = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  return <div className="shared-space" aria-hidden="true" data-motion={animate && !hidden ? 'running' : 'paused'}>
    {!failed && <img src={`${(import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL}assets/milky-way-reference-narrow.webp`} alt="" draggable={false} onError={() => setFailed(true)} />}
  </div>;
}
