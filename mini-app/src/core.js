import * as THREE from 'three';
import { createCoreBody, createPlanetBody, bounds } from './orbitalBodies.js';
import { PLANET_TYPES, ORBITS, orbitPosition, precession } from './orbitMotion.js';

export function createCore(host, { onStatus = () => {}, items = [], onSelect = () => {}, onMotionChange = () => {} } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const personalKeys = ['assistant', 'memory', 'documents', 'devices', 'life', 'jobs'];
  const entries = items.filter((item) => item && personalKeys.includes(item.key) && typeof item.label === 'string').slice(0, 6);
  const controller = new AbortController(), { signal } = controller;
  let manualPause = false, motionRequested = false, workspace = false, visible = true, disposed = false, contextLost = false;
  let elapsed = 0, speed = .7, frame = 0, lastFrame = 0, lastTick = 0, drawCount = 0, focusPause = false, hoverPause = false, sphereHover = false;
  let renderer;
  const paused = () => manualPause || (reduced.matches && !motionRequested);
  const requestPause = (value) => { manualPause = Boolean(value); motionRequested = !manualPause; };
  const setWorkspace = (value) => {
    workspace = Boolean(value);
    // A touch or pointer from the previous view must not leave the scene paused.
    focusPause = false; hoverPause = false; sphereHover = false;
  };
  const moving = () => !paused() && !workspace && !focusPause && !hoverPause && !sphereHover && !contextLost && !disposed && visible && !document.hidden;
  const reportMotion = () => onMotionChange({ paused: paused(), moving: moving() });
  function fallback() {
    host.dataset.render = 'fallback'; onStatus('3D недоступно · статичный вид');
    return { available: false, get paused() { return paused(); }, setPaused(value) { requestPause(value); reportMotion(); }, setWorkspace(value) { setWorkspace(value); reportMotion(); }, dispose() { controller.abort(); } };
  }
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); }
  catch { return fallback(); }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-hidden', 'true'); host.prepend(renderer.domElement); host.dataset.render = 'webgl';
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 80);
  camera.position.z = 13;
  scene.add(new THREE.AmbientLight(0xffffff, .19));
  const key = new THREE.DirectionalLight('#d7e0e5', 2.6); key.position.set(-4, 6, 8); scene.add(key);
  const fill = new THREE.DirectionalLight('#93a7b2', 1.25); fill.position.set(4, -2, -3); scene.add(fill);
  const core = createCoreBody(); scene.add(core.group);
  const planets = entries.map((item) => {
    const index = personalKeys.indexOf(item.key);
    const type = PLANET_TYPES[index], model = createPlanetBody(index), holder = new THREE.Group();
    holder.add(model.group); scene.add(holder);
    const spec = ORBITS[type], path = [];
    for (let i = 0; i < 144; i++) { const phase = i / 144 * Math.PI * 2; path.push(new THREE.Vector3(Math.cos(phase) * spec.radiusX, Math.sin(phase) * spec.radiusY, Math.sin(phase) * spec.depth)); }
    const orbit = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(path), new THREE.LineBasicMaterial({ color: '#b8c5cb', transparent: true, opacity: .2, depthWrite: false }));
    const pathGroup = new THREE.Group(); pathGroup.add(orbit); scene.add(pathGroup);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'planet-target'; button.dataset.planet = item.key; button.setAttribute('aria-label', 'Открыть раздел: ' + item.label); button.textContent = item.label;
    host.append(button);
    button.addEventListener('click', () => onSelect(item.key), { signal });
    button.addEventListener('focus', () => { focusPause = true; sync(); }, { signal });
    button.addEventListener('blur', () => { focusPause = false; sync(); }, { signal });
    button.addEventListener('pointerenter', (event) => { if (event.pointerType !== 'mouse') return; hoverPause = true; sync(); }, { signal });
    button.addEventListener('pointerleave', (event) => { if (event.pointerType !== 'mouse') return; hoverPause = false; sync(); }, { signal });
    return { item, type, model, holder, orbit, pathGroup, button, bound: bounds[index] };
  });
  const centerLabel = document.createElement('div'); centerLabel.className = 'core-label'; centerLabel.textContent = 'JARVIS'; centerLabel.setAttribute('aria-hidden', 'true'); host.append(centerLabel);
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let renderedWidth = 0, renderedHeight = 0;
  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return planets.find((planet) => raycaster.intersectObject(planet.model.surface, false).length) || null;
  }
  function projected(position) { const vector = position.clone().project(camera); return { x: (vector.x * .5 + .5) * host.clientWidth, y: (-vector.y * .5 + .5) * host.clientHeight }; }
  function positionLabels() {
    if (contextLost) return;
    const width = host.clientWidth, height = host.clientHeight, accepted = [];
    const discs = [{ x: width / 2, y: height / 2, r: 1.21 * camera.zoom }];
    for (const planet of planets) discs.push({ ...projected(planet.holder.position), r: planet.bound * camera.zoom });
    centerLabel.style.left = width / 2 + 'px'; centerLabel.style.top = Math.min(height - 20, height / 2 + discs[0].r + 12) + 'px';
    for (let i = 0; i < planets.length; i++) {
      const disc = discs[i + 1], button = planets[i].button;
      if (button.hidden) { button.hidden = false; button.style.display = 'flex'; button.style.visibility = 'hidden'; }
      const w = button.offsetWidth, h = button.offsetHeight;
      const candidates = [[disc.x, disc.y + disc.r + 3], [disc.x, disc.y - disc.r - h - 3], [disc.x + disc.r + w / 2 + 5, disc.y - h / 2], [disc.x - disc.r - w / 2 - 5, disc.y - h / 2]];
      let found = null;
      for (const [x, y] of candidates) {
        const rect = { left: x - w / 2, right: x + w / 2, top: y, bottom: y + h };
        if (rect.left < 4 || rect.right > width - 4 || rect.top < 4 || rect.bottom > height - 4) continue;
        if (accepted.some((r) => rect.left < r.right + 3 && rect.right > r.left - 3 && rect.top < r.bottom + 3 && rect.bottom > r.top - 3)) continue;
        if (discs.some((body) => { const x0 = Math.max(rect.left, Math.min(body.x, rect.right)), y0 = Math.max(rect.top, Math.min(body.y, rect.bottom)); return Math.hypot(x0 - body.x, y0 - body.y) < body.r + 2; })) continue;
        found = { x, y, rect }; break;
      }
      button.hidden = !found; button.style.display = found ? 'flex' : 'none'; button.style.visibility = found ? 'visible' : 'hidden'; button.tabIndex = found ? 0 : -1; button.style.pointerEvents = found ? 'auto' : 'none';
      if (found) { button.style.left = found.x + 'px'; button.style.top = found.y + 'px'; accepted.push(found.rect); }
    }
  }
  function fit() {
    const width = host.clientWidth, height = host.clientHeight; if (!width || !height) return;
    if (width !== renderedWidth || height !== renderedHeight) {
      renderer.setSize(width, height, false); renderedWidth = width; renderedHeight = height;
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    }
    camera.left = -width / 2; camera.right = width / 2; camera.top = height / 2; camera.bottom = -height / 2;
    let extentX = 1.21, extentY = 1.21;
    planets.forEach((planet) => { const p = planet.holder.position, r = planet.bound; extentX = Math.max(extentX, Math.abs(p.x) + r); extentY = Math.max(extentY, Math.abs(p.y) + r); });
    camera.zoom = Math.min(Math.max(1, width / 2 - 18) / extentX, Math.max(1, height / 2 - 28) / extentY);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  }
  function update(time) {
    const positions = {};
    const narrow = Math.min(1, Math.max(.62, host.clientWidth / 540));
    planets.forEach((planet) => { const position = orbitPosition(planet.type, time); planet.holder.position.set(position[0] * narrow, position[1], position[2]); planet.orbit.rotation.z = precession(planet.type, time); planet.pathGroup.scale.x = narrow; planet.model.group.rotation.y = time * ORBITS[planet.type].spin; positions[planet.item.key] = [planet.holder.position.x, planet.holder.position.y, planet.holder.position.z].map((value) => Math.round(value * 1000) / 1000); });
    core.group.rotation.y = time * .08;
    host.dataset.orbitTime = time.toFixed(3); host.dataset.orbitPositions = JSON.stringify(positions);
    fit(); positionLabels();
  }
  function draw(now = performance.now()) {
    frame = 0;
    if (disposed || contextLost || !visible || document.hidden || !host.getClientRects().length) return;
    if (lastFrame && now - lastFrame < 32) { frame = requestAnimationFrame(draw); return; }
    const delta = lastTick ? Math.min((now - lastTick) / 1000, .05) : 0; lastTick = now; lastFrame = now;
    if (moving()) elapsed += delta * speed;
    update(elapsed); renderer.render(scene, camera); host.dataset.frames = String(++drawCount);
    if (moving()) frame = requestAnimationFrame(draw);
  }
  function stop() { cancelAnimationFrame(frame); frame = 0; lastTick = 0; lastFrame = 0; }
  function sync() { stop(); if (visible && !document.hidden && !contextLost) draw(); onStatus(contextLost ? '3D приостановлено · статичный вид' : paused() ? 'ДВИЖЕНИЕ ПРИОСТАНОВЛЕНО' : 'ОРБИТАЛЬНАЯ СИСТЕМА'); reportMotion(); }
  const resize = new ResizeObserver(() => { if (disposed) return; sync(); }); resize.observe(host);
  const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }); intersection.observe(host);
  document.addEventListener('visibilitychange', sync, { signal });
  const reducedChange = () => { motionRequested = false; sync(); }; reduced.addEventListener('change', reducedChange);
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const next = Boolean(pick(event));
    if (next !== sphereHover) { sphereHover = next; sync(); }
    renderer.domElement.style.cursor = next ? 'pointer' : '';
  }, { signal });
  renderer.domElement.addEventListener('pointerleave', () => { if (sphereHover) { sphereHover = false; sync(); } renderer.domElement.style.cursor = ''; }, { signal });
  renderer.domElement.addEventListener('click', (event) => {
    if (contextLost) return; const planet = pick(event); if (planet) onSelect(planet.item.key);
  }, { signal });
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault(); contextLost = true; stop(); host.dataset.render = 'fallback';
    planets.forEach(({ button }) => { button.hidden = true; button.style.display = 'none'; button.style.pointerEvents = 'none'; button.tabIndex = -1; });
    centerLabel.hidden = true; onStatus('3D приостановлено · статичный вид'); reportMotion();
  }, { signal });
  renderer.domElement.addEventListener('webglcontextrestored', () => { contextLost = false; host.dataset.render = 'webgl'; centerLabel.hidden = false; sync(); }, { signal });
  update(0); sync();
  return { available: true, get paused() { return paused(); }, setPaused(value) { requestPause(value); sync(); }, setWorkspace(value) { setWorkspace(value); sync(); }, dispose() {
    if (disposed) return; disposed = true; stop(); controller.abort(); resize.disconnect(); intersection.disconnect(); reduced.removeEventListener('change', reducedChange);
    const geometries = new Set(), materials = new Set(), textures = new Set(); scene.traverse((object) => { if (object.geometry) geometries.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) { materials.add(material); if (material.map) textures.add(material.map); } });
    geometries.forEach((item) => item.dispose()); materials.forEach((item) => item.dispose()); textures.forEach((item) => item.dispose()); renderer.dispose(); renderer.domElement.remove(); centerLabel.remove(); planets.forEach((planet) => planet.button.remove());
  } };
}
