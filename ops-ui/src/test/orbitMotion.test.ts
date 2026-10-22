import { describe, expect, it } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import { ORBIT_PHASE_AMPLITUDE, ORBIT_SPECS, PLANET_KEYS, orbitPhase, orbitPosition, orbitPrecession, getAllPositions, getObjectBounds, safeZoomForBodies } from '../components/orbital/orbitMotion';
import { planets } from '../components/orbital/navigation';
import { ambientEventAt, ambientEventStart } from '../components/orbital/orbitalEventTiming';

describe('orbital paths', () => {
  it('has an all-time fixed-plane clearance bound with selected and hover scales', () => {
    const matrix = (key: typeof PLANET_KEYS[number]) => {
      const spec = ORBIT_SPECS[key], c = Math.cos(spec.initialPhase), s = Math.sin(spec.initialPhase);
      const ca = Math.cos(spec.tilt), sa = Math.sin(spec.tilt);
      return [
        spec.radiusX * ca * c - spec.radiusY * sa * s,
        -spec.radiusX * ca * s - spec.radiusY * sa * c,
        spec.radiusX * sa * c + spec.radiusY * ca * s,
        -spec.radiusX * sa * s + spec.radiusY * ca * c,
      ];
    };
    let minimum = Infinity;
    for (const key of PLANET_KEYS) {
      const spec = ORBIT_SPECS[key];
      minimum = Math.min(minimum, Math.min(spec.radiusX, spec.radiusY) - getObjectBounds('core', 1.05) - getObjectBounds(key, 1.58));
    }
    for (let i = 0; i < PLANET_KEYS.length; i++) for (let j = i + 1; j < PLANET_KEYS.length; j++) {
      const first = PLANET_KEYS[i], second = PLANET_KEYS[j];
      const [a, b, c, d] = matrix(first).map((value, index) => value - matrix(second)[index]);
      const trace = a * a + b * b + c * c + d * d, determinant = (a * d - b * c) ** 2;
      const smallestSingular = Math.sqrt(Math.max(0, (trace - Math.sqrt(Math.max(0, trace * trace - 4 * determinant))) / 2));
      const drift = 2 * (ORBIT_SPECS[first].radiusX + ORBIT_SPECS[second].radiusX) * Math.sin(ORBIT_PHASE_AMPLITUDE / 2);
      const selectedFirst = getObjectBounds(first, 1.58) + getObjectBounds(second, 1.15);
      const selectedSecond = getObjectBounds(first, 1.15) + getObjectBounds(second, 1.58);
      minimum = Math.min(minimum, smallestSingular - drift - Math.max(selectedFirst, selectedSecond));
    }
    // The common bounded precession rotates all lanes equally, preserving this bound.
    expect(minimum).toBeGreaterThan(.15);
  });
  it('keeps outer rings and bodies apart through long sessions and hover enlargement', () => {
    let minimum = Infinity;
    for (let time = 0; time <= 4000; time += .5) {
      const positions = getAllPositions(time);
      const bodies = [{ key: 'core' as const, position: [0, 0, 0] }, ...planets.map(({ key }) => ({ key, position: positions[key] }))];
      for (let a = 0; a < bodies.length; a++) for (let b = a + 1; b < bodies.length; b++) {
        const first = bodies[a], second = bodies[b];
        const distance = Math.hypot(first.position[0] - second.position[0], first.position[1] - second.position[1]);
        // Only one planet is selected; a different hovered planet grows to 1.15.
        const scale = (key: string, value: number) => key === 'core' ? 1.05 : value;
        const radii = Math.max(getObjectBounds(first.key, scale(first.key, 1.58)) + getObjectBounds(second.key, scale(second.key, 1.15)), getObjectBounds(first.key, scale(first.key, 1.15)) + getObjectBounds(second.key, scale(second.key, 1.58)));
        minimum = Math.min(minimum, distance - radii);
      }
    }
    expect(minimum).toBeGreaterThan(.1);
  });
  it('keeps the orbital system wide during long idle periods', () => {
    for (const { key } of planets) {
      const spec = ORBIT_SPECS[key];
      for (const time of [0, 95, 190, 500, 1000, 100000]) {
        const tilt = orbitPrecession(key, time);
        expect(Math.abs(tilt - spec.tilt)).toBeLessThanOrEqual(.13);
        const horizontal = Math.hypot(spec.radiusX * Math.cos(tilt), spec.radiusY * Math.sin(tilt));
        const vertical = Math.hypot(spec.radiusX * Math.sin(tilt), spec.radiusY * Math.cos(tilt));
        expect(horizontal).toBeGreaterThan(vertical);
      }
    }
  });
  it('keeps each moving planet on its precessing ellipse', () => {
    for (const { key } of planets) {
      const spec = ORBIT_SPECS[key];
      for (const time of [0, 13, 87, 250, 5000]) {
        const [x, y, z] = orbitPosition(key, time);
        const angle = orbitPrecession(key, time);
        const localX = x * Math.cos(angle) + y * Math.sin(angle);
        const localY = -x * Math.sin(angle) + y * Math.cos(angle);
        expect((localX / spec.radiusX) ** 2 + (localY / spec.radiusY) ** 2).toBeCloseTo(1, 8);
        expect(Math.abs(z)).toBeLessThanOrEqual(Math.abs(spec.depth) + 1e-8);
      }
      expect(orbitPosition(key, 5)).not.toEqual(orbitPosition(key, 0));
      expect(orbitPrecession(key, 5)).not.toBe(orbitPrecession(key, 0));
    }
  });
  it('uses distinct bounded orbital speeds and distinct axial spins', () => {
    expect(new Set(PLANET_KEYS.map((key) => ORBIT_SPECS[key].spinRadiansPerSecond)).size).toBe(6);
    const speeds = PLANET_KEYS.map((key) => orbitPhase(key, 10.01) - orbitPhase(key, 10));
    expect(new Set(speeds.map((speed) => speed.toFixed(7))).size).toBe(6);
    for (const key of PLANET_KEYS) {
      const spec = ORBIT_SPECS[key];
      const mean = 2 * Math.PI / spec.periodSeconds;
      const variation = ORBIT_PHASE_AMPLITUDE * spec.phaseFrequency;
      expect(mean - variation).toBeGreaterThan(0);
      expect(variation / mean).toBeLessThan(.12);
    }
  });
  it('keeps orthographic silhouettes apart through focus transitions at wide and narrow viewports', () => {
    const halfFov = Math.tan(23 * Math.PI / 180);
    let minimum = Infinity, minimumZoom = Infinity;
    for (const [width, height] of [[1440, 960], [850, 900], [390, 400], [320, 480]]) {
      const aspect = width / height;
      for (const selected of [null, ...PLANET_KEYS]) {
        const camera = new OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, .1, 40);
        for (let time = 0; time <= 2400; time += 8) {
          const positions = getAllPositions(time);
          const focus = selected ? positions[selected] : [0, 0, 0];
          const overviewDistance = Math.max(13, 6.95 / (halfFov * aspect));
          const focusDistance = selected ? Math.max(9.5, 5.05 / (halfFov * aspect)) : overviewDistance;
          const startZoom = height / (2 * halfFov * overviewDistance), endZoom = height / (2 * halfFov * focusDistance);
          for (const transition of [0, .25, .5, .75, 1]) {
            camera.zoom = startZoom + (endZoom - startZoom) * transition;
            minimumZoom = Math.min(minimumZoom, camera.zoom);
            const x = focus[0] * (selected ? .45 * transition : 0), y = focus[1] * (selected ? .45 * transition : 0);
            camera.position.set(x, y, overviewDistance + (focusDistance - overviewDistance) * transition);
            camera.lookAt(x, y, 0);
            camera.updateProjectionMatrix();
            camera.updateMatrixWorld();
            const discs = [{ key: 'core' as const, position: [0, 0, 0] }, ...PLANET_KEYS.map((key) => ({ key, position: positions[key] }))].map(({ key, position }) => {
              const projected = new Vector3(...position).project(camera);
              const scale = key === 'core' ? 1.05 : key === selected ? 1.58 : 1.15;
              return { x: projected.x * width / 2, y: projected.y * height / 2, radius: getObjectBounds(key, scale) * camera.zoom };
            });
            for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) {
              minimum = Math.min(minimum, Math.hypot(discs[i].x - discs[j].x, discs[i].y - discs[j].y) - discs[i].radius - discs[j].radius);
            }
          }
        }
      }
    }
    // XY clearance scales uniformly by zoom for every camera center and transition.
    expect(minimum).toBeGreaterThan(.15 * minimumZoom);
    expect(minimum).toBeGreaterThan(3);
  });
  it('fits every body and outer ring while focus, zoom, and aspect change', () => {
    const halfFov = Math.tan(23 * Math.PI / 180);
    for (const [width, height] of [[1440, 960], [850, 900], [390, 400], [320, 480], [320, 700]]) {
      const aspect = width / height;
      const overviewDistance = Math.max(13, 6.95 / (halfFov * aspect));
      const overviewZoom = height / (2 * halfFov * overviewDistance);
      const camera = new OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, .1, 80);
      for (const from of [null, 'services', 'parser', 'activity'] as const) for (const to of [null, ...PLANET_KEYS]) {
        for (let time = 0; time <= 2400; time += 40) {
          const positions = getAllPositions(time);
          const start = from ? positions[from] : [0, 0, 0];
          const end = to ? positions[to] : [0, 0, 0];
          const startZoom = from ? height / (2 * halfFov * Math.max(9.5, 5.05 / (halfFov * aspect))) : overviewZoom;
          const endZoom = to ? height / (2 * halfFov * Math.max(9.5, 5.05 / (halfFov * aspect))) : overviewZoom;
          const scales = Object.fromEntries(PLANET_KEYS.map((key) => [key, key === to ? 1.58 : 1.15]));
          scales.core = 1.05;
          for (const transition of [0, .25, .5, .75, 1]) {
            const x = (start[0] * (from ? .45 : 0)) * (1 - transition) + (end[0] * (to ? .45 : 0)) * transition;
            const y = (start[1] * (from ? .45 : 0)) * (1 - transition) + (end[1] * (to ? .45 : 0)) * transition;
            const desiredZoom = startZoom + (endZoom - startZoom) * transition;
            camera.zoom = Math.min(desiredZoom, safeZoomForBodies(width, height, [x, y], positions, scales));
            camera.position.set(x, y, 13);
            camera.lookAt(x, y, 0);
            camera.updateProjectionMatrix();
            camera.updateMatrixWorld();
            for (const key of ['core', ...PLANET_KEYS] as const) {
              const body = key === 'core' ? [0, 0, 0] : positions[key];
              const projected = new Vector3(...body).project(camera);
              const radiusPixels = getObjectBounds(key, scales[key]) * camera.zoom;
              expect(Math.abs(projected.x * width / 2) + radiusPixels).toBeLessThanOrEqual(width / 2 - 19.5);
              expect(Math.abs(projected.y * height / 2) + radiusPixels).toBeLessThanOrEqual(height / 2 - 19.5);
            }
          }
        }
      }
    }
  });
});

describe('ambient events', () => {
  it('starts rarely, keeps deterministic long gaps, and has short envelopes', () => {
    expect(ambientEventAt(0)).toBeNull();
    for (let index = 0; index < 50; index++) {
      const start = ambientEventStart(index);
      expect(ambientEventAt(start + .8)?.index).toBe(index);
      expect(ambientEventAt(start + .8)?.progress).toBeCloseTo(.5, 8);
      expect(ambientEventAt(start + 1.61)).toBeNull();
      if (index > 0) expect(start - ambientEventStart(index - 1)).toBeGreaterThan(70);
    }
  });
});
