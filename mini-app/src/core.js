import * as THREE from 'three';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

// A procedural model, not a rotating raster. No external assets or API calls.
export function createCore(host, { onStatus = () => {} } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reduced.matches;
  let disposed = false;
  let visible = true;
  let frame = 0;
  let speed = 0.7;
  let elapsed = 0;
  let lastTime = 0;
  let drawCount = 0;
  let renderer;
  const listeners = new AbortController();
  const { signal } = listeners;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    host.dataset.render = 'fallback';
    onStatus('3D недоступно · статичный вид');
    return { available: false, dispose() { listeners.abort(); } };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 600 ? 1.5 : 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.prepend(renderer.domElement);
  host.dataset.render = 'webgl';
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 40);
  camera.position.set(0, 0.4, 6.8);
  camera.lookAt(0, 0, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();
  const body = new THREE.Group();
  scene.add(body);
  const light = new THREE.PointLight(0x4de1ff, 10, 10);
  light.position.set(-1.8, 1.2, 2.5);
  scene.add(light, new THREE.HemisphereLight(0xc6e5ff, 0x0a172d, 2));
  const key = new THREE.DirectionalLight(0xffffff, 5);
  key.position.set(3, 4, 3);
  scene.add(key);
  const rim = new THREE.PointLight(0x1d73ff, 16, 8);
  rim.position.set(2, -1, -1);
  scene.add(rim);
  const metal = new THREE.MeshPhysicalMaterial({ color: 0x8eafc2, metalness: 1,
    roughness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.18, envMapIntensity: 1.9 });
  const edge = new THREE.MeshStandardMaterial({ color: 0x24394d, metalness: 0.92, roughness: 0.28 });
  const cyan = new THREE.MeshBasicMaterial({ color: 0x71e8ff, toneMapped: false });
  const rings = [];
  function band(radius, width, depth) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, radius - width, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true,
      bevelSegments: 3, steps: 1, bevelSize: 0.014, bevelThickness: 0.014, curveSegments: 96 });
    geo.translate(0, 0, -depth / 2);
    return geo;
  }
  for (let i = 0; i < 4; i += 1) {
    const radius = 1.21 + i * 0.18;
    const group = new THREE.Group();
    group.add(new THREE.Mesh(band(radius, 0.10 + i * 0.012, 0.07), metal));
    const back = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.036, 0.013, 8, 128), edge);
    back.position.z = -0.052;
    group.add(back);
    // Small inlaid light arcs break up continuous rings and catch rotation.
    for (let j = 0; j < 4; j += 1) {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.04, 0.008, 6, 22, 0.38), cyan);
      arc.rotation.z = j * Math.PI / 2 + i * 0.3;
      arc.position.z = 0.046;
      group.add(arc);
    }
    for (let j = 0; j < 8; j += 1) {
      const stud = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 6), edge);
      const angle = j * Math.PI / 4;
      stud.position.set(Math.cos(angle) * (radius - 0.04), Math.sin(angle) * (radius - 0.04), 0.038);
      group.add(stud);
    }
    body.add(group);
    rings.push(group);
  }
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.86, 64, 40),
    new THREE.MeshPhysicalMaterial({ color: 0x082d4c, metalness: 0.48, roughness: 0.17,
      clearcoat: 1, clearcoatRoughness: 0.04, emissive: 0x063656, emissiveIntensity: 0.65,
      transparent: true, opacity: 0.86, envMapIntensity: 2 }));
  body.add(orb);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.9, 48, 32), new THREE.ShaderMaterial({
    uniforms: { strength: { value: 0.7 } },
    vertexShader: `varying vec3 vNormal; varying vec3 vEye;
      void main(){ vec4 p=modelViewMatrix*vec4(position,1.0); vNormal=normalize(normalMatrix*normal);
      vEye=normalize(-p.xyz); gl_Position=projectionMatrix*p; }`,
    fragmentShader: `varying vec3 vNormal; varying vec3 vEye; uniform float strength;
      void main(){ float rim=pow(1.0-max(dot(normalize(vNormal),normalize(vEye)),0.0),3.2);
      gl_FragColor=vec4(0.13,0.73,1.0,rim*strength); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  body.add(shell);
  const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(0.865, 2), new THREE.MeshBasicMaterial({
    color: 0x3cb4ee, wireframe: true, transparent: true, opacity: 0.13 }));
  body.add(wire);
  // Deterministic points avoid flicker and make visual reviews repeatable.
  const coords = new Float32Array(210 * 3);
  for (let i = 0; i < 210; i += 1) {
    const theta = i * 2.399963;
    const z = 1 - 2 * (i + 0.5) / 210;
    const s = Math.sqrt(1 - z * z);
    coords.set([0.89 * s * Math.cos(theta), 0.89 * z, 0.89 * s * Math.sin(theta)], i * 3);
  }
  const pointsGeometry = new THREE.BufferGeometry();
  pointsGeometry.setAttribute('position', new THREE.BufferAttribute(coords, 3));
  const particles = new THREE.Points(pointsGeometry, new THREE.PointsMaterial({
    color: 0xa8eaff, size: 0.016, transparent: true, opacity: 0.7, depthWrite: false,
    blending: THREE.AdditiveBlending }));
  body.add(particles);
  let targetX = -0.1, targetY = 0, x = -0.1, y = 0;
  let pointer = null;
  let contextLost = false;
  function draw(time = performance.now()) {
    if (disposed || contextLost || !visible || document.hidden || !host.getClientRects().length) return;
    const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
    lastTime = time;
    if (!paused) elapsed += delta * speed;
    const t = elapsed;
    const damping = 1 - Math.exp(-6 * delta);
    x += (targetX - x) * damping;
    y += (targetY - y) * damping;
    body.rotation.set(x + Math.sin(t * 0.32) * 0.065, y + Math.sin(t * 0.23) * 0.11, -0.08);
    body.position.y = Math.sin(t * 0.65) * 0.045;
    rings.forEach((ring, i) => {
      ring.rotation.set(0.38 + i * 0.57 + t * (i % 2 ? -0.18 : 0.15),
        i * 0.72 + t * (i % 2 ? 0.22 : -0.16), i * 0.45 + t * (0.06 + i * 0.025));
    });
    orb.rotation.y = t * 0.09;
    wire.rotation.y = -t * 0.12;
    particles.rotation.y = t * 0.08;
    shell.material.uniforms.strength.value = 0.57 + Math.sin(t * 1.6) * 0.1;
    renderer.render(scene, camera);
    drawCount += 1;
    host.dataset.frames = String(drawCount);
    if (!paused && visible && !document.hidden) frame = requestAnimationFrame(draw);
  }
  function stop() { cancelAnimationFrame(frame); frame = 0; lastTime = 0; }
  function start() {
    stop();
    if (visible && !document.hidden && !contextLost) {
      draw();
      onStatus(paused ? 'ДВИЖЕНИЕ ПРИОСТАНОВЛЕНО' : 'ИНТЕРАКТИВНОЕ ЯДРО');
    }
  }
  const resize = new ResizeObserver(() => {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (paused) draw();
  });
  resize.observe(host);
  const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; start(); });
  observer.observe(host);
  document.addEventListener('visibilitychange', start, { signal });
  host.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || paused) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }, { signal });
  host.addEventListener('pointermove', (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    targetY += (event.clientX - pointer.x) * 0.008;
    targetX = THREE.MathUtils.clamp(targetX + (event.clientY - pointer.y) * 0.004, -0.65, 0.65);
    pointer.x = event.clientX; pointer.y = event.clientY;
  }, { signal });
  const release = () => { pointer = null; };
  window.addEventListener('pointerup', release, { signal });
  window.addEventListener('pointercancel', release, { signal });
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault(); contextLost = true; stop(); host.dataset.render = 'fallback';
    onStatus('3D приостановлено · статичный вид');
  }, { signal });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    contextLost = false; host.dataset.render = 'webgl'; start();
  }, { signal });
  const onReducedChange = () => { paused = reduced.matches; start(); };
  reduced.addEventListener('change', onReducedChange);
  start();
  return {
    available: true,
    get paused() { return paused; },
    setPaused(value) { paused = value; start(); },
    setSpeed(value) { speed = THREE.MathUtils.clamp(value, 0.25, 1.8); },
    reset() { targetX = -0.1; targetY = 0; x = -0.1; y = 0; if (paused) draw(); },
    dispose() {
      if (disposed) return;
      disposed = true; stop(); listeners.abort(); resize.disconnect(); observer.disconnect();
      reduced.removeEventListener('change', onReducedChange);
      const geometries = new Set(), materials = new Set();
      scene.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) materials.add(object.material);
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      environment.dispose(); renderer.dispose(); renderer.domElement.remove();
    },
  };
}
