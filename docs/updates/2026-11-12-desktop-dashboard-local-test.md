# Тестовый Desktop с интерфейсом дашборда / Desktop dashboard test build

## Русский

12 ноября подготовлена локальная тестовая версия `1.0.3-dashboard.1`.
Изменения находятся в `codex/desktop-dashboard`; в GitHub и на VPS они
не опубликованы. Установленный Desktop `1.0.2` не заменялся.

### Что изменилось

Desktop получил графитовую оболочку по согласованному макету: навигацию слева,
рабочую область по центру, планеты справа и анимированный звёздный фон.
Убраны декоративные подписи про синхронизацию, личное пространство и контроль
микрофона. Состояние активного захвата, ошибки и подтверждения остаются видимыми.
Движение можно приостановить; системное уменьшение движения и отсутствие WebGL
сохраняют доступ к разделам.

| Раздел | Реализация и проверенная граница |
| --- | --- |
| Главная | Планеты, фон, пауза анимации и режим уменьшенного движения |
| Ассистент | Прежний чат, история этого устройства, отдельная история Mini App; восстановление ответа сохраняет кнопки подтверждения без дублирования сообщения |
| Life OS | Существующие миссии, проекты, Timeline, люди, настройки и диалоги; графитовая тема и возврат фокуса к открывшей кнопке |
| Память | Список, фильтр, добавление, исправление и удаление через общие сервисы; предпросмотр и подтверждение |
| Документы | Список, загрузка PDF/TXT/DOCX с прежними лимитами и удаление; запрос с неизвестным результатом проверяется по исходному ID |
| Устройства | Список, создание кода, отмена подключения и отзыв устройства после проверки актуального состояния |
| Поиск работы | Существующие подключение HH, резюме, автоподнятие и личное разрешение на автопоиск; вход HH открывается по защищённой ссылке во внешнем браузере |
| Панель управления | Переход в Operations с отдельным входом владельца; роли и пользователи сохраняют существующий путь Mini App/Telegram |
| Настройки | Пауза анимации, VPN-переход и три действующих параметра микрофона; сохранение доступно при выключенном голосе и само не запускает захват |

Память, документы, устройства, HH и Life OS используют серверные данные того же
пользователя. Истории Desktop и Mini App сохраняют свои каналы и полномочия.
Новый закрытый device API проверяет активный токен и актуальные права;
общие операции памяти и личных данных повторяют проверку внутри транзакции.
Гостевые HH-маршруты и создание сессии Mini App через Desktop не разрешены.

Незавершённые изменения сохраняют UUID в отдельном локальном журнале, без
содержимого документов или сообщений. Перезапуск не разрешает заменять ID.
Для двух операций с резюме сервер отмечает отсутствие начала только после
проверки прав и отсутствия записи операции. Остальные неопределённые результаты
остаются на проверке. Ссылки Telegram берутся из авторизованного ответа сервера.

Общие клиентские модули включаются в EXE из одного каталога Mini App через
`scripts/desktopWorkspaceModules.json`. Проверка установленной версии учитывает
эти исходники, поэтому изменение общего модуля также требует обновления Desktop.
Личные инструкции и роли AI Office исключены из пакета.

### Проверки

- Основной набор: runner 5/5, Desktop cloud 116/116, server subset 806/806.
- Полный server unit: 960 passed, 2 DB-only skipped. Новые Fastify/device
  проверки входят в этот набор; они используют тестовые сервисы и проверяют
  права, сохранение исходного ID и ограничение загрузки до чтения тела.
- Браузер: 19 сценариев, включая все пункты меню, подтверждение и отмену,
  загрузку слишком большого файла, HH revisions/UUID, потерянный ответ,
  отозванный доступ, запоздалый ответ старого раздела и смену устройства.
  Окна 1440×900 и 760×560, без горизонтального скролла и ошибок браузера.
- Life OS: 13/13 проверок отмены; полный браузерный набор с Timeline,
  проектами, людьми, настройками, ошибками и отображением МСК прошёл.
- Mini App пересобран; прежние клиентские fixtures входа, навигации,
  подтверждений, конфликтов и восстановления исходного ID прошли.
- Восстановление Desktop проверено на обеих ширинах, включая ответ, уже
  загруженный из истории, с сохранением подтверждения и без нового POST.
- Настоящий Electron исполняет main, preload, IPC и renderer с изолированным
  профилем и подменённым сетевым адаптером. Проверены привязка, предпросмотр
  и сохранение памяти, очистка журнала и запрет гостевого маршрута. Голос
  и зрение остались выключены. Проверено сохранение параметров микрофона
  через настоящий IPC. Это не проверка живой серверной синхронизации.
- Проверка release inventory: 18 tests, 1 Windows symlink skip.
- Отдельный security-агент проверил авторизацию, загрузку, внешние ссылки,
  журнал и настройки. Найденные дефекты ссылок и восстановления настроек
  исправлены и повторно проверены. Независимый UX-прогон был частичным:
  после лимита агента остальные сценарии проверил главный агент.

### Серверы и оставшиеся проверки

При read-only диагностике 12 ноября исходники GitHub/Windows/DE/NL совпадали
с `496f78c`. DE server/collector использовали согласованный код `4836021`;
server и PostgreSQL были healthy, live/ready и публичный ready отвечали 200.
На обоих VPS не было упавших systemd units. За проверенные сутки обнаружены
сетевые ошибки Cloudflare с восстановлением соединений, одно предупреждение
Telegram и один автоматический перезапуск HH-браузера 11 ноября в 19:52 МСК.
Он вернулся в healthy; признаков heap OOM в этом окне не найдено. Точная причина
перехода браузера в unhealthy не установлена. Производственные службы не менялись.

Тестовый установщик: `dist/Jarvis-Desktop-1.0.3-dashboard.1-Setup.exe`.
Сборка использует Node `24.14.1` для bundled wake-word runtime и сохраняет
`npmRebuild: false`. Установщик не запускался поверх рабочего приложения.
Пакет сверён с кодом `f1c4103`: 168 файлов, отсутствующих и изменённых нет;
native Electron и bundled Node совпадают, Vosk загружается под packaged Node.
Размер установщика — 197 394 473 байта. Локальный
`dist/desktop-dashboard-test.json` сохраняет SHA-256 и commit кода сборки.

Для настоящего доступа к новым разделам требуется согласованный выпуск
серверной части. Старый production API пока не имеет новых маршрутов;
Desktop показывает недоступность раздела. PostgreSQL acceptance для новых
операций не выполнялась: отдельная тестовая БД недоступна. Живые Telegram/HH,
включение микрофона/камеры и установка EXE также остаются для отдельной приёмки.
Нельзя считать перенос полностью принятым по локальным fixtures.

## English

Local test version `1.0.3-dashboard.1` was prepared on November 12 in
`codex/desktop-dashboard`. Nothing was published to GitHub or deployed to VPSs;
installed Desktop `1.0.2` remains unchanged.

The approved graphite shell includes left navigation, a large workspace,
animated planets and a starfield. Decorative sync/privacy copy was removed.
Active capture, actionable errors and confirmations remain visible. Motion
pause, reduced motion and a WebGL fallback preserve navigation.

Sections cover Home, Assistant, existing Life OS, Memory, Documents, Devices,
Job Search, Operations and Settings. Shared Mini App action modules retain
previews, revision checks and original-operation recovery. Operations and
Telegram handoffs keep their existing sign-in and confirmation boundaries;
user/role administration remains on that existing path. Settings expose three
real microphone options while capture is off; saving never activates capture.

Personal data uses the same user's server records. Desktop and Mini App chat
histories remain separate, with Mini App history readable in Desktop. The
closed device API rechecks active credentials and current grants; personal and
memory actions also check inside their transactions. Guest HH and Mini App
session routes are excluded. Pending UUIDs survive restarts without storing
message/document contents. Telegram links must come from authenticated server
responses. Shared module changes are included in Desktop release comparisons.
Personal AI Office instructions and roles are excluded from the package.

Checks passed: core runner 5/5, Desktop cloud 116/116, server subset 806/806;
full server unit 960 passed with 2 DB-only skips; 19 browser scenarios at
1440×900 and 760×560; 13/13 Life OS cancellation tests, the full Life OS browser
suite and Desktop recovery at both sizes. These cover previews/cancellation,
oversized files, job revisions and UUIDs, unknown outcomes, revoked access,
stale responses, device-scope clearing, keyboard and no horizontal overflow.
Release inventory tests: 18 tests, 1 Windows symlink skip.
Mini App was rebuilt and its existing client fixtures passed, including login,
navigation, confirmations, conflicts and original-ID recovery.

A real Electron process runs main/preload/IPC/renderer using an isolated profile
and a fixture network adapter. Pairing, memory preview/commit, journal settlement
and rejected guest routes pass; capture settings save through the real IPC,
while voice and vision stay off. Packaged code is also
checked this way. This does not establish live synchronization. A separate
security reviewer verified the scoped boundaries and fixes. Independent UX
coverage was partial; the primary agent completed the remaining cases after
the tester reached its limit.

Read-only diagnostics found matching GitHub/Windows/DE/NL source `496f78c` and
the accepted DE server/collector code `4836021`. Server and PostgreSQL were
healthy; local live/ready and public ready returned 200. No failed systemd units
were found on either VPS. The checked day included recovered Cloudflare network
errors, one Telegram warning and one HH-browser restart on November 11 at
19:52 Moscow time. The browser recovered; no heap OOM signature was found.
The exact unhealthy trigger remains unknown. Production services were unchanged.

Installer: `dist/Jarvis-Desktop-1.0.3-dashboard.1-Setup.exe`, using bundled Node
24.14.1 with `npmRebuild: false`. It was not installed over the working app.
The package matches code `f1c4103`: 168 checked files, none missing or changed;
native Electron and bundled Node match, and packaged Node loads Vosk. Installer
size is 197,394,473 bytes. The local `dist/desktop-dashboard-test.json` records
its SHA-256 and code commit.
New sections require a separately authorized server release; the old production
API currently returns an unavailable state. New PostgreSQL acceptance, live
Telegram/HH, microphone/camera activation and installation remain unverified.
Local fixtures do not establish full acceptance.
