(() => {
  const container = document.getElementById('canvas-container');
  const widgetContainer = document.getElementById('widget-container');
  const statusText = document.getElementById('status-text');
  const hudStatus = document.getElementById('hud-status');
  const btnChat = document.getElementById('btn-chat');
  const btnPin = document.getElementById('btn-pin');
  const btnClose = document.getElementById('btn-close');

  if (!container) return;

  // Initialize Quantum 3D Core
  const core = window.createQuantumCore ? window.createQuantumCore({
    container,
    fov: 45
  }) : null;

  let isPinned = true;
  let currentMode = 'idle';
  let speechInterval = null;

  // Mode status mapping
  const MODE_CONFIG = {
    idle: { label: 'JARVIS // ONLINE', dot: '#00e5ff' },
    speech: { label: 'JARVIS // SPEAKING', dot: '#00e5ff' },
    vortex: { label: 'JARVIS // PROCESSING', dot: '#00e5ff' },
    scanner: { label: 'JARVIS // SCANNING', dot: '#00ff88' },
    alert: { label: 'JARVIS // ATTENTION', dot: '#ff1744' }
  };

  function updateStatusBadge(mode) {
    currentMode = mode || 'idle';
    const cfg = MODE_CONFIG[currentMode] || MODE_CONFIG.idle;
    if (statusText) statusText.textContent = cfg.label;
    const dot = hudStatus ? hudStatus.querySelector('.status-dot') : null;
    if (dot) {
      dot.style.backgroundColor = cfg.dot;
      dot.style.boxShadow = `0 0 6px ${cfg.dot}`;
    }
  }

  // --- Smooth Window Dragging ---
  let isDragging = false;
  let lastScreenX = 0;
  let lastScreenY = 0;

  if (widgetContainer) {
    widgetContainer.addEventListener('mousedown', (e) => {
      // Don't drag if clicked on button controls
      if (e.target.closest('.no-drag')) return;
      isDragging = true;
      lastScreenX = e.screenX;
      lastScreenY = e.screenY;
    });

    window.addEventListener('mousemove', (e) => {
      // 1. Mouse Look-at for 3D Core
      if (core && widgetContainer) {
        const rect = widgetContainer.getBoundingClientRect();
        const normX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const normY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        core.setMouseLookAt(normX, normY);
      }

      // 2. Drag window
      if (isDragging) {
        const dx = e.screenX - lastScreenX;
        const dy = e.screenY - lastScreenY;
        if (dx !== 0 || dy !== 0) {
          lastScreenX = e.screenX;
          lastScreenY = e.screenY;
          if (window.jarvis && typeof window.jarvis.moveHologramWindow === 'function') {
            window.jarvis.moveHologramWindow(dx, dy);
          }
        }
      }
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Double-click opens main Jarvis window
    widgetContainer.addEventListener('dblclick', (e) => {
      if (e.target.closest('.no-drag')) return;
      if (window.jarvis && typeof window.jarvis.showMainWindow === 'function') {
        window.jarvis.showMainWindow();
      }
    });
  }

  // --- HUD Button Controls ---
  if (btnChat) {
    btnChat.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.jarvis && typeof window.jarvis.showMainWindow === 'function') {
        window.jarvis.showMainWindow();
      }
    });
  }

  if (btnPin) {
    btnPin.addEventListener('click', (e) => {
      e.stopPropagation();
      isPinned = !isPinned;
      btnPin.classList.toggle('active', isPinned);
      btnPin.title = isPinned ? "Закрепить поверх окон (активно)" : "Не закреплять поверх окон";
      if (window.jarvis && typeof window.jarvis.setHologramPin === 'function') {
        window.jarvis.setHologramPin(isPinned);
      }
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.jarvis && typeof window.jarvis.toggleHologramWidget === 'function') {
        window.jarvis.toggleHologramWidget(false);
      }
    });
  }

  // --- Voice / Speech Cadence Simulation ---
  function startSpeechAnimation() {
    if (speechInterval) return;
    const freqData = new Uint8Array(64);
    let speechPhase = 0;
    speechInterval = setInterval(() => {
      if (!core || currentMode !== 'speech') {
        stopSpeechAnimation();
        return;
      }
      speechPhase += 0.2;
      const cadence = Math.sin(speechPhase * 1.5) * 0.5 + 0.5;
      const burst = Math.sin(speechPhase * 0.7) > 0.2 ? 1 : 0.2;
      const amp = (0.2 + 0.7 * cadence) * burst;

      for (let i = 0; i < 64; i++) {
        const harmonic = Math.sin(i * 0.3 + speechPhase * 2.0) * 0.5 + 0.5;
        freqData[i] = Math.floor(amp * harmonic * 255);
      }
      core.setAudioLevel(amp, freqData);
    }, 40);
  }

  function stopSpeechAnimation() {
    if (speechInterval) {
      clearInterval(speechInterval);
      speechInterval = null;
    }
    if (core) {
      core.setAudioLevel(0);
    }
  }

  // --- Core Mode IPC Listener ---
  if (window.jarvis && typeof window.jarvis.onCoreMode === 'function') {
    window.jarvis.onCoreMode((payload) => {
      if (!payload || !payload.mode) return;
      const mode = payload.mode;
      updateStatusBadge(mode);

      if (core) {
        core.setMode(mode);
      }

      if (mode === 'speech') {
        startSpeechAnimation();
      } else {
        stopSpeechAnimation();
      }
    });
  }

  // --- Resource Throttling on Hide ---
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (!core) return;
      if (document.hidden) {
        core.pause();
        stopSpeechAnimation();
      } else {
        core.resume();
        if (currentMode === 'speech') {
          startSpeechAnimation();
        }
      }
    });
  }

  // Initial state
  updateStatusBadge('idle');
})();
