let hideTimeout = null;
let core = null;

function initQuantumCore() {
  const canvas = document.getElementById('quantum-core-canvas');
  const stage = document.getElementById('core-stage');
  if (!canvas || !window.createQuantumCore) return;

  try {
    core = window.createQuantumCore({
      canvas: canvas,
      container: stage,
      width: 190,
      height: 190,
      autoStart: false, // Start paused to consume 0% GPU until voice is triggered
      speedFactor: 1.0,
      pulseFactor: 1.0,
      scaleFactor: 0.95,
      mouseTracking: false,
    });
    window.__quantumCore = core;
  } catch (err) {
    console.error('[voiceOverlay] Failed to initialize QuantumCore:', err);
  }
}

function showOverlay(text = '', mode = 'speech') {
  const wrapper = document.getElementById('overlay-wrapper');
  const container = document.getElementById('overlay-container');
  const textBox = document.getElementById('voice-text');

  if (core) {
    core.resume();
    core.setMode(mode);
    if (mode === 'speech') {
      core.setAudioLevel(0.85);
    }
  }

  const hasText = text && String(text).trim().length > 0;
  if (hasText) {
    textBox.innerText = text;
    container.classList.remove('is-empty');
  } else {
    container.classList.add('is-empty');
  }

  wrapper.classList.remove('hidden');

  if (hideTimeout) {
    clearTimeout(hideTimeout);
  }

  hideTimeout = setTimeout(() => {
    wrapper.classList.add('hidden');
    if (core) {
      setTimeout(() => {
        if (wrapper.classList.contains('hidden')) {
          core.pause(); // 0% GPU when hidden!
        }
      }, 350);
    }
  }, 2500);
}

// Subscribe to voice status events from main process
if (window.jarvisVoice) {
  window.jarvisVoice.onPartial((msg) => {
    if (msg && msg.text) {
      showOverlay(msg.text, 'speech');
    }
  });

  window.jarvisVoice.onStatus((msg) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'listening' || msg.type === 'start') {
      showOverlay('', 'idle');
    } else if (msg.type === 'tts:start' || msg.type === 'speaking') {
      showOverlay(msg.message || '', 'speech');
    } else if (msg.type === 'transcribing' || msg.type === 'responding' || msg.type === 'processing') {
      showOverlay(msg.message || '', 'vortex');
    } else if (msg.type === 'scanning' || msg.type === 'file-search') {
      showOverlay(msg.message || '', 'scanner');
    } else if (msg.type === 'error' || msg.type === 'alert') {
      showOverlay(msg.message || 'Ошибка', 'alert');
    } else if (['ready', 'recognized', 'stopped', 'result', 'ignored', 'final'].includes(msg.type)) {
      if (hideTimeout) clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => {
        const wrapper = document.getElementById('overlay-wrapper');
        if (wrapper) wrapper.classList.add('hidden');
        if (core) core.pause();
      }, 1800);
    }
  });
}

if (window.jarvis && typeof window.jarvis.onCoreMode === 'function') {
  window.jarvis.onCoreMode((payload) => {
    if (payload && payload.mode) {
      const label = payload.mode === 'scanner' ? 'Сканирование файлов…' : (payload.mode === 'vortex' ? 'Вычисление…' : '');
      showOverlay(label, payload.mode);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initQuantumCore);
} else {
  initQuantumCore();
}
