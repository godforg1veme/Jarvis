const { chatJson } = require('./aiClient');

const SELECTED_TEXT_ERROR = 'Не удалось получить выделенный текст';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTranslateMessages(text) {
  return [
    {
      role: 'system',
      content: 'Ты аккуратный переводчик. Переведи текст на русский язык. Верни только перевод без комментариев.',
    },
    {
      role: 'user',
      content: `Переведи на русский:\n\n${text}`,
    },
  ];
}

async function translateToRussian(text, options = {}) {
  const chat = options.chatJson || chatJson;
  const result = await chat(buildTranslateMessages(text), { timeoutMs: options.timeoutMs });
  return String(result || '').trim();
}

function makeErrorResult(content, error) {
  return {
    ok: false,
    type: 'error',
    title: 'Ошибка перевода',
    content,
    error: error ? error.message : content,
  };
}

function logTranslateError(logger, label, result) {
  logger.error(`[translate-selected] ${label}: ${result.title} - ${result.content}`);
}

async function translateSelectedText(options) {
  const {
    readClipboardText,
    writeClipboardText,
    copySelectedText,
    translateText = translateToRussian,
    logger = console,
    waitAfterCopyMs = 150,
    allowExistingClipboardFallback = false,
  } = options || {};

  if (typeof readClipboardText !== 'function') {
    throw new Error('translateSelectedText requires readClipboardText.');
  }
  if (typeof copySelectedText !== 'function') {
    throw new Error('translateSelectedText requires copySelectedText.');
  }

  const canRestoreClipboard = typeof writeClipboardText === 'function';
  let previousClipboard = '';
  let didClearClipboard = false;

  try {
    previousClipboard = String(readClipboardText() || '');
    if (canRestoreClipboard) {
      writeClipboardText('');
      didClearClipboard = true;
    }

    let copyError = null;
    try {
      await copySelectedText();
    } catch (error) {
      copyError = error;
    }
    if (waitAfterCopyMs > 0) await sleep(waitAfterCopyMs);

    const selectedText = String(readClipboardText() || '');
    let textToTranslate = selectedText;

    if (!selectedText.trim() || (!canRestoreClipboard && selectedText === previousClipboard)) {
      if (canRestoreClipboard) {
        writeClipboardText(previousClipboard);
        didClearClipboard = false;
      }

      if (allowExistingClipboardFallback && previousClipboard.trim()) {
        textToTranslate = previousClipboard;
        logger.log('[translate-selected] using existing clipboard text fallback');
      } else if (copyError) {
        throw copyError;
      } else {
      const result = makeErrorResult(SELECTED_TEXT_ERROR);
      logTranslateError(logger, 'failed to read selected text', result);
      return result;
      }
    }

    const translation = await translateText(textToTranslate);
    if (!String(translation || '').trim()) {
      const result = makeErrorResult('AI вернул пустой перевод.');
      logTranslateError(logger, 'empty translation', result);
      return result;
    }

    const result = {
      ok: true,
      type: 'translate',
      title: 'Перевод выделенного',
      content: String(translation).trim(),
      message: 'Перевод готов.',
      sourceText: textToTranslate,
    };
    logger.log(`[translate-selected] result: ${result.title}, sourceLength=${textToTranslate.length}`);
    return result;
  } catch (error) {
    if (canRestoreClipboard && didClearClipboard) {
      writeClipboardText(previousClipboard);
    }

    const result = makeErrorResult(`Не удалось перевести выделенный текст: ${error.message}`, error);
    logTranslateError(logger, 'error', result);
    return result;
  }
}

module.exports = {
  SELECTED_TEXT_ERROR,
  buildTranslateMessages,
  translateSelectedText,
  translateToRussian,
};
