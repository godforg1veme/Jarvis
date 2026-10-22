export type AmbientEvent = { index: number; kind: 'meteor' | 'glint' | 'discharge'; progress: number };

export function ambientEventStart(index: number): number {
  return 62 + index * 108 + 14 * Math.sin(index * 1.71);
}

export function ambientEventAt(activeSeconds: number): AmbientEvent | null {
  if (activeSeconds < 62) return null;
  const approximate = Math.floor((activeSeconds - 62) / 108);
  for (let index = Math.max(0, approximate - 1); index <= approximate + 1; index++) {
    const progress = (activeSeconds - ambientEventStart(index)) / 1.6;
    if (progress >= 0 && progress < 1) {
      return { index, kind: (['meteor', 'glint', 'discharge'] as const)[index % 3], progress };
    }
  }
  return null;
}
