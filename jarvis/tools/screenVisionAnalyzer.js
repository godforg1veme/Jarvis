const fs = require('fs');
const path = require('path');
const { chatVision, resolveVisionModel } = require('./aiClient');

const DEFAULT_CROP_WIDTH = 900;
const DEFAULT_CROP_HEIGHT = 600;
const CONTEXT_TTL_MS = 2 * 60 * 1000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SYSTEM_PROMPT = `Ты Jarvis, локальный помощник пользователя на Windows.
Пользователь просит посмотреть на область экрана вокруг курсора мыши.
Курсор находится примерно в центре изображения и отмечен визуальным маркером.

Твоя задача:
- кратко опиши, что видно на изображении;
- определи, на что, вероятно, указывает пользователь;
- если видно ошибку, код, интерфейс, кнопку, предупреждение или текст — объясни самое важное;
- если контекста недостаточно — задай один короткий уточняющий вопрос;
- не выдумывай детали, которых не видно;
- не предлагай опасные действия;
- отвечай по-русски, максимум 4 коротких предложения.`;

let visualContext = null;
let cleanupTimer = null;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function nowMs() {
  return Date.now();
}

function isExpired(context = visualContext) {
  return !context || nowMs() - Number(context.timestamp || 0) > CONTEXT_TTL_MS;
}

function safeUnlink(filePath, logger = console) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (error) {
    logger.warn(`[visual] failed to delete temp screenshot: ${error.message}`);
  }
}

function scheduleContextCleanup(logger = console) {
  if (cleanupTimer) clearTimeout(cleanupTimer);
  cleanupTimer = setTimeout(() => {
    if (!visualContext || !isExpired(visualContext)) return;
    safeUnlink(visualContext.cropPath, logger);
    visualContext = null;
  }, CONTEXT_TTL_MS + 1000);
}

function clearExpiredContext(logger = console) {
  if (!visualContext || !isExpired(visualContext)) return false;
  safeUnlink(visualContext.cropPath, logger);
  visualContext = null;
  return true;
}

function clearVisualContext(logger = console) {
  if (cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
  safeUnlink(visualContext?.cropPath, logger);
  visualContext = null;
  return {
    ok: true,
    type: 'visual',
    title: 'Визуальный контекст очищен',
    content: 'Я забыл последний скриншот и продолжение диалога.',
    message: 'Визуальный контекст очищен.',
  };
}

function makeErrorResult(content, error) {
  return {
    ok: false,
    type: 'error',
    title: 'Ошибка анализа экрана',
    content,
    error: error ? error.message : content,
    message: content,
  };
}

function makeSuccessResult(answer, extra = {}) {
  return {
    ok: true,
    type: 'visual',
    title: 'AI-анализ области экрана',
    content: answer,
    message: answer,
    ...extra,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setPixel(bitmap, width, x, y, color) {
  if (x < 0 || y < 0 || x >= width) return;
  const index = (y * width + x) * 4;
  if (index < 0 || index + 3 >= bitmap.length) return;

  bitmap[index] = color.b;
  bitmap[index + 1] = color.g;
  bitmap[index + 2] = color.r;
  bitmap[index + 3] = color.a;
}

function drawDot(bitmap, width, height, x, y, radius, color) {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if ((dx * dx) + (dy * dy) > radius * radius) continue;
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      setPixel(bitmap, width, px, py, color);
    }
  }
}

function drawLine(bitmap, width, height, x1, y1, x2, y2, radius, color) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = Math.round(x1 + (x2 - x1) * t);
    const y = Math.round(y1 + (y2 - y1) * t);
    drawDot(bitmap, width, height, x, y, radius, color);
  }
}

function addCursorMarker(cropImage, nativeImage, markerX, markerY) {
  const size = cropImage.getSize();
  if (!size.width || !size.height) {
    throw new Error('Не удалось обрезать изображение: crop пустой.');
  }

  const bitmap = Buffer.from(cropImage.toBitmap());
  const x = clamp(Math.round(markerX), 0, size.width - 1);
  const y = clamp(Math.round(markerY), 0, size.height - 1);
  const black = { r: 0, g: 0, b: 0, a: 255 };
  const white = { r: 255, g: 255, b: 255, a: 255 };
  const red = { r: 255, g: 42, b: 42, a: 255 };
  const line = 38;

  drawLine(bitmap, size.width, size.height, x - line, y, x + line, y, 5, black);
  drawLine(bitmap, size.width, size.height, x, y - line, x, y + line, 5, black);
  drawLine(bitmap, size.width, size.height, x - line, y, x + line, y, 3, white);
  drawLine(bitmap, size.width, size.height, x, y - line, x, y + line, 3, white);
  drawLine(bitmap, size.width, size.height, x - line, y, x + line, y, 1, red);
  drawLine(bitmap, size.width, size.height, x, y - line, x, y + line, 1, red);
  drawDot(bitmap, size.width, size.height, x, y, 7, black);
  drawDot(bitmap, size.width, size.height, x, y, 5, white);
  drawDot(bitmap, size.width, size.height, x, y, 3, red);

  const marked = nativeImage.createFromBitmap(bitmap, {
    width: size.width,
    height: size.height,
    scaleFactor: 1,
  });

  if (!marked || marked.isEmpty()) {
    throw new Error('Не удалось добавить маркер на изображение.');
  }

  return marked;
}

async function captureScreenCrop(options = {}) {
  const {
    screen,
    desktopCapturer,
    nativeImage,
    app,
    logger = console,
    cropWidth = DEFAULT_CROP_WIDTH,
    cropHeight = DEFAULT_CROP_HEIGHT,
  } = options;

  if (!screen || typeof screen.getCursorScreenPoint !== 'function') {
    throw new Error('Не удалось получить координаты мыши: Electron screen недоступен.');
  }
  if (!desktopCapturer || typeof desktopCapturer.getSources !== 'function') {
    throw new Error('Не удалось сделать скриншот: desktopCapturer недоступен.');
  }
  if (!nativeImage || typeof nativeImage.createFromBitmap !== 'function') {
    throw new Error('Не удалось обрезать изображение: nativeImage недоступен.');
  }

  const cursor = screen.getCursorScreenPoint();
  if (!cursor || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) {
    throw new Error('Не удалось получить координаты мыши.');
  }

  const display = screen.getDisplayNearestPoint(cursor);
  if (!display || !display.bounds) {
    throw new Error('Не удалось определить экран под курсором.');
  }

  const thumbnailSize = {
    width: Math.max(1, Math.round(display.bounds.width)),
    height: Math.max(1, Math.round(display.bounds.height)),
  };
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize,
    fetchWindowIcons: false,
  });
  const displayId = String(display.id);
  const source = sources.find(item => String(item.display_id) === displayId) || sources[0];

  if (!source || !source.thumbnail || source.thumbnail.isEmpty()) {
    throw new Error('Не удалось сделать скриншот.');
  }

  const fullImage = source.thumbnail;
  const fullSize = fullImage.getSize();
  if (!fullSize.width || !fullSize.height) {
    throw new Error('Не удалось сделать скриншот: изображение пустое.');
  }

  const scaleX = fullSize.width / display.bounds.width;
  const scaleY = fullSize.height / display.bounds.height;
  const cursorX = (cursor.x - display.bounds.x) * scaleX;
  const cursorY = (cursor.y - display.bounds.y) * scaleY;
  const width = Math.min(Math.round(cropWidth), fullSize.width);
  const height = Math.min(Math.round(cropHeight), fullSize.height);
  const x = clamp(Math.round(cursorX - width / 2), 0, Math.max(0, fullSize.width - width));
  const y = clamp(Math.round(cursorY - height / 2), 0, Math.max(0, fullSize.height - height));
  const crop = fullImage.crop({ x, y, width, height });

  if (!crop || crop.isEmpty()) {
    throw new Error('Не удалось обрезать изображение.');
  }

  const markerX = cursorX - x;
  const markerY = cursorY - y;
  const marked = addCursorMarker(crop, nativeImage, markerX, markerY);
  const png = marked.toPNG();

  if (!png || png.length === 0) {
    throw new Error('Не удалось сохранить обрезанное изображение.');
  }
  if (png.length > MAX_IMAGE_BYTES) {
    throw new Error(`Изображение слишком большое (${png.length} bytes).`);
  }

  const tempRoot = app && typeof app.getPath === 'function'
    ? app.getPath('temp')
    : path.join(__dirname, '..', 'data');
  const outputDir = path.join(tempRoot, 'jarvis-visual-context');
  ensureDir(outputDir);

  const cropPath = path.join(outputDir, `visual-${Date.now()}.png`);
  fs.writeFileSync(cropPath, png);

  logger.log(`[visual] crop created path="${cropPath}" size=${width}x${height} bytes=${png.length}`);

  return {
    cropPath,
    imageBytes: png.length,
    imageSize: { width, height },
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
  };
}

function buildVisionMessages(command, imageDataUrl, previousMessages = []) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...previousMessages.slice(-3).map((message) => ({
      role: message.role,
      content: String(message.content || ''),
    })),
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Команда пользователя: ${String(command || '').trim()}`,
        },
        {
          type: 'image_url',
          image_url: { url: imageDataUrl },
        },
      ],
    },
  ];

  return messages;
}

function appendVisualMessages(command, answer) {
  if (!visualContext) return;
  const nextMessages = [
    ...(visualContext.messages || []),
    { role: 'user', content: String(command || '') },
    { role: 'assistant', content: String(answer || '') },
  ];
  visualContext.messages = nextMessages.slice(-3);
}

async function askVisionModel({ command, cropPath, imageDataUrl, previousMessages, chat = chatVision, logger = console }) {
  const model = resolveVisionModel();
  const startedAt = Date.now();
  logger.log(`[visual] ai request command="${command}" model="${model}"`);

  try {
    const answer = await chat(buildVisionMessages(command, imageDataUrl, previousMessages), {
      model,
    });
    const durationMs = Date.now() - startedAt;
    logger.log(`[visual] ai success model="${model}" durationMs=${durationMs} crop="${cropPath}"`);
    return { answer: String(answer || '').trim(), model, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    logger.error(`[visual] ai error model="${model}" durationMs=${durationMs}: ${error.message}`);
    throw error;
  }
}

async function analyzeVisualArea(command, options = {}) {
  const logger = options.logger || console;
  logger.log(`[visual] command="${command}" action=analyze`);
  clearExpiredContext(logger);
  let pendingCropPath = null;

  try {
    const captureFn = options.captureScreenCrop || captureScreenCrop;
    const capture = await captureFn(options);
    pendingCropPath = capture.cropPath;
    const previousPath = visualContext?.cropPath;
    const { answer, model, durationMs } = await askVisionModel({
      command,
      cropPath: capture.cropPath,
      imageDataUrl: capture.dataUrl,
      previousMessages: [],
      chat: options.chatVision || chatVision,
      logger,
    });

    if (!answer) {
      throw new Error('AI vision-модель вернула пустой ответ.');
    }

    safeUnlink(previousPath, logger);
    pendingCropPath = null;
    visualContext = {
      cropPath: capture.cropPath,
      command: String(command || ''),
      answer,
      timestamp: Date.now(),
      messages: [
        { role: 'user', content: String(command || '') },
        { role: 'assistant', content: answer },
      ],
    };
    scheduleContextCleanup(logger);

    return makeSuccessResult(answer, {
      data: {
        cropPath: capture.cropPath,
        imageSize: capture.imageSize,
        imageBytes: capture.imageBytes,
        model,
        durationMs,
      },
    });
  } catch (error) {
    safeUnlink(pendingCropPath, logger);
    logger.error(`[visual] error command="${command}": ${error.message}`);
    return makeErrorResult(`Не удалось проанализировать область экрана: ${error.message}`, error);
  }
}

async function continueVisualDialog(command, options = {}) {
  const logger = options.logger || console;
  logger.log(`[visual] command="${command}" action=continue`);
  clearExpiredContext(logger);

  if (!visualContext) {
    return makeErrorResult('Визуальный контекст истёк или отсутствует. Скажите "посмотри сюда" ещё раз.');
  }

  try {
    if (!fs.existsSync(visualContext.cropPath)) {
      visualContext = null;
      return makeErrorResult('Последний скриншот уже удалён. Скажите "посмотри сюда" ещё раз.');
    }

    const png = fs.readFileSync(visualContext.cropPath);
    if (png.length > MAX_IMAGE_BYTES) {
      throw new Error(`Изображение слишком большое (${png.length} bytes).`);
    }

    const { answer, model, durationMs } = await askVisionModel({
      command,
      cropPath: visualContext.cropPath,
      imageDataUrl: `data:image/png;base64,${png.toString('base64')}`,
      previousMessages: visualContext.messages || [],
      chat: options.chatVision || chatVision,
      logger,
    });

    if (!answer) {
      throw new Error('AI vision-модель вернула пустой ответ.');
    }

    visualContext.command = String(command || '');
    visualContext.answer = answer;
    visualContext.timestamp = Date.now();
    appendVisualMessages(command, answer);
    scheduleContextCleanup(logger);

    return makeSuccessResult(answer, {
      data: {
        cropPath: visualContext.cropPath,
        model,
        durationMs,
      },
    });
  } catch (error) {
    logger.error(`[visual] continue error command="${command}": ${error.message}`);
    return makeErrorResult(`Не удалось продолжить визуальный диалог: ${error.message}`, error);
  }
}

function getVisualContext() {
  clearExpiredContext(console);
  if (!visualContext) return null;
  return {
    cropPath: visualContext.cropPath,
    command: visualContext.command,
    answer: visualContext.answer,
    timestamp: visualContext.timestamp,
    messages: [...(visualContext.messages || [])],
  };
}

module.exports = {
  SYSTEM_PROMPT,
  CONTEXT_TTL_MS,
  MAX_IMAGE_BYTES,
  analyzeVisualArea,
  continueVisualDialog,
  clearVisualContext,
  getVisualContext,
  buildVisionMessages,
  captureScreenCrop,
  addCursorMarker,
};
