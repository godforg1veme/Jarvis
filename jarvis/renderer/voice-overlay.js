let hideTimeout;

function showOverlay(text) {
  const container = document.getElementById('overlay-container');
  const textBox = document.getElementById('voice-text');

  if (!text.trim()) return;

  textBox.innerText = text;
  container.classList.remove('hidden');

  // Очищаем предыдущий таймер, если он был
  if (hideTimeout) {
    clearTimeout(hideTimeout);
  }

  // Скрываем оверлей через 2 секунды после последнего обновления
  hideTimeout = setTimeout(() => {
    container.classList.add('hidden');
  }, 2000);
}

// Подписываемся на события от главного процесса
if (window.jarvisVoice) {
  window.jarvisVoice.onPartial((msg) => {
    if (msg.text) {
      showOverlay(msg.text);
    }
  });

  // Также можно перехватывать финальные результаты
  window.jarvisVoice.onStatus((msg) => {
    if (['ready', 'recognized', 'stopped', 'error', 'result', 'ignored', 'final'].includes(msg.type)) {
      // При остановке голоса сразу скрываем
      const container = document.getElementById('overlay-container');
      container.classList.add('hidden');
    }
  });
}
