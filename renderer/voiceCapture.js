// Voice Capture Module for Jarvis.
// The renderer no longer owns the microphone. A hidden BrowserWindow captures
// microphone audio in the background and sends PCM to the main process.

let isCapturing = false;
let workerStarted = false;

function updatePartial(text) {
  const el = document.getElementById('voice-partial');
  if (el) el.textContent = text || '';
}

function updateVoiceToggleState(enabled, busy = false) {
  if (typeof window.jarvisSetVoiceToggleState === 'function') {
    window.jarvisSetVoiceToggleState({ enabled, busy });
    return;
  }

  document.dispatchEvent(new CustomEvent('jarvis:voice-state', {
    detail: { enabled, busy },
  }));
}

function updateStatus(type, message) {
  const el = document.getElementById('voice-status');
  if (el) el.textContent = `[${type}] ${message || ''}`;

  const footerEl = document.getElementById('voice-status-line');
  if (footerEl) footerEl.textContent = message || '';

  if (type === 'starting') {
    updateVoiceToggleState(false, true);
  } else if (['ready', 'ignored', 'intent', 'result', 'recognized'].includes(type)) {
    updateVoiceToggleState(true, false);
  } else if (['stopped', 'worker-exit', 'error'].includes(type)) {
    updateVoiceToggleState(false, false);
  }

  if (type === 'error' && footerEl) {
    footerEl.textContent = '❌ ' + message;
  }
  if (type === 'ready' && footerEl) {
    footerEl.textContent = '🎤 ' + message;
  }
}

async function startVoiceCapture() {
  if (isCapturing) {
    console.warn('[voice] Already capturing');
    return;
  }

  if (!window.jarvisVoice || !window.jarvisVoice.start) {
    const message = 'jarvisVoice API не доступен.';
    console.error('[voice]', message);
    updateStatus('error', message);
    return;
  }

  try {
    updateStatus('starting', 'Запуск голосового модуля...');
    const startResult = await window.jarvisVoice.start();
    console.log('[voice] jarvisVoice.start() result:', JSON.stringify(startResult));

    if (!startResult || !startResult.ok) {
      updateStatus('error', 'Worker не запустился: ' + (startResult ? startResult.error : 'unknown'));
      return;
    }

    workerStarted = true;
    isCapturing = true;
    updateStatus('ready', 'Готово. Скажите: джарвис включи доту');
    console.log('[voice] Voice capture started in hidden background window');
  } catch (err) {
    console.error('[voice] start error:', err);
    updateStatus('error', 'Ошибка запуска: ' + err.message);
  }
}

function stopVoiceCapture() {
  isCapturing = false;
  workerStarted = false;

  if (window.jarvisVoice && window.jarvisVoice.stop) {
    window.jarvisVoice.stop();
  }

  updateStatus('stopped', 'Голос выключен');
}

function setupVoiceListeners() {
  if (!window.jarvisVoice) return;

  window.jarvisVoice.onPartial((payload) => {
    updatePartial(payload && payload.text);
  });

  window.jarvisVoice.onStatus((payload) => {
    updateStatus(payload.type, payload.message);

    if (payload.type === 'result' && payload.result && typeof window.jarvisDisplayResult === 'function') {
      window.jarvisDisplayResult(payload.result);
    }

    if (payload.type === 'worker-exit' || payload.type === 'error') {
      workerStarted = false;
      isCapturing = false;
    }
  });
}

function setupAutoStart() {
  if (window.jarvisVoice && window.jarvisVoice.onAutoStart) {
    window.jarvisVoice.onAutoStart(() => {
      console.log('[voice] Auto-start signal received from main process');
      if (!isCapturing) {
        startVoiceCapture();
      }
    });
  }
}

window.startVoiceCapture = startVoiceCapture;
window.stopVoiceCapture = stopVoiceCapture;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupVoiceListeners();
    setupAutoStart();
    setTimeout(startVoiceCapture, 100);
  });
} else {
  setupVoiceListeners();
  setupAutoStart();
  setTimeout(startVoiceCapture, 100);
}
