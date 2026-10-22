import { useEffect, useRef } from 'react';
import { createSkyPainter } from './skyParticlePainter';

export function SkyParticles({ animate }: { animate: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const painter = useRef<ReturnType<typeof createSkyPainter>>(null);
  const activeSeconds = useRef(0);

  useEffect(() => {
    if (!canvas.current) return;
    painter.current = createSkyPainter(canvas.current);
    const resize = () => {
      painter.current?.resize();
      painter.current?.paint(activeSeconds.current);
    };
    resize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(canvas.current);
    window.addEventListener('resize', resize);
    return () => { observer?.disconnect(); window.removeEventListener('resize', resize); painter.current = null; };
  }, []);

  useEffect(() => {
    if (!animate || !painter.current) return;
    let frame = 0;
    let previous: number | null = null;
    const tick = (now: number) => {
      if (previous === null) previous = now;
      const elapsed = now - previous;
      if (elapsed >= 1000 / 30) {
        // Ignore inactive time and long stalls instead of flying forward on resume.
        activeSeconds.current += Math.min(elapsed / 1000, .1) * 2;
        previous = now;
        painter.current?.paint(activeSeconds.current);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate]);

  return <canvas ref={canvas} className="shared-space__stars" />;
}
