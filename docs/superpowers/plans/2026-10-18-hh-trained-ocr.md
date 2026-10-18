# План интеграции дообученного OCR HH

**Goal:** локально проверить исходную дообученную модель и ограничить автоматику
двумя попытками с сохранением человеческого Telegram пути.

**Spec:** [решение](../specs/2026-10-18-hh-trained-ocr-design.md).

**Architecture:** отдельный frozen Paddle backend на прежнем PNG/socket
контракте; durable budget в ManualState; автоматические шаги в serialized
CaptchaTelegramBrowser. Defaults выключены, production не меняется.

**Tech Stack:** CommonJS Node.js, Python, существующий Paddle/OpenCV runtime.

## Ограничения

- Никаких push, VPS изменений, новых реальных HH submissions и Telegram sends.
- Исходники OCR не менять; bundle и результаты не коммитить.
- Unknown не повторять; recoveryId, claims и owner scope сохранять.
- Production зависимости и Linux install остаются до согласования выпуска.

## Задачи

- [x] `job-ocr/prepare_frozen.py`: проверить pinned source/weights, создать
  приватный bundle; `frozen_backend.py`: валидировать bundle и PNG, загрузить
  Recognizer CPU. Добавить отдельный Dockerfile и manifest зависимостей.
- [x] `job-ocr/evaluate_frozen.py`: агрегаты accuracy, invalid, latency;
  сравнение адаптера с исходным конвейером, оригиналы и синтетика. Прогнать
  исходные `test_recognition` и проверки границ worker.
- [x] `manualState.js`/`manualCoordinator.js`: совместимый durable auto budget;
  `captchaAutomatic.js`: два шага и безопасная передача человеку;
  `browserMain.js`: opt-in; `jobCaptchaClient.js`/worker: закрытый `preparing`.
  Покрыть успехи, отказ, unknown, перезапуск, новый recovery, scope и concurrent.
- [x] Локальная browser fixture через существующий Playwright/Edge: native
  route gate, свежие картинки, две отправки максимум и переход к человеку.
- [x] Прогнать browser/server suites и Telegram contract gate; обновить
  runtime-context, menu contract, verification и RU/EN development status.
  Проверить source guard/diff. Сохранить локальную ветку и предложить выпуск
  с точным перечнем ещё не проверенного на Linux/HH/Telegram.

## Фактический результат

Локальные задачи выполнены; [полный результат](../../updates/2026-10-18-hh-trained-ocr-development.md).
Source guard корректно отклонил незакоммиченную task branch: deploy staging
не выполнялся. Исходный OCR checkout чистый. Публикация, новые production
зависимости, Linux build/resource/socket tests и реальная приёмка ждут решения
владельца. Это граница следующего этапа, а не выполненный выпуск.
