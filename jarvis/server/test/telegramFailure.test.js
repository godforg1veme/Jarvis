const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TELEGRAM_FAILURE_CODES,
  classifyTelegramFailure,
  telegramFailureReply,
} = require('../src/telegram/telegramFailure');

test('Telegram failure replies are closed, useful, and never echo a provider error', () => {
  const providerError = new Error('OpenRouter request failed: private diagnostic details');
  const code = classifyTelegramFailure(providerError);
  const reply = telegramFailureReply(code);

  assert.equal(code, TELEGRAM_FAILURE_CODES.MODEL_UNAVAILABLE);
  assert.match(reply, /Модель сейчас временно недоступна/);
  assert.equal(reply.includes(providerError.message), false);
});

test('Telegram failure classifier keeps a closed fallback for infrastructure failures', () => {
  const code = classifyTelegramFailure(new Error('database connection reset'));

  assert.equal(code, TELEGRAM_FAILURE_CODES.DIALOGUE_UNAVAILABLE);
  assert.match(telegramFailureReply(code), /меню и остальные разделы Jarvis продолжают работать/);
});

test('Telegram voice transcription failures do not claim that the message was accepted', () => {
  const error = new Error('private ASR provider response');
  error.name = 'TelegramVoiceTranscriptionError';
  const code = classifyTelegramFailure(error);
  const reply = telegramFailureReply(code);

  assert.equal(code, TELEGRAM_FAILURE_CODES.VOICE_TRANSCRIPTION_FAILED);
  assert.match(reply, /текст не сохранён/);
  assert.match(reply, /Отправь заметку ещё раз/);
  assert.equal(reply.includes(error.message), false);
});
