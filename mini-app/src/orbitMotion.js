const TAU = Math.PI * 2;
const keys = ['infrastructure', 'services', 'connections', 'parser', 'activity', 'maintenance'];
const radii = [[3.85, 2.93, -.12, 2.59, -.015, .043, .047], [5.45, 4.14, .17, 3.89, .015, .071, .105], [4.65, 3.53, .1, .04, -.02, .052, .069], [4.2, 3.19, -.11, .83, .01, .084, .135], [5.05, 3.84, .14, 5.59, .02, .061, .082], [4, 3.04, -.1, 1.55, -.01, .096, .057]];
export const ORBITS = Object.fromEntries(keys.map((key, i) => [key, { radiusX: radii[i][0], radiusY: radii[i][1], depth: radii[i][2], initialPhase: radii[i][3], tilt: radii[i][4], phaseFrequency: radii[i][5], spin: radii[i][6], index: i }]));
export const PLANET_TYPES = keys;
export function precession(type, seconds) { return ORBITS[type].tilt + .025 * Math.sin(seconds * TAU / 460); }
export function orbitPosition(type, seconds) {
  const o = ORBITS[type], phase = o.initialPhase + seconds * TAU / 124 + .05 * Math.sin(seconds * o.phaseFrequency + o.index * .8), angle = precession(type, seconds);
  const x = Math.cos(phase) * o.radiusX, y = Math.sin(phase) * o.radiusY;
  return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle), Math.sin(phase) * o.depth];
}
