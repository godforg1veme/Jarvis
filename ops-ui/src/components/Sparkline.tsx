export function Sparkline({ values }: { values: number[] }) {
  const points = values.slice(-48);
  if (points.length < 2) return <div className="spark-empty">собираем историю</div>;
  const min = Math.min(...points); const max = Math.max(...points); const span = max - min || 1;
  const path = points.map((value, index) => `${(index / (points.length - 1)) * 100},${36 - ((value - min) / span) * 32}`).join(' ');
  return <svg className="spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="График последних значений"><polyline points={path} /></svg>;
}
