// Normalized, seeded positions keep the same sky through resizing and pauses.
type Star = { x: number; y: number; size: number; alpha: number; phase: number; depth: number; bright: boolean; drift: number; slope: number; glintPeriod: number; glintOffset: number; sparkles: boolean };

export function createSkyPainter(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return null;
  let seed = 281104;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const stars: Star[] = Array.from({ length: 1800 }, (_, index) => {
    const depth = index < 1080 ? 0 : index < 1680 ? 1 : 2;
    return {
      x: random(), y: random(), size: .65 + random() * (depth === 2 ? 1.1 : .9),
      alpha: .35 + random() * .55, phase: random() * Math.PI * 2, depth,
      bright: random() < .025, drift: .75 + random() * .5, slope: .2 + random() * .24,
      glintPeriod: 28 + random() * 48, glintOffset: random() * 76, sparkles: random() < .045,
    };
  });
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 48;
  const glow = sprite.getContext('2d');
  if (glow) {
    const gradient = glow.createRadialGradient(24, 24, 0, 24, 24, 24);
    gradient.addColorStop(0, '#f3f8ff');
    gradient.addColorStop(.09, '#dbe8f4d9');
    gradient.addColorStop(.24, '#afc7e047');
    gradient.addColorStop(1, '#afc7e000');
    glow.fillStyle = gradient;
    glow.fillRect(0, 0, 48, 48);
  }
  let width = 1, height = 1;
  let compact = false;
  const wrap = (value: number, size: number) => ((value % size) + size) % size;
  return {
    resize() {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      compact = width <= 900;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.ceil(width * dpr);
      canvas.height = Math.ceil(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    paint(seconds: number) {
      context.clearRect(0, 0, width, height);
      context.fillStyle = '#dae6f1';
      stars.forEach((star, index) => {
        // Skip half the stars on phones; keep all three depth layers.
        if (compact && index % 2) return;
        const speed = [.7, 2.1, 6.5][star.depth] * star.drift;
        const x = wrap(star.x * (width + 40) + seconds * speed, width + 40) - 20;
        const y = wrap(star.y * (height + 40) - seconds * speed * star.slope, height + 40) - 20;
        const bright = star.bright;
        const wave = .5 + .5 * Math.sin(seconds * (.38 + star.depth * .13) + star.phase);
        const twinkle = bright ? .4 + .6 * wave * wave : .62 + .38 * wave;
        // Each selected star has its own sparse, smoothly faded glint schedule.
        const glintTime = wrap(seconds + star.glintOffset, star.glintPeriod);
        const glint = star.sparkles && glintTime < 1.8 ? Math.sin(glintTime / 1.8 * Math.PI) ** 2 : 0;
        context.globalAlpha = Math.min(1, star.alpha * twinkle * (bright ? 1.35 : star.depth === 2 ? .8 : 1) + glint * .8);
        if ((bright || glint > .04) && glow) {
          const size = star.size * (18 + glint * 12);
          context.drawImage(sprite, x - size / 2, y - size / 2, size, size);
        }
        // A sharp core stays visible even when the faint halo is downsampled.
        context.beginPath();
        context.arc(x, y, star.size * (bright ? .9 : star.depth === 2 ? .8 : .65) * (1 + glint * .45), 0, Math.PI * 2);
        context.fill();
        if (glint > .15) {
          context.globalAlpha = glint * .55;
          const ray = star.size * glint * 4;
          context.fillRect(x - ray, y - .3, ray * 2, .6);
          context.fillRect(x - .3, y - ray, .6, ray * 2);
        }
      });
      context.globalAlpha = 1;
    },
  };
}
