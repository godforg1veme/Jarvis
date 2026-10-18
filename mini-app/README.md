# Jarvis Telegram Mini App

[Русский](#русский) | [English](#english)

## Русский

18 октября 2026 Mini App выпущен на DE; в боте настроена кнопка «Открыть Jarvis».
[Проверки и ограничения выпуска](../docs/updates/2026-10-18-telegram-mini-app-release.md).
Вход проверяет подписанные
Telegram initData; личность определяется числовым Telegram ID. Email не нужен.
Вне Telegram клиент не выдаёт демонстрационных прав.

Работают роли, персональные allow/deny/inherit, назначение администраторов
владельцем, блокировка, подтверждение изменений, revision/CAS и аудит.
Администрирование не открывает чужие диалоги, память и документы. Изменение роли
обновляет revision её участников, поэтому старые пользовательские редакторы
не сохранятся поверх новых прав. Перезапуск не снимает блокировки и назначения.

Главная содержит настоящее 3D-ядро Three.js: кольца вращаются независимо,
есть перетаскивание, скорость, пауза, reduced motion и статичный WebGL fallback.
Скрытая сцена останавливается. Анимация не использует внешний API/CDN;
вход загружает официальный Telegram Web App SDK.

Доступны личный текстовый диалог и чтение своих памяти, документов, устройств
и Life OS, если эти серверные сервисы включены. Действия с подтверждением
остаются в Telegram/Desktop. Для второго поиска HH нужно собственное подключение:
одна галочка не открывает браузер владельца. Общие VPN/Operations/Supervisor
сохраняют отдельные owner-bound ограничения.

При неизвестном результате sessionStorage хранит только исходный UUID, тип
операции и Telegram ID. Тексты и credentials туда не попадают. После reload
клиент предлагает сверить исходный запрос и не отправляет его повторно.

### Сборка и запуск

```powershell
npm ci --prefix mini-app
npm run build --prefix mini-app
```

Сборка копирует закрытый набор файлов в `dist/`; Fastify отдаёт их по `/mini/`.
Dockerfile сервера содержит отдельный этап сборки. Windows Desktop исключает
эти ресурсы; его runtime не менялся.

Реальный вход требует существующих PostgreSQL и Telegram bot, стабильного
`JARVIS_OPERATIONS_OWNER_TELEGRAM_ID`, `JARVIS_MINI_APP_ENABLED=true` и
`JARVIS_MINI_APP_PUBLIC_ORIGIN=https://<домен>` без пути. Migration 037 хранит
права/аудит/сессии, 038 — квитанции ассистента; обе forward-only. Секреты идут
через штатное окружение. Выключение UI сохраняет уже заведённые проверки прав.

После отдельного поручения на выпуск HTTPS URL `https://<домен>/mini/`
настраивается как menu button через Bot API; Main Mini App можно задать
отдельно в BotFather. Только
Mini App получает ограниченное разрешение Telegram Web framing; другие
страницы сохраняют DENY. Cookie имеет HttpOnly/Secure/SameSite=None/Partitioned.

Отдельное дизайн-превью: `npm run dev --prefix mini-app`,
http://127.0.0.1:5187/. Это loopback-сервер, вымышленные ID и изменения в памяти
вкладки; production сборка исключает preview-файлы. Не публикуйте этот сервер.

### Проверки

```powershell
node scripts/testMiniAppPreview.cjs
node scripts/testMiniAppClient.cjs
npm test --prefix server
# JARVIS_MINI_TEST_DATABASE_URL указывает только на отдельную тестовую БД.
node --test server/test/miniAppPostgresAcceptance.cjs server/test/miniAppIntegrationAcceptance.cjs
```

Первый тест требует работающий preview; `MINI_PREVIEW_URL` меняет адрес.
Browser tests используют имеющиеся Playwright из job-browser и Edge.
Артефакты: игнорируемая `.superpowers/mini-app-preview/`.
Прошли 741 server test, 8 настоящих изолированных PostgreSQL acceptance,
production browser fixtures и 3D preview. Linux Docker build, 741 server test,
8 PostgreSQL acceptance и полный pipeline 40 migrations также прошли.
Выпуск на DE и кнопка бота проверены. Реальный Telegram/CHIPS cookie,
телефонный FPS и второй HH остаются для клиентской приёмки.

[Спецификация](../docs/superpowers/specs/2026-10-18-telegram-mini-app-design.md),
[результат](../docs/updates/2026-10-18-telegram-mini-app-release.md).

## English

The Mini App was deployed on DE on October 18, 2026; the bot menu opens it.
[Release checks and limits](../docs/updates/2026-10-18-telegram-mini-app-release.md).
The server verifies
signed Telegram initData and identifies users by numeric Telegram ID. Email is
unnecessary. Clients outside Telegram receive no demo privileges.

Roles, personal allow/deny/inherit, owner-only administrator appointment,
blocking, change confirmation, revision/CAS and audit are implemented.
Administration does not open other people's conversations, memory or documents.
Role changes increment member revisions so old user editors cannot save over
new permissions. Restarting preserves blocks and assignments.

The home screen contains an actual Three.js core with independently rotating
rings, dragging, speed, pause, reduced motion and a static WebGL fallback.
Hidden scenes stop rendering. Animation uses no external API/CDN;
authentication loads the official Telegram Web App SDK.

Private text conversation and own memory, document, device and Life OS reads
are available when their server services are enabled. Confirmed actions remain
in Telegram/Desktop. A second HH search needs a personal connection: a checkbox
never opens the owner's browser. Shared VPN/Operations/Supervisor retains
separate owner-bound limits.

For unknown outcomes sessionStorage holds only the original UUID, operation
kind and Telegram ID. Text and credentials are never stored there. After reload
the client offers original-request reconciliation without resubmission.

### Build and launch

```powershell
npm ci --prefix mini-app
npm run build --prefix mini-app
```

The build copies an explicit allowlist into `dist/`, served by Fastify at
`/mini/`. The server Dockerfile includes a separate build stage. Windows Desktop
excludes these resources and its runtime is unchanged.

Real authentication needs the existing PostgreSQL and Telegram bot, a stable
`JARVIS_OPERATIONS_OWNER_TELEGRAM_ID`, `JARVIS_MINI_APP_ENABLED=true` and
`JARVIS_MINI_APP_PUBLIC_ORIGIN=https://<domain>` without a path. Migration 037
stores access/audit/sessions and 038 assistant receipts; both are forward-only.
Secrets use the normal environment. Disabling the UI preserves established
permission enforcement.

After separate release authorization, configure HTTPS URL
`https://<domain>/mini/` as the bot menu button using the Bot API. Main Mini App
can be configured separately in BotFather.
Only the Mini App receives restricted Telegram Web framing; other pages keep
DENY. Cookies use HttpOnly/Secure/SameSite=None/Partitioned.

Separate design preview: `npm run dev --prefix mini-app`,
http://127.0.0.1:5187/. It is a loopback server with fictional IDs and tab-memory
edits; production builds exclude preview files. Do not publish that server.

### Verification

```powershell
node scripts/testMiniAppPreview.cjs
node scripts/testMiniAppClient.cjs
npm test --prefix server
# JARVIS_MINI_TEST_DATABASE_URL must point only to an isolated test database.
node --test server/test/miniAppPostgresAcceptance.cjs server/test/miniAppIntegrationAcceptance.cjs
```

The first test requires a running preview; `MINI_PREVIEW_URL` overrides its URL.
Browser tests use existing job-browser Playwright and Edge. Artifacts remain
under ignored `.superpowers/mini-app-preview/`. Verification passed 741 server
tests, 8 actual isolated PostgreSQL acceptance tests, production browser
fixtures and the 3D preview. Linux Docker build, 741 server tests,
8 PostgreSQL acceptance tests and the full 40-migration pipeline also passed.
DE deployment and the bot button were verified. Actual Telegram/CHIPS cookies,
phone FPS and a second HH account still need client acceptance.

[Specification](../docs/superpowers/specs/2026-10-18-telegram-mini-app-design.md),
[results](../docs/updates/2026-10-18-telegram-mini-app-release.md).
