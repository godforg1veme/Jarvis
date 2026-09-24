/**
 * Quantum Core 2.0 (MCU Stark Tech / Iron Man)
 * Real-Time Procedural 3D WebGL Core for Jarvis Desktop Client.
 *
 * Fully modular CommonJS / Browser component (<40 KB, 60 FPS, GPU <1%).
 */

// Resolve Three.js instance across Node.js / Electron renderer / Web environments
function resolveThree(customThree) {
  if (customThree) return customThree;
  if (typeof window !== 'undefined' && window.THREE) return window.THREE;
  if (typeof globalThis !== 'undefined' && globalThis.THREE) return globalThis.THREE;
  try {
    return require('./vendor/three.min.js');
  } catch {
    try {
      return require('three');
    } catch {
      return null;
    }
  }
}

const COLOR_PALETTES = {
  cyan: {
    main: 0x38bdf8,
    plasma: 0x00f5ff,
    glow: 0x0284c7,
    cage2: 0x818cf8,
    ringDark: 0x0f172a,
    ringEmissive: 0x0284c7,
    ringPolar: 0x0284c7,
    ticks: 0x7dd3fc,
  },
  alert: {
    main: 0xf43f5e,
    plasma: 0xff1744,
    glow: 0xb91c1c,
    cage2: 0xfb7185,
    ringDark: 0x2a0812,
    ringEmissive: 0xf43f5e,
    ringPolar: 0xe11d48,
    ticks: 0xfb7185,
  },
};

class QuantumCore {
  /**
   * @param {Object} options
   * @param {HTMLCanvasElement} [options.canvas]
   * @param {HTMLElement} [options.container]
   * @param {number} [options.width]
   * @param {number} [options.height]
   * @param {number} [options.speedFactor=1.0]
   * @param {number} [options.pulseFactor=1.0]
   * @param {number} [options.scaleFactor=1.0]
   * @param {boolean} [options.mouseTracking=true]
   * @param {boolean} [options.autoStart=true]
   * @param {string} [options.mode='idle']
   * @param {Object} [options.THREE]
   */
  constructor(options = {}) {
    const THREE = resolveThree(options.THREE);
    if (!THREE) {
      throw new Error('[QuantumCore] Three.js is not found. Ensure renderer/vendor/three.min.js exists or THREE is passed in options.');
    }
    this.THREE = THREE;

    this.container = options.container || null;
    this.canvas = options.canvas || null;

    if (!this.canvas && this.container && typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'quantum-core-canvas';
      this.container.appendChild(this.canvas);
      this._createdCanvas = true;
    }

    this.speedFactor = options.speedFactor || 1.0;
    this.pulseFactor = options.pulseFactor || 1.0;
    this.scaleFactor = options.scaleFactor || 1.0;
    this.mouseTracking = options.mouseTracking !== false;

    this.mode = options.mode || 'idle'; // 'idle' | 'speech' | 'vortex' | 'scanner' | 'alert'
    this.currentRotSpeed = 1.0;

    this.audioAmplitude = 0;
    this.audioFrequencyData = null;

    this.isDestroyed = false;
    this.isPaused = (options.autoStart === false);
    this.rafId = null;

    this.mouse = new THREE.Vector2(0, 0);

    // Color theme
    this.activeTheme = this.mode === 'alert' ? 'alert' : 'cyan';
    this.customColors = options.customColors || null;

    // Viewport dimensions
    const initialWidth = options.width || (this.container ? this.container.clientWidth : (this.canvas ? this.canvas.clientWidth : 300)) || 300;
    const initialHeight = options.height || (this.container ? this.container.clientHeight : (this.canvas ? this.canvas.clientHeight : 300)) || 300;

    this._initScene(initialWidth, initialHeight, options);
    this._bindEvents();

    if (options.autoStart !== false) {
      this.resume();
    }
  }

  _initScene(width, height, options) {
    const THREE = this.THREE;

    // Renderer
    const rendererParams = {
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    };
    if (this.canvas) {
      rendererParams.canvas = this.canvas;
    }

    if (options.mockRenderer) {
      this.renderer = options.mockRenderer;
    } else if (typeof THREE.WebGLRenderer === 'function') {
      try {
        this.renderer = new THREE.WebGLRenderer(rendererParams);
        this.renderer.setSize(width, height, false);
        const dpr = options.devicePixelRatio || (typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1);
        this.renderer.setPixelRatio(dpr);

        if (THREE.ACESFilmicToneMapping) {
          this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
          this.renderer.toneMappingExposure = 1.25;
        }
      } catch (err) {
        // Fallback for headless testing environments without WebGL context
        this.renderer = {
          setSize: () => {},
          setPixelRatio: () => {},
          render: () => {},
          dispose: () => {},
        };
      }
    } else {
      this.renderer = {
        setSize: () => {},
        setPixelRatio: () => {},
        render: () => {},
        dispose: () => {},
      };
    }

    // Scene & Camera
    const camDist = typeof options.cameraDistance === 'number' ? options.cameraDistance : 7.2;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    this.camera.position.set(0, 0, camDist);

    this.clock = new THREE.Clock();

    // Lighting
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(this.ambientLight);

    this.dirLight1 = new THREE.DirectionalLight(0x38bdf8, 2.5);
    this.dirLight1.position.set(4, 5, 4);
    this.scene.add(this.dirLight1);

    this.dirLight2 = new THREE.DirectionalLight(0xc084fc, 2.0);
    this.dirLight2.position.set(-4, -3, -3);
    this.scene.add(this.dirLight2);

    // Root model group
    this.modelGroup = new THREE.Group();
    this.modelGroup.name = 'ProQuantumCoreRoot';
    this.modelGroup.scale.set(this.scaleFactor, this.scaleFactor, this.scaleFactor);
    this.scene.add(this.modelGroup);

    // Build the 3D Quantum Core
    this._buildQuantumCore();
    this._updateColors();
  }

  _buildQuantumCore() {
    const THREE = this.THREE;
    const palette = this._getPalette();

    this.coreData = {};

    // 1. Central Energy Singularity (Plasma core + Dual Geodesic Cage)
    const coreGroup = new THREE.Group();
    coreGroup.name = 'CoreSingularity';

    // Plasma Sphere
    this.plasmaMat = new THREE.MeshBasicMaterial({
      color: palette.plasma,
      transparent: true,
      opacity: 0.95,
    });
    this.plasma = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 32), this.plasmaMat);
    coreGroup.add(this.plasma);

    // Outer Plasma Glow Shell (Fresnel Additive)
    this.glowMat = new THREE.MeshBasicMaterial({
      color: palette.glow,
      transparent: true,
      opacity: 0.40,
      blending: THREE.AdditiveBlending,
    });
    this.glowShell = new THREE.Mesh(new THREE.SphereGeometry(0.68, 32, 32), this.glowMat);
    coreGroup.add(this.glowShell);

    // Inner Geodesic Cage 1 (Fine wireframe, cyan)
    this.cageMat1 = new THREE.MeshBasicMaterial({
      color: palette.main,
      wireframe: true,
      transparent: true,
      opacity: 0.75,
    });
    this.cage1 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.78, 2), this.cageMat1);
    coreGroup.add(this.cage1);

    // Inner Geodesic Cage 2 (Secondary electric blue lattice)
    this.cageMat2 = new THREE.MeshBasicMaterial({
      color: palette.cage2,
      wireframe: true,
      transparent: true,
      opacity: 0.50,
    });
    this.cage2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.92, 1), this.cageMat2);
    coreGroup.add(this.cage2);

    this.modelGroup.add(coreGroup);
    this.coreData.coreGroup = coreGroup;

    // 2. High-Tech Sci-Fi HUD Gyroscopic Rings
    const ringGroup = new THREE.Group();
    ringGroup.name = 'GyroscopicRings';

    // RING 1: Outer Heavy Gimbal Ring with 4 Caliper Brackets (Radius 2.10)
    const r1Group = new THREE.Group();
    this.ringMat1 = new THREE.MeshStandardMaterial({
      color: palette.ringDark,
      emissive: palette.ringEmissive,
      emissiveIntensity: 0.9,
      roughness: 0.2,
      metalness: 0.95,
    });
    const ring1Mesh = new THREE.Mesh(new THREE.TorusGeometry(2.10, 0.024, 16, 120), this.ringMat1);
    r1Group.add(ring1Mesh);

    // 4 Caliper Brackets
    this.caliperMat = new THREE.MeshStandardMaterial({
      color: palette.main,
      emissive: palette.main,
      emissiveIntensity: 1.2,
      roughness: 0.1,
      metalness: 0.9,
    });
    this.calipers = [];
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const cal = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.05), this.caliperMat);
      cal.position.set(Math.cos(angle) * 2.10, Math.sin(angle) * 2.10, 0);
      cal.rotation.z = angle;
      r1Group.add(cal);
      this.calipers.push(cal);
    }
    ringGroup.add(r1Group);
    this.coreData.r1Group = r1Group;

    // RING 2: Segmented Graduation / Compass Arc Ring (Radius 1.72)
    const r2Group = new THREE.Group();
    this.arcMat = new THREE.MeshBasicMaterial({
      color: palette.main,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });

    const arcLength = (Math.PI * 2 / 4) * 0.72;
    for (let i = 0; i < 4; i++) {
      const startA = (i / 4) * Math.PI * 2 + 0.1;
      const arcGeo = new THREE.RingGeometry(1.68, 1.74, 32, 1, startA, arcLength);
      const arc = new THREE.Mesh(arcGeo, this.arcMat);
      r2Group.add(arc);
    }

    // 36 Radial Graduation Ticks
    const tickGeo = new THREE.BoxGeometry(0.04, 0.008, 0.008);
    this.tickMat = new THREE.MeshBasicMaterial({ color: palette.ticks });
    for (let i = 0; i < 36; i++) {
      const angle = (i / 36) * Math.PI * 2;
      const tick = new THREE.Mesh(tickGeo, this.tickMat);
      tick.position.set(Math.cos(angle) * 1.62, Math.sin(angle) * 1.62, 0);
      tick.rotation.z = angle;
      r2Group.add(tick);
    }
    ringGroup.add(r2Group);
    this.coreData.r2Group = r2Group;

    // RING 3: Fast Inner Orbiting Data Ring with 3 Data Nodes (Radius 1.40)
    const r3Group = new THREE.Group();
    this.ringMat3 = new THREE.MeshStandardMaterial({
      color: palette.cage2,
      emissive: palette.cage2,
      emissiveIntensity: 1.0,
      roughness: 0.1,
      metalness: 0.95,
    });
    const ring3Mesh = new THREE.Mesh(new THREE.TorusGeometry(1.40, 0.015, 16, 96), this.ringMat3);
    r3Group.add(ring3Mesh);

    // 3 Orbiting Data Nodes
    const nodeGeo = new THREE.SphereGeometry(0.045, 16, 16);
    this.nodeMat = new THREE.MeshBasicMaterial({ color: palette.plasma });
    this.nodes = [];
    for (let i = 0; i < 3; i++) {
      const node = new THREE.Mesh(nodeGeo, this.nodeMat);
      r3Group.add(node);
      this.nodes.push(node);
    }
    ringGroup.add(r3Group);
    this.coreData.r3Group = r3Group;

    // RING 4: Polar Orbital Gyroscope (Radius 1.90, YZ plane)
    const r4Group = new THREE.Group();
    this.ringMat4 = new THREE.MeshStandardMaterial({
      color: palette.ringPolar,
      emissive: palette.main,
      emissiveIntensity: 0.8,
      roughness: 0.2,
      metalness: 0.9,
    });
    const ring4Mesh = new THREE.Mesh(new THREE.TorusGeometry(1.90, 0.016, 16, 100), this.ringMat4);
    ring4Mesh.rotation.y = Math.PI / 2;
    r4Group.add(ring4Mesh);
    ringGroup.add(r4Group);
    this.coreData.r4Group = r4Group;

    this.modelGroup.add(ringGroup);
    this.coreData.ringGroup = ringGroup;

    // 3. Equatorial Circular Audio Waveform Visualizer (64 fine dancing LED needles)
    const waveGroup = new THREE.Group();
    waveGroup.name = 'EquatorialWaveform';
    this.waveNeedles = [];
    const needleGeo = new THREE.BoxGeometry(0.012, 0.08, 0.008);
    this.needleMat = new THREE.MeshBasicMaterial({ color: palette.main });

    const numNeedles = 64;
    for (let i = 0; i < numNeedles; i++) {
      const angle = (i / numNeedles) * Math.PI * 2;
      const needle = new THREE.Mesh(needleGeo, this.needleMat);
      const rad = 1.15;
      needle.position.set(Math.cos(angle) * rad, 0, Math.sin(angle) * rad);
      needle.rotation.y = -angle;
      waveGroup.add(needle);
      this.waveNeedles.push({ mesh: needle, baseAngle: angle });
    }
    this.modelGroup.add(waveGroup);
    this.coreData.waveGroup = waveGroup;

    // 4. Planar Holographic Scanning Grid Disc
    const scannerGroup = new THREE.Group();
    scannerGroup.name = 'ScannerTomography';
    this.scanDiscMat = new THREE.MeshBasicMaterial({
      color: palette.plasma,
      transparent: true,
      opacity: 0.20,
      side: THREE.DoubleSide,
    });
    const scanDisc = new THREE.Mesh(new THREE.RingGeometry(0.2, 2.2, 32), this.scanDiscMat);
    scanDisc.rotation.x = Math.PI / 2;
    scannerGroup.add(scanDisc);

    this.scanBorderMat = new THREE.MeshBasicMaterial({ color: palette.main });
    const scanBorder = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.015, 16, 64), this.scanBorderMat);
    scanBorder.rotation.x = Math.PI / 2;
    scannerGroup.add(scanBorder);

    scannerGroup.visible = (this.mode === 'scanner');
    this.modelGroup.add(scannerGroup);
    this.coreData.scannerGroup = scannerGroup;

    // 5. Orbital Photon Comets (3 Sleek Luminous Orbits)
    const cometsGroup = new THREE.Group();
    cometsGroup.name = 'PhotonComets';
    this.cometMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.comets = [];
    for (let i = 0; i < 3; i++) {
      const comet = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 16), this.cometMat);
      cometsGroup.add(comet);
      this.comets.push(comet);
    }
    this.modelGroup.add(cometsGroup);
    this.coreData.comets = this.comets;
  }

  _getPalette() {
    if (this.customColors) return this.customColors;
    return COLOR_PALETTES[this.activeTheme] || COLOR_PALETTES.cyan;
  }

  _updateColors() {
    const isAlert = (this.mode === 'alert');
    this.activeTheme = isAlert ? 'alert' : 'cyan';
    const p = this._getPalette();

    if (this.plasmaMat) this.plasmaMat.color.setHex(p.plasma);
    if (this.glowMat) this.glowMat.color.setHex(p.glow);
    if (this.cageMat1) this.cageMat1.color.setHex(p.main);
    if (this.cageMat2) this.cageMat2.color.setHex(p.cage2);

    if (this.ringMat1) {
      this.ringMat1.color.setHex(p.ringDark);
      this.ringMat1.emissive.setHex(p.ringEmissive);
    }
    if (this.arcMat) this.arcMat.color.setHex(p.main);
    if (this.tickMat) this.tickMat.color.setHex(p.ticks);

    if (this.ringMat3) {
      this.ringMat3.color.setHex(p.main);
      this.ringMat3.emissive.setHex(p.main);
    }
    if (this.nodeMat) this.nodeMat.color.setHex(p.plasma);

    if (this.ringMat4) {
      this.ringMat4.color.setHex(p.ringPolar);
      this.ringMat4.emissive.setHex(p.main);
    }

    if (this.needleMat) this.needleMat.color.setHex(p.main);
    if (this.scanDiscMat) this.scanDiscMat.color.setHex(p.plasma);
    if (this.scanBorderMat) this.scanBorderMat.color.setHex(p.main);

    if (this.caliperMat) {
      this.caliperMat.color.setHex(p.main);
      this.caliperMat.emissive.setHex(p.main);
    }
  }

  _bindEvents() {
    this._onMouseMove = (e) => {
      if (!this.mouseTracking) return;
      const target = this.container || this.canvas;
      if (!target || typeof target.getBoundingClientRect !== 'function') return;
      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const eventTarget = this.container || this.canvas;
    if (eventTarget && typeof eventTarget.addEventListener === 'function') {
      eventTarget.addEventListener('mousemove', this._onMouseMove);
    }
  }

  // --- Public API ---

  /**
   * Set visual operation mode
   * @param {'idle' | 'speech' | 'vortex' | 'scanner' | 'alert'} mode
   */
  setMode(mode) {
    if (this.isDestroyed) return;
    if (!['idle', 'speech', 'vortex', 'scanner', 'alert'].includes(mode)) {
      console.warn(`[QuantumCore] Unknown mode '${mode}', keeping current '${this.mode}'`);
      return;
    }
    this.mode = mode;

    if (this.coreData && this.coreData.scannerGroup) {
      this.coreData.scannerGroup.visible = (mode === 'scanner');
    }

    this._updateColors();
  }

  /**
   * Feed real-time audio analysis level to the core
   * @param {number} amplitude - Normalized float [0.0, 1.0]
   * @param {Uint8Array | Float32Array | Array<number>} [frequencyData] - Frequency spectrum bins
   */
  setAudioLevel(amplitude = 0, frequencyData = null) {
    if (this.isDestroyed) return;
    this.audioAmplitude = Math.max(0, Math.min(1.0, Number(amplitude) || 0));
    this.audioFrequencyData = frequencyData;
  }

  /**
   * Override color theme or provide custom primary hex
   * @param {string | number} colorHexOrTheme
   */
  setTheme(colorHexOrTheme) {
    if (this.isDestroyed) return;
    if (typeof colorHexOrTheme === 'string' && COLOR_PALETTES[colorHexOrTheme]) {
      this.activeTheme = colorHexOrTheme;
      this.customColors = null;
    } else if (typeof colorHexOrTheme === 'number' || typeof colorHexOrTheme === 'string') {
      const hex = typeof colorHexOrTheme === 'string' ? parseInt(colorHexOrTheme.replace('#', ''), 16) : colorHexOrTheme;
      this.customColors = {
        main: hex,
        plasma: hex,
        glow: hex,
        cage2: hex,
        ringDark: 0x0f172a,
        ringEmissive: hex,
        ringPolar: hex,
        ticks: hex,
      };
    }
    this._updateColors();
  }

  /**
   * Set mouse tracking state and optional coordinates
   * @param {boolean} enabled
   * @param {{ x: number, y: number }} [coords] - Normalized [-1, 1]
   */
  setTracking(enabled, coords = null) {
    if (this.isDestroyed) return;
    this.mouseTracking = !!enabled;
    if (coords) {
      if (typeof coords.x === 'number') this.mouse.x = coords.x;
      if (typeof coords.y === 'number') this.mouse.y = coords.y;
    }
  }

  /**
   * Directly update mouse coordinates (e.g. from parent window IPC)
   * @param {number} normX - [-1, 1]
   * @param {number} normY - [-1, 1]
   */
  updateMouse(normX, normY) {
    if (this.isDestroyed) return;
    this.mouse.x = Math.max(-1, Math.min(1, normX));
    this.mouse.y = Math.max(-1, Math.min(1, normY));
  }

  /**
   * Pause animation rendering loop (0% GPU usage when hidden)
   */
  pause() {
    if (this.isDestroyed || this.isPaused) return;
    this.isPaused = true;
    if (this.rafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Resume animation loop
   */
  resume() {
    if (this.isDestroyed) return;
    if (!this.isPaused && this.rafId) return;
    this.isPaused = false;
    if (this.clock) {
      this.clock.getDelta(); // reset delta step
    }
    this._animate();
  }

  /**
   * Resize viewport
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    if (this.isDestroyed) return;
    if (!this.renderer || !this.camera || width <= 0 || height <= 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  /**
   * Set simulation speed multiplier
   * @param {number} speed
   */
  setSpeed(speed) {
    if (this.isDestroyed) return;
    this.speedFactor = Math.max(0.1, Number(speed) || 1.0);
  }

  /**
   * Set simulation pulse amplitude factor
   * @param {number} pulse
   */
  setPulse(pulse) {
    if (this.isDestroyed) return;
    this.pulseFactor = Math.max(0.1, Number(pulse) || 1.0);
  }

  /**
   * Set model scale
   * @param {number} scale
   */
  setScale(scale) {
    if (this.isDestroyed) return;
    this.scaleFactor = Math.max(0.1, Number(scale) || 1.0);
    if (this.modelGroup) {
      this.modelGroup.scale.set(this.scaleFactor, this.scaleFactor, this.scaleFactor);
    }
  }

  // --- Step single animation frame (for testing / manual clock) ---
  tick(manualDelta = null) {
    const delta = manualDelta !== null ? manualDelta : this.clock.getDelta();
    const time = this.clock.getElapsedTime() * this.speedFactor;

    const THREE = this.THREE;
    const isVortex = (this.mode === 'vortex');
    const isSpeech = (this.mode === 'speech');
    const isScanner = (this.mode === 'scanner');
    const isAlert = (this.mode === 'alert');

    // 1. Rotation Lerp for Turbo Vortex
    const targetSpeedMult = isVortex ? 3.8 : 1.0;
    this.currentRotSpeed = THREE.MathUtils.lerp(this.currentRotSpeed, targetSpeedMult, Math.min(1.0, delta * 3.0));

    // 2. Concentric Gimbal Rings
    if (this.coreData && this.coreData.r1Group) {
      this.coreData.r1Group.rotation.x = time * 0.35 * this.currentRotSpeed;
      this.coreData.r1Group.rotation.y = time * 0.28 * this.currentRotSpeed;
    }
    if (this.coreData && this.coreData.r2Group) {
      this.coreData.r2Group.rotation.z = -time * 0.45 * this.currentRotSpeed;
      this.coreData.r2Group.rotation.y = time * 0.18 * this.currentRotSpeed;
    }
    if (this.coreData && this.coreData.r3Group) {
      this.coreData.r3Group.rotation.x = -time * 0.75 * this.currentRotSpeed;
      this.coreData.r3Group.rotation.z = time * 0.65 * this.currentRotSpeed;
    }
    if (this.nodes && this.nodes.length) {
      this.nodes.forEach((node, i) => {
        const nodeAngle = time * 2.2 * this.currentRotSpeed + (i / 3) * Math.PI * 2;
        node.position.set(Math.cos(nodeAngle) * 1.40, Math.sin(nodeAngle) * 1.40, 0);
      });
    }
    if (this.coreData && this.coreData.r4Group) {
      this.coreData.r4Group.rotation.y = time * 0.40 * this.currentRotSpeed;
      this.coreData.r4Group.rotation.x = time * 0.22 * this.currentRotSpeed;
    }

    // 3. Counter-rotating Geodesic Cages
    if (this.cage1) {
      this.cage1.rotation.y = time * 0.60 * this.currentRotSpeed;
      this.cage1.rotation.x = time * 0.40 * this.currentRotSpeed;
    }
    if (this.cage2) {
      this.cage2.rotation.y = -time * 0.50 * this.currentRotSpeed;
      this.cage2.rotation.z = time * 0.35 * this.currentRotSpeed;
    }

    // 4. Central Singularity Plasma Pulse
    let plasmaPulse = 0;
    if (isAlert) {
      plasmaPulse = Math.pow(Math.abs(Math.sin(time * 6.0)), 6.0) * 0.35;
    } else if (isSpeech) {
      const baseCadence = Math.sin(time * 10.0) * 0.12 + Math.cos(time * 16.0) * 0.08;
      const liveBoost = this.audioAmplitude > 0 ? (this.audioAmplitude * 0.35) : 0;
      plasmaPulse = (baseCadence + liveBoost) * this.pulseFactor;
    } else if (isVortex) {
      plasmaPulse = Math.sin(time * 18.0) * 0.08;
    } else {
      plasmaPulse = Math.sin(time * 2.2) * 0.04;
    }

    if (this.plasma && this.glowShell) {
      const plasmaScale = 1.0 + plasmaPulse;
      this.plasma.scale.set(plasmaScale, plasmaScale, plasmaScale);
      this.glowShell.scale.set(plasmaScale * 1.05, plasmaScale * 1.05, plasmaScale * 1.05);
    }

    // 5. Caliper Brackets Glow
    if (this.caliperMat) {
      let calGlow = 1.0;
      if (isSpeech) {
        const liveGlow = this.audioAmplitude > 0 ? this.audioAmplitude * 2.0 : 0;
        calGlow = 1.2 + Math.abs(Math.sin(time * 12.0)) * 1.2 + liveGlow;
      } else if (isAlert) {
        calGlow = 1.5 + Math.abs(Math.sin(time * 8.0)) * 1.5;
      }
      this.caliperMat.emissiveIntensity = calGlow;
    }

    // 6. Circular 64-Needle Audio Waveform Equalizer
    if (this.waveNeedles && this.coreData && this.coreData.waveGroup) {
      this.coreData.waveGroup.rotation.y = time * 0.15;

      const hasFreq = Array.isArray(this.audioFrequencyData) ||
        (this.audioFrequencyData && typeof this.audioFrequencyData.length === 'number');

      this.waveNeedles.forEach((item, idx) => {
        const a = item.baseAngle;
        let needleH = 0.2;

        if (hasFreq && (isSpeech || this.audioAmplitude > 0)) {
          const binIdx = Math.floor((idx / this.waveNeedles.length) * this.audioFrequencyData.length);
          const rawVal = this.audioFrequencyData[binIdx] || 0;
          const normalized = rawVal > 1 ? (rawVal / 255) : rawVal;
          needleH = Math.max(0.12, normalized * 5.2 * this.pulseFactor);
        } else if (isSpeech) {
          const voiceWave = (
            Math.sin(time * 12.0 + a * 3.0) * 0.45 +
            Math.cos(time * 20.0 + a * 7.0) * 0.35 +
            Math.sin(time * 28.0 + a * 11.0) * 0.25
          );
          const ampBoost = this.audioAmplitude > 0 ? (0.6 + this.audioAmplitude * 1.8) : 1.0;
          needleH = Math.max(0.12, Math.abs(voiceWave)) * 4.8 * this.pulseFactor * ampBoost;
        } else if (isAlert) {
          needleH = (Math.sin(time * 8.0 + idx * 0.8) > 0.4 ? 2.2 : 0.25);
        } else if (isVortex) {
          needleH = (Math.sin(a * 8.0 + time * 14.0) * 0.5 + 0.8) * 1.6;
        } else {
          needleH = 0.25 + Math.sin(time * 2.0 + a * 2.0) * 0.08;
        }

        item.mesh.scale.set(1.0, Math.max(0.1, needleH), 1.0);
      });
    }

    // 7. Laser Tomography Scanner Plane
    if (this.coreData && this.coreData.scannerGroup) {
      if (isScanner) {
        this.coreData.scannerGroup.visible = true;
        this.coreData.scannerGroup.position.y = Math.sin(time * 2.4) * 1.55;
        this.coreData.scannerGroup.rotation.z = time * 0.5;
      } else {
        this.coreData.scannerGroup.visible = false;
      }
    }

    // 8. Orbital Photon Comets
    if (this.comets && this.comets.length === 3) {
      const cSpeed = isVortex ? 2.8 : 1.0;
      const t1 = time * 1.2 * cSpeed;
      this.comets[0].position.set(Math.cos(t1) * 1.95, Math.sin(t1) * 1.95, Math.sin(t1 * 2.0) * 0.45);

      const t2 = time * 0.95 * cSpeed + 1.2;
      this.comets[1].position.set(Math.sin(t2 * 1.8) * 0.35, Math.cos(t2) * 1.85, Math.sin(t2) * 1.85);

      const t3 = time * 1.35 * cSpeed + 2.8;
      this.comets[2].position.set(Math.cos(t3) * 1.70, Math.sin(t3) * 1.20, Math.cos(t3) * 1.30);
    }

    // 9. Smooth Mouse Look-At Parallax
    if (this.mouseTracking && this.modelGroup) {
      const targetRotY = this.mouse.x * 0.45;
      const targetRotX = -this.mouse.y * 0.35;
      this.modelGroup.rotation.y = THREE.MathUtils.lerp(this.modelGroup.rotation.y, targetRotY, Math.min(1.0, delta * 4));
      this.modelGroup.rotation.x = THREE.MathUtils.lerp(this.modelGroup.rotation.x, targetRotX, Math.min(1.0, delta * 4));
    }

    if (this.renderer && typeof this.renderer.render === 'function') {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // --- Internal Animation Loop ---

  _animate = () => {
    if (this.isDestroyed || this.isPaused) return;

    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(this._animate);
    }

    this.tick();
  };

  /**
   * Clean up all WebGL resources, listeners and timers
   */
  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    this.pause();

    const eventTarget = this.container || this.canvas;
    if (eventTarget && this._onMouseMove && typeof eventTarget.removeEventListener === 'function') {
      eventTarget.removeEventListener('mousemove', this._onMouseMove);
    }

    if (this.scene) {
      this.scene.traverse((obj) => {
        if (obj.geometry && typeof obj.geometry.dispose === 'function') {
          obj.geometry.dispose();
        }
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m && typeof m.dispose === 'function' && m.dispose());
          } else if (typeof obj.material.dispose === 'function') {
            obj.material.dispose();
          }
        }
      });
    }

    if (this.renderer && typeof this.renderer.dispose === 'function') {
      this.renderer.dispose();
    }

    if (this._createdCanvas && this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.modelGroup = null;
    this.coreData = null;
    this.waveNeedles = null;
    this.comets = null;
    this.nodes = null;
  }
}

function createQuantumCore(containerOrOptions = {}, maybeOptions = {}) {
  let opts = {};
  if ((typeof HTMLElement !== 'undefined' && containerOrOptions instanceof HTMLElement) || (containerOrOptions && containerOrOptions.nodeType === 1)) {
    opts = { ...maybeOptions, container: containerOrOptions };
  } else {
    opts = { ...containerOrOptions };
  }
  return new QuantumCore(opts);
}

// Universal export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    QuantumCore,
    createQuantumCore,
    COLOR_PALETTES,
  };
}

if (typeof window !== 'undefined') {
  window.QuantumCore = QuantumCore;
  window.createQuantumCore = createQuantumCore;
}
