# Jarvis

[Русский](#русский) | [English](#english)

## Русский

Jarvis помогает владельцу и семье через постоянно работающий облачный сервис
и приложение для Windows. Облако хранит учётные записи, диалоги и память,
предоставляет доступ к моделям, Telegram и связанным устройствам. Windows-клиент
выполняет разрешённые действия с локальными приложениями, файлами, окнами и голосом.

Telegram является первым облачным клиентом Jarvis. Проект также включает
Windows-приложение и облачный API для подключённых устройств.

### Текущие возможности

- Облачный сервис построен на Node.js, Fastify, PostgreSQL и pgvector.
  Провайдеры моделей настраиваются отдельно от логики продукта.
- Telegram-бот поддерживает допущенных пользователей, личные диалоги, пошаговый
  ввод, подтверждения кнопками, память, документы, устройства, VPN и Operations.
  В Life OS доступны Миссия, Хронология, проекты, обязательства, люди,
  напоминания, предпочтения и восстановление контекста.
- Основной текстовый ассистент на DE сначала выбирает согласованные бесплатные
  модели OpenRouter, затем платный резерв по оценке стоимости. Цены и доступность
  обновляются при использовании; список моделей остаётся фиксированным.
  [Результат выпуска и проверки](docs/updates/2026-10-19-free-first-routing-release.md).
- Даты и часы показываются в МСК UTC+3; время напоминаний без пояса также
  вводится по Москве. [Выпуск и проверки](docs/updates/2026-10-19-moscow-time-release.md).
- Telegram Mini App содержит настоящее вращающееся 3D-ядро, личный чат и админку:
  пользователи по Telegram ID, роли и личные разрешения. Владелец назначает
  администраторов. [Выпуск и клиентские проверки](docs/updates/2026-10-18-telegram-mini-app-release.md).
- Поиск работы собирает вакансии HH отдельным фоновым процессом на DE и отправляет
  отобранные карточки владельцу в Telegram. В боте доступны управление поиском,
  сохранённые вакансии, подготовка и редактирование сопроводительных писем.
  Модель запускается по запросу; отправка отклика требует одобрения точного текста
  письма. Живая отправка отклика ещё требует приёмки.
- Для капчи HH на DE включён дообученный OCR с выпрямлением изображения:
  до трёх автоматических попыток, затем фото владельцу в Telegram. Неизвестный
  результат останавливает автоматику раньше. Ответ на фото разрешает однократную
  отправку; подтверждённый доступ возобновляет поиск с сохранённого места.
  Ручной сценарий проверен 16 октября; первая живая OCR-попытка 18 октября
  не подтвердила доступ и передала фото человеку. Последующий живой тест ответа OCR
  после одобрения владельца дал `solved` и возобновил сбор; полностью автономный цикл
  пока не подтверждён. Tailscale и отдельная веб-страница
  не нужны. См. [выпуск и пределы проверки](docs/updates/2026-10-18-hh-ocr-live-acceptance.md).
- Сервис знаний хранит приватные метаданные и текст документов для поиска
  в пределах владельца. Поддерживает текстовые и офисные форматы, поиск по PDF
  со ссылками на страницы. Загруженное содержимое считается недоверенным.
- Windows-клиент на Electron предоставляет облачный чат, локальное распознавание
  ключевого слова, голос и ограниченные инструменты для приложений и файлов.
  Учётные данные устройства защищены Windows DPAPI.
- Удалённые действия на устройствах проходят через проверенный план и Tool Gateway.
  Действия, меняющие состояние, требуют подтверждения в исходном клиенте.
- Первый сценарий Vision поддерживает явное локальное разрешение на камеру или
  экран, захват двух дисплеев, ограниченное состояние сцены и визуальную память
  в пределах владельца. Два дисплея и камера Camo проверены локально;
  развёртывание провайдера Vision ещё не завершено.
- Голосовые сообщения допущенных Telegram-пользователей расшифровывает приватный
  GigaAM на DE-4 с ограничениями размера, длительности и частоты запросов.
  Реальный голос владельца в Telegram принят; голос с подключённого Desktop
  ещё требует клиентской проверки.
- Управление VPN поддерживает подписки Happ через узлы DE и NL с VLESS и Hysteria2.
  Supervisor может предложить ограниченный перезапуск службы после диагностики;
  выполнение требует нового подтверждения владельца. Результаты и оставшиеся
  клиентские проверки указаны в [текущем статусе](docs/README.md).

VPN-подписки предпочитают маршруты с подтверждённой доступностью, сохраняя
непроверенные как запасные. Срок свежести плановых проверок учитывает интервал
15 минут; разовые проверки по подтверждению владельца имеют более строгий срок.
Неопределённость маршрутов описана в [записи проверки от 8 октября 2026 года](docs/updates/2026-10-08-vpn-probe-resilience.md).

Карта документации различает локальные проверки, установленные возможности
и сценарии, ожидающие реального клиента. PWA и подключения реальных внешних
провайдеров Life OS остаются в планах.

### Запуск Windows-клиента

Требования: Windows x64 и Node.js 22.12 или новее. Проверен Node.js 24.14.1.
Из корня репозитория:

```powershell
npm run setup
npm start
```

`npm run setup` устанавливает зафиксированные зависимости и проверяет нативные
модули Vosk и исполняемый файл Electron. На Windows команда обрабатывает известный
сбой проверки установщика ffi-napi, сохраняя выполнение dependency scripts.
Если Electron не скачался, команда останавливается; повтори её после восстановления сети.

Сборка установщика Windows x64:

```powershell
npm run dist:win
```

Установщик включает Electron и среду распознавания ключевого слова. Сертификата
подписи кода нет, поэтому Windows может показать SmartScreen.
Подробности среды и правила локальных ресурсов: [AGENTS.md](AGENTS.md).

### Запуск облачного сервера

Нужны PostgreSQL и переменные окружения из [deploy/env.example](deploy/env.example).

```powershell
cd server
npm ci
npm test
npm start
```

Установка и обслуживание VPS описаны в [deploy/README.md](deploy/README.md).
Не добавляй в Git `.env`, содержимое `deploy/secrets/`, пользовательские данные
или сгенерированное состояние runtime.

### Структура репозитория и выпуск

Публикация, проверка веток и синхронизация компьютера с VPS описаны в
[руководстве по выпуску](docs/release-workflow.md). В нём есть
[объяснение и схемы синхронизации](docs/release-workflow.md#как-синхронизация-работает-сейчас).
См. также [описание выпуска от 9 октября 2026 года](docs/updates/2026-10-09-release-workflow.md).

Проверка установленного кода:

```powershell
py deploy/scripts/release-status.py --fetch --vps --desktop-app "C:/Program Files/Jarvis Desktop/resources/app" --check
```

Команда проверяет версии и состояние; установка выполняется отдельно в рамках
порученного выпуска. [Skill jarvis-release](.agents/skills/jarvis-release/SKILL.md)
использует тот же порядок.

- `server/`: облачный API, Telegram-бот, хранение данных, маршрутизация моделей и Life OS.
- `renderer/`, `main.js`, `preload.js`: Windows-клиент на Electron.
- `agents/`, `actions/`, `tools/`: локальное выполнение и его политики.
- `voice/`, `tts/`, `vision/`: голос, синтез речи и локальный захват.
- `host-agent/`: ограниченный Linux-исполнитель для VPN-операций.
- `deploy/`: Compose-файлы и порядок развёртывания.
- `docs/`: текущий статус, руководства эксплуатации, спецификации и планы реализации.

### Правила проекта

[AGENTS.md](AGENTS.md) задаёт правила для участников и агентов: архитектуру,
границы безопасности, работу с локальными данными, Telegram и команды проверок.
[docs/README.md](docs/README.md) содержит текущий статус и карту записей проекта.

## English

Jarvis is a personal and family assistant with an always-on cloud service and a Windows desktop client. The cloud service manages identity, conversations, memory, model access, Telegram, and device coordination. The desktop client handles approved work with local apps, files, windows, and voice.

Telegram is Jarvis's first cloud client. The project also includes a Windows app and a cloud API used by paired devices.

### Current capabilities

- The cloud service uses Node.js, Fastify, PostgreSQL, and pgvector. Model providers are configured outside product logic.
- The Telegram bot supports allowlisted users, private conversations, guided forms, inline confirmations, memory, documents, devices, VPN, and Operations. The Life OS area includes Mission, Timeline, projects, commitments, people, reminders, preferences, and context recovery.
- The main text assistant on DE prioritizes approved free OpenRouter models, then paid candidates by estimated cost. Prices and availability refresh on use; the model list remains fixed. See the [release and verification](docs/updates/2026-10-19-free-first-routing-release.md).
- Dates and clocks use Moscow UTC+3; reminder input without a timezone also means Moscow. See the [release and checks](docs/updates/2026-10-19-moscow-time-release.md).
- The Telegram Mini App includes an actual rotating 3D core, private chat and administration with Telegram IDs, roles and personal overrides. The owner appoints administrators. See the [release and client checks](docs/updates/2026-10-18-telegram-mini-app-release.md).
- Job search collects HH vacancies in a separate background process on DE and sends filtered cards to the owner's Telegram chat. Search controls, saved vacancies, and cover-letter preparation and editing are available in the bot. The model runs on request; submitting an application requires approval of the exact letter. Live application submission still needs acceptance.
- DE uses the fine-tuned HH OCR with image rectification: up to three automatic attempts, then a photo for the owner in Telegram. An unknown result stops automation earlier. Replying to the photo authorizes one submission; verified access resumes the search from its saved position. The human flow passed on 16 October; the first live OCR attempt on 18 October did not confirm access and handed a photo to the owner. A later live OCR answer test, approved by the owner, returned solved and resumed collection; a fully autonomous cycle remains unconfirmed. No Tailscale connection or separate web screen is needed. See the [release and verification limits](docs/updates/2026-10-18-hh-ocr-live-acceptance.md).
- The knowledge service stores private document metadata and text for owner-scoped search. It supports text and office formats, plus page-linked PDF search. Uploaded content is treated as untrusted data.
- The Windows Electron client provides cloud chat, local wake-word detection, speech, and bounded tools for apps and files. Device credentials are protected with Windows DPAPI.
- Remote device actions use a validated plan and Tool Gateway. Actions that change state require confirmation in the client that started the request.
- The first Vision workflow supports an explicit local camera or screen lease, two-display capture, bounded scene state, and owner-scoped visual memory. Two-display capture and a live Camo camera were tested locally; deployment of the Vision provider remains open.
- Allowlisted Telegram voice notes can be transcribed by the private GigaAM service on DE-4. The service processes `voice` notes under size, duration, and rate limits. Real owner Telegram voice was accepted; paired Desktop voice still needs a client check.
- VPN management supports Happ subscriptions across the DE and NL nodes, with VLESS and Hysteria2 options. The Supervisor can propose a limited service restart after diagnosis; execution requires a fresh owner confirmation. Current verification and remaining client checks are listed in [`docs/README.md`](docs/README.md).

VPN subscriptions prefer positively healthy routes and retain unverified routes as fallbacks. Scheduled proof freshness covers the 15-minute probe interval; owner-confirmed one-shot proofs retain stricter freshness. See the [verification record from 8 October 2026](docs/updates/2026-10-08-vpn-probe-resilience.md) for current route uncertainty.

The documentation index records which behavior has been tested locally, deployed, or still needs a real client check. PWA support and live integrations for the Life OS external providers remain planned.

### Start the Windows client

Requirements: Windows x64 and Node.js 22.12 or newer. Node.js 24.14.1 was verified. From the repository root:

```powershell
npm run setup
npm start
```

`npm run setup` installs the locked dependencies and verifies the Vosk native modules and Electron executable. On Windows it handles the known ffi-napi installer probe failure without disabling dependency scripts. If downloading Electron fails, the command stops; retry after restoring network access.

To create the Windows x64 installer:

```powershell
npm run dist:win
```

The installer includes Electron and the wake-word runtime. It is not signed with a code-signing certificate, so Windows may display a SmartScreen warning. See [`AGENTS.md`](AGENTS.md) for runtime details and local asset rules.

### Start the cloud server

The server requires PostgreSQL and environment variables described in [`deploy/env.example`](deploy/env.example).

```powershell
cd server
npm ci
npm test
npm start
```

For VPS setup and operations, see [`deploy/README.md`](deploy/README.md). Never commit `.env`, files from `deploy/secrets/`, user data, or generated runtime state.

### Repository layout and releases

The [release guide](docs/release-workflow.md) covers publishing, branch checks,
and synchronizing the computer with both VPS nodes.

See the [synchronization explanation and diagrams](docs/release-workflow.md#как-синхронизация-работает-сейчас)
and the [release record from 9 October 2026](docs/updates/2026-10-09-release-workflow.md).

To check the installed code:

```powershell
py deploy/scripts/release-status.py --fetch --vps --desktop-app "C:/Program Files/Jarvis Desktop/resources/app" --check
```

The command checks versions and status. Installation is a separate step within
an authorized release. The [jarvis-release skill](.agents/skills/jarvis-release/SKILL.md)
uses the same procedure.

- `server/` contains the cloud API, Telegram bot, persistence, model routing, and Life OS services.
- `renderer/`, `main.js`, and `preload.js` make up the Windows Electron client.
- `agents/`, `actions/`, and `tools/` contain the local execution path and its policies.
- `voice/`, `tts/`, and `vision/` contain desktop voice, speech output, and local capture workflows.
- `host-agent/` contains the restricted Linux-side execution service used by VPN operations.
- `deploy/` contains Compose files and deployment procedures.
- `docs/` contains the current status index, operational guides, specifications, and implementation plans.

### Project guidance

[`AGENTS.md`](AGENTS.md) is the authoritative guide for contributors and coding agents. It covers architecture, security boundaries, local data, Telegram interaction rules, and verification commands. [`docs/README.md`](docs/README.md) is the index for current status and project records.
