# Jarvis

Jarvis — гибридная платформа персонального и семейного AI-ассистента. Облачная
часть остаётся доступной независимо от домашних компьютеров, хранит раздельные
диалоги пользователей и обращается к моделям. Локальное Windows-приложение
принимает голосовые и текстовые команды и служит исполнительным контуром для
работы с приложениями, файлами и окнами.

Коротко: **облачный мозг и память + локальные руки на устройствах**. Telegram —
первый облачный клиент, а не граница продукта. Архитектура рассчитана на PWA,
серверное распознавание речи, камеры, персональные базы знаний и несколько
устройств одного пользователя.

## Текущее состояние

Реализовано и проверено:

- Windows-приложение Electron с отдельным облачным Desktop-интерфейсом: чат,
  привязка через Telegram, DPAPI-защищённый токен, исходящая WSS-сессия и TTS;
- NSIS-установщик Windows x64 для облачного Desktop: без Node.js, Python и
  Large Whisper на компьютере пользователя;
- постоянный локальный wake word «Джарвис»: звук до активации остаётся на ПК;
  лёгкий Vosk-детектор запускается в изолированном встроенном Node-процессе;
- безопасные локальные инструменты для приложений, файлов и окон;
- поиск файлов по всем локальным дискам через Everything с ограниченным
  резервным поиском;
- Voice Lab для настройки Faster Whisper, профилей микрофона и калибровки;
- облачный Node.js/Fastify-сервер, PostgreSQL с pgvector и Docker Compose;
- Telegram-бот с allowlist, пользовательской изоляцией, дедупликацией обновлений
  и сохранением переписки;
- MVP долговременной памяти, общей для Telegram и привязанных Desktop: команды
  «запомни», «забудь», «исправь», «что ты обо мне помнишь», высокоуверенное
  выделение простых фактов и запрет на сохранение паролей, токенов и платёжных данных;
- OpenAI-совместимый шлюз моделей с fallback-провайдером;
- единая системная инструкция Jarvis, адаптеры моделей и проверка ответов;
- базовые контракты удалённых команд и единая политика локальных инструментов.
- серверные маршруты привязки устройства, Desktop-чата и однократной отправки
  голоса с изоляцией по владельцу устройства и идемпотентностью запросов.
- проверяемый серверный ответ о привязанных компьютерах: `/devices` и вопросы
  вида «К какому ПК я привязан?» не зависят от ответа модели.

Развивается:

- персональная база знаний поверх уже подготовленной схемы PostgreSQL/pgvector;
- выполнение подтверждённых команд на выбранном устройстве пользователя;
- выбор и замер конкретной серверной ASR-модели: контракт уже есть, но
  `JARVIS_ASR_PROVIDER` по умолчанию выключен до бенчмарка на DE-4;
- переключение между OpenRouter, Salad и другими совместимыми провайдерами;
- PWA, обработка изображений и работа с камерой.

Планы не следует описывать как готовые функции. Актуальная карта документации и
статусы находятся в [`docs/README.md`](docs/README.md).

## Архитектура

```text
Telegram / будущая PWA / локальный Electron
                    |
          Jarvis cloud control plane
   identity · conversations · prompt policy
   model gateway · PostgreSQL/pgvector · audit
                    |
       outbound connection to Windows agents
                    |
      Node Tool Gateway -> local OS actions
```

Облачный сервер отвечает за идентичность Jarvis, маршрутизацию моделей,
пользовательский контекст и постоянные данные. Базовая модель не определяет
личность ассистента. Канонический prompt pipeline находится в `server/src/prompts/`,
а ответы дополнительно проверяются в `server/src/assistant/`.

Windows-клиент остаётся единственной стороной, которая непосредственно меняет
состояние компьютера. LLM не создаёт произвольные shell- или PowerShell-команды:
она может запросить только объявленное действие с валидируемыми аргументами.
Безопасные операции выполняются по политике инструмента, изменяющие требуют
подтверждения в исходном клиенте.

## Структура проекта

- `server/` — постоянно работающий облачный control plane, Telegram и модели.
- `deploy/` — Docker Compose, PostgreSQL/pgvector и операции VPS.
- `main.js`, `preload.js`, `renderer/` — Electron lifecycle и интерфейсы Windows.
- `voice/` — захват микрофона, wake word, облачная передача голоса и Voice Lab;
  `stt_runtime/` с Faster Whisper остаётся development-only подсистемой.
- `tts/` — Silero/Piper за общим TTS-интерфейсом.
- `tools/`, `actions/` — локальные инструменты и их выполнение.
- `agents/` — Desktop Agent, Tool Gateway и контракты удалённых устройств.
- `agent_runtime/` — существующий Python/LangGraph runtime локального агента.
- `data/` — настройки по умолчанию и игнорируемое локальное состояние.
- `docs/` — карта документации, спецификации и планы.

## Локальный запуск Windows-клиента

Требования: Windows, Node.js и зависимости из `package.json`.

```powershell
npm install
npm start
```

`npm start` запускает новый облачный Desktop. Старый локальный режим остаётся
для разработки как `npm run start:legacy` и не является способом установки для
семьи.

## Установщик для семьи и друзей

Соберите один установщик x64:

```powershell
npm run dist:win
```

Готовый файл: `dist/Jarvis-Desktop-<version>-Setup.exe`. Он содержит Electron,
лёгкую Vosk-модель для wake word и маленький встроенный Node-runtime; пользователю
не нужны Node.js, Python, CUDA или Large Whisper. Перед распространением настройте
на VPS публичный HTTPS-домен и серверный ASR-провайдер. Для подключения человек:

1. Пишет боту `/pair Имя ПК`.
2. Устанавливает Desktop и вводит домен Jarvis и одноразовый код.
3. Пишет в чат или включает голос и говорит «Джарвис».

Установщик сейчас не подписан сертификатом кода: Windows может показать
предупреждение SmartScreen. Для публичного распространения нужен отдельный
сертификат подписи кода; не добавляйте его ключ в репозиторий или CI-логи.

Для поиска по всему компьютеру установите Everything 1.4 x64 и официальный
`es.exe`, включив Everything Service и автозапуск. Пути можно переопределить
через `EVERYTHING_ES_PATH` и `EVERYTHING_EXE_PATH`.

## Локальный запуск облачного сервера

```powershell
cd server
npm install
npm test
npm start
```

Для полноценного запуска требуются PostgreSQL и переменные окружения из
`deploy/env.example`. Секреты нельзя помещать в репозиторий. Инструкции VPS
находятся в [`deploy/README.md`](deploy/README.md).

## Основные проверки

```powershell
node scripts/testEverythingSearch.js
node scripts/testFileCommands.js
node scripts/testToolGateway.js
node scripts/testRemoteProtocol.js
node scripts/testToolPolicyMapping.js
node scripts/testSttSettings.js
node scripts/testVoiceServiceSttProvider.js
node scripts/testVoiceQualityMonitor.js
node scripts/testVoiceLabController.js
node scripts/testGeminiVoiceAdvisor.js
node scripts/testVoiceLabRenderer.js
node --test cloud/*.test.js voice/cloudVoiceService.test.js tts/windowsSapiService.test.js
npm run dist:win
python scripts/testFasterWhisperQuality.py
cd server
npm test
```

Перед изменением кода агент обязан прочитать [`AGENTS.md`](AGENTS.md).

## Секреты и локальные данные

API-ключи и токены передаются только через переменные окружения или закрытые
файлы на сервере. Не коммитьте `.env`, содержимое `deploy/secrets/`, идентичности
устройств, пользовательские документы, модели, голоса, логи и файлы из `data/`,
помеченные в `AGENTS.md` как runtime state.
