(() => {
  'use strict';
  const THREE = window.THREE;
  const containers = [document.querySelector('.desktop-orbit'), document.querySelector('.desktop-home-scene')];
  if (!THREE || containers.some((item) => !item)) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const active = [];
  const makeOrbit = (radius, tilt) => {
    const points = [];
    for (let i = 0; i <= 128; i++) {
      const angle = (i / 128) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * .4, Math.sin(angle) * tilt));
    }
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xaebbc6, transparent: true, opacity: .24 }));
  };
  const makeBody = (radius, color) => {
    const body = new THREE.Group();
    const geometry = new THREE.SphereGeometry(radius, 32, 20);
    body.add(new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({ color, shininess: 40, specular: 0x6c7680 })));
    body.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 1.007, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xc6d1d9, wireframe: true, transparent: true, opacity: .10 })));
    return body;
  };
  const makeStars = () => {
    const coordinates = [];
    for (let i = 0; i < 160; i++) {
      const a = i * 2.399963, y = ((i * 37) % 160) / 80 - 1;
      const radius = 6 + (i % 5) * .45;
      coordinates.push(Math.cos(a) * radius, y * 3, Math.sin(a) * radius - 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xc8d2d9, size: .025, transparent: true, opacity: .45 }));
  };
  for (const [index, host] of containers.entries()) {
    try {
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setClearColor(0x000000, 0);
      renderer.domElement.setAttribute('aria-hidden', 'true');
      renderer.domElement.className = 'dashboard-scene-canvas';
      host.append(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(43, 1, .1, 100);
      camera.position.set(0, 1.2, index === 0 ? 9.5 : 8.7);
      camera.lookAt(0, 0, 0);
      scene.add(new THREE.AmbientLight(0xb6c4d2, .75));
      const light = new THREE.PointLight(0xf2f6fb, 35, 18);
      light.position.set(-3, 3, 5); scene.add(light);
      const core = makeBody(index === 0 ? 1.25 : 1.65, 0x46515a);
      scene.add(core);
      const orbital = new THREE.Group(); scene.add(orbital);
      for (const [i, orbitRadius] of (index === 0 ? [2.4, 2.8, 3.1] : [2.8, 3.4, 3.9]).entries()) {
        orbital.add(makeOrbit(orbitRadius, i % 2 ? .55 : -.5));
        const planet = makeBody(index === 0 ? .20 + i * .055 : .26 + i * .075, 0x535e68);
        const angle = i * 2.1 + .5;
        planet.position.set(Math.cos(angle) * orbitRadius, Math.sin(angle) * orbitRadius * .4, Math.sin(angle) * (i % 2 ? .55 : -.5));
        orbital.add(planet);
      }
      scene.add(makeStars());
      const resize = () => {
        const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
      };
      const observer = new ResizeObserver(resize); observer.observe(host); resize();
      active.push({ host, renderer, scene, camera, core, orbital, resize });
    } catch (_) {
      host.classList.add('dashboard-scene-fallback');
      const fallback = document.createElement('span'); fallback.setAttribute('aria-hidden', 'true'); host.append(fallback);
    }
  }
  let frame = 0;
  let last = 0;
  const tick = (time) => {
    if (document.hidden || reduced?.matches || document.body.dataset.scenePaused === 'true') return;
    frame = window.requestAnimationFrame(tick);
    if (time - last < 33) return;
    last = time;
    for (const item of active) {
      if (!item.host.getClientRects().length) continue;
      item.core.rotation.y += .0018;
      item.orbital.rotation.y += .0011;
      item.renderer.render(item.scene, item.camera);
    }
  };
  const syncMotion = () => {
    window.cancelAnimationFrame(frame);
    document.body.classList.toggle('dashboard-window-hidden', document.hidden);
    active.filter((item) => item.host.getClientRects().length).forEach((item) => item.resize());
    if (!document.hidden && !reduced?.matches && document.body.dataset.scenePaused !== 'true') frame = window.requestAnimationFrame(tick);
  };
  window.addEventListener('visibilitychange', syncMotion);
  reduced?.addEventListener('change', syncMotion);
  window.addEventListener('desktop:motion', (event) => {
    document.body.dataset.scenePaused = event.detail?.paused === true ? 'true' : 'false';
    syncMotion();
  });
  window.addEventListener('desktop:navigate', syncMotion);
  window.addEventListener('desktop:page', syncMotion);
  syncMotion();
  window.addEventListener('beforeunload', () => {
    window.cancelAnimationFrame(frame);
    for (const item of active) item.renderer.dispose();
  }, { once: true });
})();
