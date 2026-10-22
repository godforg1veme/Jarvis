import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ErrorInfo, ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { planets } from './navigation';
import type { PlanetKey, SceneSelection } from './navigation';
import { ORBIT_SPECS, getAllPositions, getObjectBounds, orbitPosition, orbitPrecession, safeZoomForBodies } from './orbitMotion';
import GalacticBackdrop from './GalacticBackdrop';
import AmbientEvents from './AmbientEvents';

type Props = { selected: SceneSelection; onSelect: (selection: Exclude<SceneSelection, null>) => void; paused: boolean; reducedMotion: boolean; onReady: () => void; onFailure: () => void };
type HoverHandler = (label: string | null, event?: ThreeEvent<PointerEvent>) => void;
type Hover = { label: string; x: number; y: number } | null;

class SceneBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { this.props.onFailure(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function useSurfaceTexture(seed: number) {
  const texture = useMemo(() => {
    const width = 128, height = 64, bytes = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const grain = Math.sin(x * .37 + seed * 7) * Math.cos(y * .29 + seed * 5) + Math.sin(x * .09 + y * .16 + seed * 3) + Math.sin(x * 1.37 + y * .91) * .2;
      const fault = Math.pow(Math.max(0, Math.sin(x * .17 + Math.sin(y * .13 + seed) * 2.2)), 17);
      const circuit = Math.pow(Math.max(0, Math.cos(x * .42 + seed) * Math.cos(y * .33)), 13);
      const stratum = Math.sin(y * (.38 + seed * .025) + Math.sin(x * .08) * 1.3);
      const surface = seed % 3 === 0 ? grain + fault * 1.1 : seed % 3 === 1 ? grain * .7 + circuit * 1.5 : grain * .65 + stratum * .52;
      const shade = Math.max(17, Math.min(123, 54 + surface * 17));
      const offset = (y * width + x) * 4;
      bytes[offset] = shade; bytes[offset + 1] = shade + 2; bytes[offset + 2] = shade + 5; bytes[offset + 3] = 255;
    }
    const result = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
    result.wrapS = THREE.RepeatWrapping; result.colorSpace = THREE.SRGBColorSpace; result.needsUpdate = true;
    return result;
  }, [seed]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function Network({ radius, count, seed, opacity }: { radius: number; count: number; seed: number; opacity: number }) {
  const geometry = useMemo(() => {
    const dots: number[] = [], lines: number[] = [];
    for (let i = 0; i < count; i++) {
      const lat = Math.acos(1 - 2 * (i + .5) / count), lon = i * 2.399963 + seed * .73, r = radius * 1.015;
      dots.push(Math.sin(lat) * Math.cos(lon) * r, Math.cos(lat) * r, Math.sin(lat) * Math.sin(lon) * r);
    }
    // Irregular, sparse anchors keep the links from becoming a uniform hatch.
    const anchors: number[] = [];
    let state = seed * 10007;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const anchorCount = radius > 1 ? 110 : 46;
    for (let i = 0; i < anchorCount; i++) {
      const y = random() * 2 - 1, angle = random() * Math.PI * 2;
      const ring = Math.sqrt(1 - y * y) * radius;
      anchors.push(Math.cos(angle) * ring, y * radius, Math.sin(angle) * ring);
    }
    const edges = new Set<string>();
    for (let i = 0; i < anchorCount; i++) {
      const a = i * 3;
      let nearest = -1, next = -1, distance = Infinity, nextDistance = Infinity;
      for (let j = 0; j < anchorCount; j++) {
        if (j === i) continue;
        const b = j * 3;
        const squared = (anchors[a] - anchors[b]) ** 2 + (anchors[a + 1] - anchors[b + 1]) ** 2 + (anchors[a + 2] - anchors[b + 2]) ** 2;
        if (squared < distance) { next = nearest; nextDistance = distance; nearest = j; distance = squared; }
        else if (squared < nextDistance) { next = j; nextDistance = squared; }
      }
      for (const neighbor of [nearest, next]) {
        if (neighbor < 0) continue;
        const edge = `${Math.min(i, neighbor)}:${Math.max(i, neighbor)}`;
        if (edges.has(edge)) continue;
        edges.add(edge);
        const b = neighbor * 3;
        let previous: [number, number, number] | null = null;
        for (let step = 0; step <= 5; step++) {
          const t = step / 5;
          const x = anchors[a] * (1 - t) + anchors[b] * t, y = anchors[a + 1] * (1 - t) + anchors[b + 1] * t, z = anchors[a + 2] * (1 - t) + anchors[b + 2] * t;
          const length = Math.hypot(x, y, z);
          const surface = radius * 1.022 / length;
          const point: [number, number, number] = [x * surface, y * surface, z * surface];
          if (previous) lines.push(...previous, ...point);
          previous = point;
        }
      }
    }
    const points = new THREE.BufferGeometry(), links = new THREE.BufferGeometry();
    points.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3));
    links.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    return { points, links };
  }, [radius, count, seed]);
  useEffect(() => () => { geometry.points.dispose(); geometry.links.dispose(); }, [geometry]);
  return <>
    <points geometry={geometry.points}><pointsMaterial color="#e3ebee" size={.009} transparent opacity={opacity * .72} sizeAttenuation depthWrite={false} /></points>
    <lineSegments geometry={geometry.links}><lineBasicMaterial color="#d3dce0" transparent opacity={opacity * .42} depthWrite={false} /></lineSegments>
  </>;
}

function Rim({ radius, opacity }: { radius: number; opacity: number }) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uOpacity: { value: opacity } },
    vertexShader: 'varying vec3 n; varying vec3 v; void main(){ vec4 p=modelViewMatrix*vec4(position,1.0); n=normalize(normalMatrix*normal); v=normalize(-p.xyz); gl_Position=projectionMatrix*p; }',
    fragmentShader: 'varying vec3 n; varying vec3 v; uniform float uOpacity; void main(){ float e=pow(1.0-max(0.0,dot(normalize(n),normalize(v))),4.0); gl_FragColor=vec4(vec3(0.78,0.86,0.91),e*uOpacity); }',
  }), []);
  useEffect(() => { material.uniforms.uOpacity.value = opacity; }, [material, opacity]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh material={material}><sphereGeometry args={[radius * 1.027, 36, 24]} /></mesh>;
}

function Body({ radius, seed, core, dimmed }: { radius: number; seed: number; core?: boolean; dimmed: boolean }) {
  const texture = useSurfaceTexture(seed);
  return <>
    <mesh><sphereGeometry args={[radius, core ? 48 : 32, core ? 32 : 24]} /><meshStandardMaterial map={texture} metalness={core ? .68 : .48} roughness={core ? .41 : .65} color="#b9c3c8" /></mesh>
    <Network radius={radius} count={core ? 1150 : 245} seed={seed} opacity={dimmed ? .28 : core ? .9 : .78} />
    <Rim radius={radius} opacity={dimmed ? .25 : core ? 1.1 : .88} />
  </>;
}

function Orbit({ planetKey, dimmed, orbitRef }: { planetKey: PlanetKey; dimmed: boolean; orbitRef: (node: THREE.LineLoop | null) => void }) {
  const spec = ORBIT_SPECS[planetKey];
  const geometry = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 144; i++) {
      const phase = i / 144 * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(phase) * spec.radiusX, Math.sin(phase) * spec.radiusY, Math.sin(phase) * spec.depth));
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [spec]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <lineLoop ref={orbitRef} geometry={geometry} rotation={[0, 0, orbitPrecession(planetKey, 0)]}><lineBasicMaterial color="#b8c5cb" transparent opacity={dimmed ? .07 : .2} depthWrite={false} /></lineLoop>;
}

function RingGrains({ radius, dimmed }: { radius: number; dimmed: boolean }) {
  const geometry = useMemo(() => {
    const points = new Float32Array(180 * 3);
    for (let i = 0; i < 180; i++) {
      const angle = i * 2.399963;
      const ring = radius * (1.23 + ((i * 37) % 47) / 47 * .48);
      points[i * 3] = Math.cos(angle) * ring;
      points[i * 3 + 1] = Math.sin(angle) * ring;
      points[i * 3 + 2] = Math.sin(i * 12.17) * .009;
    }
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.BufferAttribute(points, 3));
    return result;
  }, [radius]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <points geometry={geometry}><pointsMaterial color="#dbe4e8" size={.009} transparent opacity={dimmed ? .16 : .54} sizeAttenuation depthWrite={false} /></points>;
}

function Core({ dimmed, onClick, onHover, coreRef }: { dimmed: boolean; onClick: () => void; onHover: HoverHandler; coreRef: (node: THREE.Group | null) => void }) {
  const { gl } = useThree(); const [hovered, setHovered] = useState(false);
  useEffect(() => () => { gl.domElement.style.cursor = ''; }, [gl]);
  return <group ref={coreRef} scale={hovered ? 1.05 : 1}
    onClick={(event) => { event.stopPropagation(); onClick(); }}
    onPointerOver={(event) => { event.stopPropagation(); setHovered(true); gl.domElement.style.cursor = 'pointer'; onHover('Ядро · Обзор', event); }}
    onPointerMove={(event) => { event.stopPropagation(); onHover('Ядро · Обзор', event); }}
    onPointerOut={() => { setHovered(false); gl.domElement.style.cursor = ''; onHover(null); }}>
    <Body radius={1.14} seed={11} core dimmed={dimmed} />
    <mesh rotation={[.55, -.3, .1]}><torusGeometry args={[1.19, .005, 3, 72, Math.PI * .68]} /><meshBasicMaterial color="#d5e0e6" transparent opacity={dimmed ? .08 : .34} depthWrite={false} /></mesh>
    <mesh rotation={[-.45, .6, 1.2]}><torusGeometry args={[1.205, .004, 3, 72, Math.PI * .42]} /><meshBasicMaterial color="#d5e0e6" transparent opacity={dimmed ? .07 : .26} depthWrite={false} /></mesh>
  </group>;
}

function Planet({ data, index, selected, dimmed, onClick, onHover, planetRef, spinRef }: {
  data: typeof planets[number]; index: number; selected: boolean; dimmed: boolean; onClick: (key: PlanetKey) => void; onHover: HoverHandler;
  planetRef: (node: THREE.Group | null) => void; spinRef: (node: THREE.Group | null) => void;
}) {
  const { gl } = useThree(); const [hovered, setHovered] = useState(false);
  useEffect(() => () => { gl.domElement.style.cursor = ''; }, [gl]);
  return <group ref={planetRef} position={orbitPosition(data.key, 0)} scale={selected ? (hovered ? 1.58 : 1.46) : hovered ? 1.15 : 1}
    onClick={(event) => { event.stopPropagation(); onClick(data.key); }}
    onPointerOver={(event) => { event.stopPropagation(); setHovered(true); gl.domElement.style.cursor = 'pointer'; onHover(data.label, event); }}
    onPointerMove={(event) => { event.stopPropagation(); onHover(data.label, event); }}
    onPointerOut={() => { setHovered(false); gl.domElement.style.cursor = ''; onHover(null); }}>
    <group ref={spinRef}>
      <Body radius={data.radius} seed={index + 1} dimmed={dimmed} />
      {data.key === 'services' && <group rotation={[.49, .1, -.23]}>{[1.3, 1.48, 1.65].map((factor) => <mesh key={factor}><torusGeometry args={[data.radius * factor, factor === 1.48 ? .007 : .011, 4, 96]} /><meshBasicMaterial color="#d6dfe4" transparent opacity={dimmed ? .23 : .72} depthWrite={false} /></mesh>)}<RingGrains radius={data.radius} dimmed={dimmed} /></group>}
      {data.key === 'connections' && <mesh rotation={[.3, .1, .2]}><torusGeometry args={[data.radius * 1.3, .007, 4, 64]} /><meshBasicMaterial color="#c8d4d9" transparent opacity={dimmed ? .13 : .38} /></mesh>}
      {(data.key === 'infrastructure' || data.key === 'activity') && <mesh position={[data.radius * 1.42, data.radius * .36, 0]}><icosahedronGeometry args={[data.radius * .12, 1]} /><meshStandardMaterial color="#909da4" metalness={.71} roughness={.48} /></mesh>}
      {data.key === 'maintenance' && <mesh rotation={[.18, .55, -.3]}><torusGeometry args={[data.radius * 1.18, .004, 3, 64, Math.PI * 1.25]} /><meshBasicMaterial color="#c4d0d6" transparent opacity={dimmed ? .12 : .31} /></mesh>}
      {data.key === 'parser' && <mesh position={[-data.radius * 1.5, -.08, .05]}><octahedronGeometry args={[data.radius * .16, 0]} /><meshStandardMaterial color="#7e8c94" metalness={.66} roughness={.45} /></mesh>}
    </group>
  </group>;
}

function System({ selected, onSelect, paused, reducedMotion, onReady, onHover, labels }: Omit<Props, 'onFailure'> & { onHover: HoverHandler; labels: React.RefObject<Record<string, HTMLDivElement | null>> }) {
  const { camera, gl, events, invalidate, size } = useThree();
  const orthographicCamera = camera as THREE.OrthographicCamera;
  const elapsed = useRef(0), ready = useRef(false), lookAt = useRef(new THREE.Vector3()), destination = useRef(new THREE.Vector3()), focus = useRef(new THREE.Vector3()), projected = useRef(new THREE.Vector3());
  const hoverRaycastTime = useRef(0);
  const pointerInside = useRef(false);
  useEffect(() => {
    const canvas = gl.domElement;
    const enter = (event: PointerEvent) => { pointerInside.current = event.pointerType !== 'touch'; };
    const leave = () => { pointerInside.current = false; };
    canvas.addEventListener('pointermove', enter);
    canvas.addEventListener('pointerleave', leave);
    return () => { canvas.removeEventListener('pointermove', enter); canvas.removeEventListener('pointerleave', leave); };
  }, [gl]);
  const core = useRef<THREE.Group | null>(null), planetsRef = useRef<Partial<Record<PlanetKey, THREE.Group | null>>>({}), spins = useRef<Partial<Record<PlanetKey, THREE.Group | null>>>({}), orbits = useRef<Partial<Record<PlanetKey, THREE.LineLoop | null>>>({});
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => { const check = () => setVisible(!document.hidden); document.addEventListener('visibilitychange', check); return () => document.removeEventListener('visibilitychange', check); }, []);
  useEffect(() => { invalidate(); }, [selected, paused, reducedMotion, visible, size.width, size.height, invalidate]);
  useFrame((_, delta) => {
    if (!ready.current) { ready.current = true; onReady(); }
    const renderVisible = visible && !document.hidden;
    const animate = !paused && !reducedMotion && renderVisible;
    if (animate) elapsed.current += Math.min(delta, .05);
    const time = elapsed.current, positions = getAllPositions(time);
    const selectedPosition = selected && selected !== 'core' ? positions[selected] : [0, 0, 0];
    if (animate && core.current) core.current.rotation.y += Math.min(delta, .05) * .08;
    for (const planet of planets) {
      const coords = positions[planet.key], node = planetsRef.current[planet.key], spin = spins.current[planet.key], orbit = orbits.current[planet.key];
      if (node) node.position.set(...coords);
      if (orbit) orbit.rotation.z = orbitPrecession(planet.key, time);
      if (animate && spin) spin.rotation.y += Math.min(delta, .05) * ORBIT_SPECS[planet.key].spinRadiansPerSecond;
    }
    const aspect = Math.max(.3, size.width / Math.max(1, size.height)), halfFov = Math.tan(THREE.MathUtils.degToRad(23));
    const overviewDistance = Math.max(13, 6.95 / (halfFov * aspect)), focusDistance = Math.max(9.5, 5.05 / (halfFov * aspect));
    const fraction = selected && selected !== 'core' ? .45 : 0;
    focus.current.set(selectedPosition[0] * fraction, selectedPosition[1] * fraction, 0);
    destination.current.set(focus.current.x, focus.current.y, selected ? focusDistance : overviewDistance);
    const easing = reducedMotion ? 1 : 1 - Math.exp(-Math.min(delta, .05) * 3.6);
    const targetZoom = size.height / (2 * halfFov * destination.current.z);
    if (renderVisible) {
      lookAt.current.lerp(focus.current, easing);
      orthographicCamera.position.set(lookAt.current.x, lookAt.current.y, THREE.MathUtils.lerp(orthographicCamera.position.z, destination.current.z, easing));
      const scales: Partial<Record<PlanetKey | 'core', number>> = { core: core.current?.scale.x ?? 1 };
      for (const planet of planets) scales[planet.key] = planetsRef.current[planet.key]?.scale.x ?? 1;
      const safeZoom = safeZoomForBodies(size.width, size.height, [lookAt.current.x, lookAt.current.y], positions, scales);
      orthographicCamera.zoom = Math.min(THREE.MathUtils.lerp(orthographicCamera.zoom, targetZoom, easing), safeZoom);
      orthographicCamera.updateProjectionMatrix();
      orthographicCamera.lookAt(lookAt.current);
      orthographicCamera.updateMatrixWorld();
    }
    type Disc = { key: PlanetKey | 'core'; x: number; y: number; radius: number };
    type Rect = { left: number; top: number; right: number; bottom: number };
    const discs: Disc[] = [];
    for (const key of ['core', ...planets.map((planet) => planet.key)] as (PlanetKey | 'core')[]) {
      const coords = key === 'core' ? [0, 0, 0] : positions[key];
      projected.current.set(coords[0], coords[1], coords[2]).project(camera);
      const scale = key === 'core' ? core.current?.scale.x ?? 1 : planetsRef.current[key]?.scale.x ?? 1;
      const projectedRadius = getObjectBounds(key, scale) * orthographicCamera.zoom;
      discs.push({ key, x: (projected.current.x * .5 + .5) * size.width, y: (-projected.current.y * .5 + .5) * size.height, radius: projectedRadius });
    }
    const accepted: Rect[] = [];
    const ordered = selected ? [selected, ...discs.map((disc) => disc.key).filter((key) => key !== selected)] : discs.map((disc) => disc.key);
    for (const key of ordered) {
      const label = labels.current[key]; if (!label) continue;
      if (key === 'core' && selected === null) { label.style.opacity = '0'; continue; }
      const disc = discs.find((item) => item.key === key)!;
      const width = label.offsetWidth || 85, height = label.offsetHeight || 14;
      const candidates = [
        { x: disc.x, y: disc.y + disc.radius + 11 },
        { x: disc.x, y: disc.y + disc.radius + height + 19 },
        { x: disc.x, y: disc.y - disc.radius - height - 12 },
        { x: disc.x + disc.radius + width / 2 + 13, y: disc.y - height / 2 },
      ];
      let position: { x: number; y: number; rect: Rect } | null = null;
      for (const candidate of candidates) {
        const rect = { left: candidate.x - width / 2, right: candidate.x + width / 2, top: candidate.y, bottom: candidate.y + height };
        if (rect.left < 7 || rect.right > size.width - 7 || rect.top < 7 || rect.bottom > size.height - 7) continue;
        if (accepted.some((other) => rect.left < other.right + 6 && rect.right + 6 > other.left && rect.top < other.bottom + 5 && rect.bottom + 5 > other.top)) continue;
        if (discs.some((body) => {
          const nearX = Math.max(rect.left, Math.min(body.x, rect.right)), nearY = Math.max(rect.top, Math.min(body.y, rect.bottom));
          return Math.hypot(nearX - body.x, nearY - body.y) < body.radius + 5;
        })) continue;
        position = { x: candidate.x, y: candidate.y, rect }; break;
      }
      if (position) {
        label.style.transform = `translate(-50%, 0) translate(${position.x}px, ${position.y}px)`;
        label.style.opacity = '1'; accepted.push(position.rect);
      } else label.style.opacity = '0';
    }
    const scales: Partial<Record<PlanetKey | 'core', number>> = { core: core.current?.scale.x ?? 1 };
    for (const planet of planets) scales[planet.key] = planetsRef.current[planet.key]?.scale.x ?? 1;
    const safeZoom = safeZoomForBodies(size.width, size.height, [lookAt.current.x, lookAt.current.y], positions, scales);
    const achievableZoom = Math.min(targetZoom, safeZoom);
    const moving = Math.abs(orthographicCamera.zoom - achievableZoom) > .01 || Math.abs(orthographicCamera.position.z - destination.current.z) > .006 || lookAt.current.distanceTo(focus.current) > .006;
    if ((animate || moving) && renderVisible && pointerInside.current) {
      hoverRaycastTime.current += delta;
      if (hoverRaycastTime.current >= .11) {
        hoverRaycastTime.current = 0;
        events.update?.();
      }
    } else hoverRaycastTime.current = 0;
    if (renderVisible && (animate || moving)) invalidate();
  }, -1);
  return <>
    <ambientLight intensity={.19} />
    <directionalLight position={[-4, 6, 8]} color="#d7e0e5" intensity={2.6} /><directionalLight position={[4, -2, -3]} color="#93a7b2" intensity={1.25} />
    <GalacticBackdrop animate={!paused && !reducedMotion && visible} />
    <AmbientEvents animate={!paused && !reducedMotion && visible} />
    {planets.map((planet) => <Orbit key={planet.key} planetKey={planet.key} dimmed={Boolean(selected)} orbitRef={(node) => { orbits.current[planet.key] = node; }} />)}
    <Core dimmed={Boolean(selected && selected !== 'core')} onClick={() => onSelect('core')} onHover={onHover} coreRef={(node) => { core.current = node; }} />
    {planets.map((planet, index) => <Planet key={planet.key} data={planet} index={index} selected={selected === planet.key} dimmed={Boolean(selected && selected !== planet.key)} onClick={onSelect} onHover={onHover} planetRef={(node) => { planetsRef.current[planet.key] = node; }} spinRef={(node) => { spins.current[planet.key] = node; }} />)}
  </>;
}

const labelStyle: CSSProperties = { position: 'absolute', top: 0, left: 0, color: '#d0d9de', font: '400 12px/1.15 system-ui, sans-serif', letterSpacing: '.02em', textShadow: '0 1px 7px #050607', whiteSpace: 'nowrap', opacity: 0 };

export default function OrbitalScene(props: Props) {
  const container = useRef<HTMLDivElement>(null), labels = useRef<Record<string, HTMLDivElement | null>>({});
  const [hover, setHover] = useState<Hover>(null);
  const onHover = useCallback<HoverHandler>((label, event) => {
    if (!label || !event || !container.current) { setHover((previous) => previous === null ? previous : null); return; }
    const bounds = container.current.getBoundingClientRect();
    const x = Math.max(8, Math.min(event.nativeEvent.clientX - bounds.left + 18, bounds.width - 155));
    const y = Math.max(8, Math.min(event.nativeEvent.clientY - bounds.top + 16, bounds.height - 40));
    setHover((previous) => previous?.label === label && previous.x === x && previous.y === y ? previous : { label, x, y });
  }, []);
  useEffect(() => { setHover(null); }, [props.selected]);
  return <SceneBoundary onFailure={props.onFailure}><div ref={container} style={{ position: 'relative', width: '100%', height: '100%' }}>
    <Canvas orthographic frameloop="demand" dpr={[1, 1.5]} camera={{ position: [0, 0, 13], near: .1, far: 80 }} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onCreated={({ gl, raycaster, camera, size }) => {
        const orthographic = camera as THREE.OrthographicCamera;
        const aspect = Math.max(.3, size.width / Math.max(1, size.height));
        const halfFov = Math.tan(THREE.MathUtils.degToRad(23));
        const distance = Math.max(13, 6.95 / (halfFov * aspect));
        orthographic.position.z = distance;
        orthographic.zoom = Math.min(size.height / (2 * halfFov * distance), safeZoomForBodies(size.width, size.height, [0, 0], getAllPositions(0)));
        orthographic.updateProjectionMatrix();
        // Default point/line thresholds create oversized invisible hit regions.
        raycaster.params.Points.threshold = .025;
        raycaster.params.Line.threshold = .025;
        gl.domElement.addEventListener('webglcontextlost', props.onFailure, { once: true });
      }} style={{ width: '100%', height: '100%', display: 'block' }} aria-label="Интерактивная система мониторинга Jarvis">
      <System {...props} onHover={onHover} labels={labels} />
    </Canvas>
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <div ref={(node) => { labels.current.core = node; }} style={labelStyle}>JARVIS</div>
      {planets.map((planet) => <div key={planet.key} ref={(node) => { labels.current[planet.key] = node; }} style={labelStyle}>{planet.label}</div>)}
    </div>
    {hover && <div role="status" style={{ position: 'absolute', left: hover.x, top: hover.y, pointerEvents: 'none', padding: '7px 10px', color: '#e9edef', background: 'rgba(8,10,12,.94)', border: '1px solid rgba(210,217,222,.28)', borderRadius: 4, font: '500 12px/1.2 system-ui,sans-serif', whiteSpace: 'nowrap', zIndex: 2 }}>{hover.label}</div>}
  </div></SceneBoundary>;
}
