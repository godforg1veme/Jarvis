const TELEGRAM_FAILURE_CODES = Object.freeze({
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  MODEL_TIMEOUT: 'MODEL_TIMEOUT',
  RATE_LIMITED: 'RATE_LIMITED',
  VOICE_INVALID: 'VOICE_INVALID',
  VOICE_TRANSCRIPTION_FAILED: 'VOICE_TRANSCRIPTION_FAILED',
  TELEGRAM_DELIVERY_FAILED: 'TELEGRAM_DELIVERY_FAILED',
  TELEGRAM_FALLBACK_DELIVERY_FAILED: 'TELEGRAM_FALLBACK_DELIVERY_FAILED',
  DIALOGUE_UNAVAILABLE: 'DIALOGUE_UNAVAILABLE',
});

function classifyTelegramFailure(error) {
  const message = String(error?.message || '');
  if (error?.name === 'RateLimitError') return TELEGRAM_FAILURE_CODES.RATE_LIMITED;
  if (error?.name === 'TelegramVoiceTranscriptionError') return TELEGRAM_FAILURE_CODES.VOICE_TRANSCRIPTION_FAILED;
  if (error?.name === 'TelegramDeliveryError') return TELEGRAM_FAILURE_CODES.TELEGRAM_DELIVERY_FAILED;
  if (/^Telegram voice (?:is too large|duration is invalid)$/i.test(message)) {
    return TELEGRAM_FAILURE_CODES.VOICE_INVALID;
  }
  if (error?.name === 'AbortError' || /\b(?:timed out|timeout|ETIMEDOUT)\b/i.test(message)) {
    return TELEGRAM_FAILURE_CODES.MODEL_TIMEOUT;
  }
  if (/\b(?:openrouter|salad|gemini|provider|model response|model request)\b/i.test(message)) {
    return TELEGRAM_FAILURE_CODES.MODEL_UNAVAILABLE;
  }
  return TELEGRAM_FAILURE_CODES.DIALOGUE_UNAVAILABLE;
}

function telegramFailureReply(code) {
  if (code === TELEGRAM_FAILURE_CODES.RATE_LIMITED) {
    return 'Слишком много голосовых сообщений подряд. Можно отправить до трёх голосовых в минуту; попробуй немного позже.';
  }
  if (code === TELEGRAM_FAILURE_CODES.VOICE_INVALID) {
    return 'Голосовое не обработано: поддерживаются заметки до 5 МБ и до 120 секунд.';
  }
  if (code === TELEGRAM_FAILURE_CODES.VOICE_TRANSCRIPTION_FAILED) {
    return 'Не удалось распознать голосовое; его текст не сохранён. Отправь заметку ещё раз или напиши сообщение текстом.';
  }
  if (code === TELEGRAM_FAILURE_CODES.MODEL_TIMEOUT) {
    return 'Ответ модели занял слишком много времени. Сообщение принято; отправь следующий вопрос ещё раз через минуту.';
  }
  if (code === TELEGRAM_FAILURE_CODES.MODEL_UNAVAILABLE) {
    return 'Модель сейчас временно недоступна. Сообщение принято; попробуй отправить следующий вопрос через минуту.';
  }
  return 'Не удалось завершить это сообщение. Попробуй ещё раз; меню и остальные разделы Jarvis продолжают работать.';
}

module.exports = { TELEGRAM_FAILURE_CODES, classifyTelegramFailure, telegramFailureReply };
