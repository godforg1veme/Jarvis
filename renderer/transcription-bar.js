// Elements
const textEl = document.getElementById('transcription-text');
const ledEl = document.getElementById('status-led');
const closeBtn = document.getElementById('close-btn');

let resetTimeout = null;

// Update UI status helper
function setStatus(statusClass, message, isPlaceholder = false) {
  ledEl.className = `status-led ${statusClass}`;

  if (message !== null) {
    textEl.innerText = message;
    if (isPlaceholder) {
      textEl.classList.add('placeholder');
    } else {
      textEl.classList.remove('placeholder');
    }
  }
}

// Close button functionality
closeBtn.addEventListener('click', () => {
  if (window.jarvis && window.jarvis.hideTranscriptionBar) {
    window.jarvis.hideTranscriptionBar();
  }
});

// Initial load state check
async function initializeState() {
  if (window.jarvisVoice && window.jarvisVoice.getState) {
    try {
      const state = await window.jarvisVoice.getState();
      if (!state.enabled) {
        setStatus('idle', 'Микрофон отключен', true);
      } else if (!state.workerReady) {
        setStatus('processing', 'Подготовка модели STT...', true);
      } else {
        setStatus('idle', 'Слушаю...', true);
      }
    } catch (err) {
      console.error('Failed to get voice service state:', err);
    }
  }
}

// Register voice event listeners
if (window.jarvisVoice) {
  // Partial transcription transcription
  window.jarvisVoice.onPartial((msg) => {
    if (msg.text) {
      if (resetTimeout) clearTimeout(resetTimeout);
      setStatus('listening', msg.text);
    }
  });

  // Status and final recognized result messages
  window.jarvisVoice.onStatus((msg) => {
    console.log('[transcription-bar] received status event:', msg);

    // msg has format: { type, message, ...extra }
    if (msg.type === 'ready') {
      setStatus('idle', 'Слушаю...', true);
    } else if (msg.type === 'recognized') {
      setStatus('processing', msg.message);
    } else if (msg.type === 'intent') {
      setStatus('processing', 'Обработка команды...');
    } else if (msg.type === 'result') {
      setStatus('idle', msg.message);

      // Return to listening state after 4 seconds of showing the result
      if (resetTimeout) clearTimeout(resetTimeout);
      resetTimeout = setTimeout(() => {
        setStatus('idle', 'Слушаю...', true);
      }, 4000);
    } else if (msg.type === 'error') {
      setStatus('error', msg.message || 'Ошибка');
      if (resetTimeout) clearTimeout(resetTimeout);
      resetTimeout = setTimeout(() => {
        setStatus('idle', 'Слушаю...', true);
      }, 4000);
    } else if (msg.type === 'stopped') {
      setStatus('idle', 'Микрофон отключен', true);
    }
  });
}

// Run state initialization on load
document.addEventListener('DOMContentLoaded', initializeState);
