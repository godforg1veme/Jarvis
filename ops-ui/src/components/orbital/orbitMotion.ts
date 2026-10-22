import type { PlanetKey } from './navigation';

export type OrbitSpec = {
  radiusX: number;
  radiusY: number;
  depth: number;
  periodSeconds: number;
  initialPhase: number;
  precessionSeconds: number;
  tilt: number;
  phaseFrequency: number;
  spinRadiansPerSecond: number;
};

const TAU = Math.PI * 2;
const ORBIT_SECONDS = 124;
const PRECESSION_SECONDS = 460;
export const ORBIT_PHASE_AMPLITUDE = .05;
export const PLANET_KEYS: PlanetKey[] = ['infrastructure', 'services', 'connections', 'parser', 'activity', 'maintenance'];

export const ORBIT_SPECS: Record<PlanetKey, OrbitSpec> = {
  infrastructure: { radiusX: 3.85, radiusY: 2.93, depth: -0.12, periodSeconds: ORBIT_SECONDS, initialPhase: 2.59, precessionSeconds: PRECESSION_SECONDS, tilt: -0.015, phaseFrequency: .043, spinRadiansPerSecond: .047 },
  services: { radiusX: 5.45, radiusY: 4.14, depth: 0.17, periodSeconds: ORBIT_SECONDS, initialPhase: 3.89, precessionSeconds: PRECESSION_SECONDS, tilt: 0.015, phaseFrequency: .071, spinRadiansPerSecond: .105 },
  connections: { radiusX: 4.65, radiusY: 3.53, depth: 0.1, periodSeconds: ORBIT_SECONDS, initialPhase: 0.04, precessionSeconds: PRECESSION_SECONDS, tilt: -0.02, phaseFrequency: .052, spinRadiansPerSecond: .069 },
  parser: { radiusX: 4.2, radiusY: 3.19, depth: -0.11, periodSeconds: ORBIT_SECONDS, initialPhase: 0.83, precessionSeconds: PRECESSION_SECONDS, tilt: 0.01, phaseFrequency: .084, spinRadiansPerSecond: .135 },
  activity: { radiusX: 5.05, radiusY: 3.84, depth: 0.14, periodSeconds: ORBIT_SECONDS, initialPhase: 5.59, precessionSeconds: PRECESSION_SECONDS, tilt: 0.02, phaseFrequency: .061, spinRadiansPerSecond: .082 },
  maintenance: { radiusX: 4, radiusY: 3.04, depth: -0.1, periodSeconds: ORBIT_SECONDS, initialPhase: 1.55, precessionSeconds: PRECESSION_SECONDS, tilt: -0.01, phaseFrequency: .096, spinRadiansPerSecond: .057 },
};

const OUTER_RADII: Record<PlanetKey | 'core', number> = {
  core: 1.21,
  infrastructure: .86,
  services: .66 * 1.71 + .011,
  connections: .43 * 1.3,
  parser: .64,
  activity: .75,
  maintenance: .36 * 1.18,
};

export function getObjectBounds(key: PlanetKey | 'core', scale = 1): number {
  return OUTER_RADII[key] * scale;
}

export function orbitPhase(key: PlanetKey, elapsedSeconds: number): number {
  const orbit = ORBIT_SPECS[key];
  const index = PLANET_KEYS.indexOf(key);
  return orbit.initialPhase + elapsedSeconds * TAU / orbit.periodSeconds
    + ORBIT_PHASE_AMPLITUDE * Math.sin(elapsedSeconds * orbit.phaseFrequency + index * .8);
}

export function orbitPrecession(key: PlanetKey, elapsedSeconds: number): number {
  const orbit = ORBIT_SPECS[key];
  // A bounded nod keeps the major axis horizontal even after long idle sessions.
  return orbit.tilt + .025 * Math.sin(elapsedSeconds * TAU / orbit.precessionSeconds);
}

export function orbitPosition(key: PlanetKey, elapsedSeconds: number): [number, number, number] {
  const orbit = ORBIT_SPECS[key];
  const phase = orbitPhase(key, elapsedSeconds);
  const precession = orbitPrecession(key, elapsedSeconds);
  const x = Math.cos(phase) * orbit.radiusX;
  const y = Math.sin(phase) * orbit.radiusY;
  return [
    x * Math.cos(precession) - y * Math.sin(precession),
    x * Math.sin(precession) + y * Math.cos(precession),
    Math.sin(phase) * orbit.depth,
  ];
}

export function getAllPositions(elapsedSeconds: number): Record<PlanetKey, [number, number, number]> {
  return {
    infrastructure: orbitPosition('infrastructure', elapsedSeconds),
    services: orbitPosition('services', elapsedSeconds),
    connections: orbitPosition('connections', elapsedSeconds),
    parser: orbitPosition('parser', elapsedSeconds),
    activity: orbitPosition('activity', elapsedSeconds),
    maintenance: orbitPosition('maintenance', elapsedSeconds),
  };
}

export function safeZoomForBodies(
  width: number,
  height: number,
  focus: readonly [number, number],
  positions: Record<PlanetKey, [number, number, number]>,
  scales: Partial<Record<PlanetKey | 'core', number>> = {},
  marginPixels = 20,
): number {
  let extentX = getObjectBounds('core', scales.core ?? 1);
  let extentY = extentX;
  for (const key of PLANET_KEYS) {
    const [x, y] = positions[key];
    const radius = getObjectBounds(key, scales[key] ?? 1);
    extentX = Math.max(extentX, Math.abs(x - focus[0]) + radius);
    extentY = Math.max(extentY, Math.abs(y - focus[1]) + radius);
  }
  // The core also moves relative to the camera focus during a selection.
  extentX = Math.max(extentX, Math.abs(focus[0]) + getObjectBounds('core', scales.core ?? 1));
  extentY = Math.max(extentY, Math.abs(focus[1]) + getObjectBounds('core', scales.core ?? 1));
  return Math.min(
    Math.max(1, width / 2 - marginPixels) / extentX,
    Math.max(1, height / 2 - marginPixels) / extentY,
  );
}
