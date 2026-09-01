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

- Windows-приложение Electron с лаунчером, голосовым управлением и TTS;
- безопасные локальные инструменты для приложений, файлов и окон;
- поиск файлов по всем локальным дискам через Everything с ограниченным
  резервным поиском;
- Voice Lab для настройки Faster Whisper, профилей микрофона и калибровки;
- облачный Node.js/Fastify-сервер, PostgreSQL с pgvector и Docker Compose;
- Telegram-бот с allowlist, пользовательской изоляцией, дедупликацией обновлений
  и сохранением переписки;
- OpenAI-совместимый шлюз моделей с fallback-провайдером;
- единая системная инструкция Jarvis, адаптеры моделей и проверка ответов;
- базовые контракты удалённых команд и единая политика локальных инструментов.

Развивается:

- долговременная память и персональная база знаний поверх уже подготовленной
  схемы PostgreSQL/pgvector;
- подключение Windows-устройств к облаку по исходящему защищённому соединению;
- выполнение подтверждённых команд на выбранном устройстве пользователя;
- серверная транскрибация голосовых сообщений;
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
- `voice/`, `stt_runtime/` — локальный голос, Faster Whisper и Voice Lab.
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
node scripts/ensureTts.js
node scripts/ensureStt.js
npm start
```

`start.bat` автоматически подготавливает выбранные локальные TTS/STT runtime
перед запуском Electron.

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
