# Карта документации Jarvis

[Русский](#русский) | [English](#english)

## Русский

27 октября подготовлен [выпуск кнопок и памяти Mini App](updates/2026-10-27-mini-app-buttons-release.md):
877 server tests, 24 PostgreSQL-сценария, девять браузерных наборов и независимая
ревизия всей ветки. Прежние два падающих теста и найденные ревизией гонки исправлены.
Установка и проверка DE/NL выполняются в рамках порученного выпуска.

27 октября локально готовы [операции памяти Mini App](updates/2026-10-27-mini-app-memory-development.md):
добавление, исправление и удаление с подтверждением, квитанцией и безопасной отменой
исходного запроса. Server 877/877, PostgreSQL 22/22, восемь браузерных наборов;
независимая security-ревизия выполнена. Нужна миграция 051; выпуск не выполнен.
Этапы 5–6 и ограничения дополнительных fixtures описаны в записи результата.

На DE работает [прямая выдача подписок Happ](updates/2026-10-26-subscription-generated-links-release.md)
без Cloudflare, включая новые ссылки и кнопку импорта для всех профилей.
Все пять активных подписок текущего владельца формируют по четыре подключения;
токены и привязки при итоговой проверке сохранены. Владелец подтвердил результат
после выпуска. Server healthy; 863 проверки прошли локально и в Linux-образе
(по две с БД пропущены), семь сценариев Caddy, DNS и строгий TLS проверены.
Остальные устройства и длительная работа ещё не проверены; первопричина
сбоя старого маршрута не установлена. Уже сохранённые в Happ адреса не меняются
автоматически — общий генератор выдаёт новый origin для любого профиля.

Локально готов [этап 4 Mini App](updates/2026-10-26-mini-app-lists-development.md):
обновление и догрузка личных списков, раскрытие карточек и предыдущие сообщения
отдельной истории. Server 874/874; новая PostgreSQL-проверка 7/7 с полным
pipeline из 52 файлов по миграцию 050. Выпуск и независимая ревизия этого этапа не выполнены.

Локально готов [этап 3 Mini App](updates/2026-10-26-mini-app-handoffs-development.md):
переходы сразу к меню нужного раздела бота, пояснения возможностей и безопасная
ссылка Operations для владельца. Server 874/874, Mini App PostgreSQL 13/13;
на VPS изменения ещё не установлены.

Локально подготовлены [исправления кнопок Mini App, этапы 1–2](updates/2026-10-26-mini-app-button-reliability-development.md):
восстановление после ошибки диалога, гонки отмены HH, обновление списка доступа
и проверка прав на сохранённый ответ. Server 866/866, Mini App PostgreSQL 12/12.
Миграция 049 и код ещё не установлены на VPS; остальные этапы остаются в плане.

На DE выпущены [три прохода HH](updates/2026-10-25-hh-three-lane-release.md): свежие
вакансии раз в пять минут, накопленный сбор и ежедневная сверка всей выбранной
глубины истории. Фильтры и Telegram-интерфейс прежние. Server healthy, collector
running, миграции 047/048 применены; оба VPS source синхронизированы. Первые две
свежие карточки доставлены, прежние 7345 сохранены. Локальные тесты 862/39/75 и
изолированные Linux-проверки прошли. Полный свежий и первый суточный циклы,
а также длительная прибавка нагрузки ещё не подтверждены.

На DE выпущены [общие инструкции моделей, Tavily MCP и правка сопроводительных](updates/2026-10-24-shared-instructions-and-search-release.md).
Server и HH-браузер healthy, миграция 046 применена. Поиск включён: установленный
сервер получил пять источников за 1,1 секунды. В новых образах прошли 844 серверных
и 103 браузерных теста; ещё 16 проверок прошли на изолированной PostgreSQL,
включая два сценария, пропущенных без БД. Исходники обоих VPS обновлены,
Desktop совпадает с принятой версией. Реальные HH, письма на моделях и нажатия
Telegram остаются для приёмки; отключение PAYGO не подтверждено.

На DE выпущено [обновление inline-сообщений Telegram](updates/2026-10-24-telegram-inline-edit-release.md):
кнопки меняют исходное сообщение, длинный текст перелистывается в нём, возврат
доступен на каждой странице. Server healthy; 811 серверных тестов и 75 проверок
в новом образе прошли. Исходники обоих VPS обновлены; Desktop не менялся.
Нижнее меню отправляется без принудительного постоянного показа; сворачивание
и открытие через значок Telegram, прокрутка и настоящие нажатия ещё требуют проверки.

На DE выпущен [общий ремонт HH CAPTCHA и полного сбора](updates/2026-10-24-hh-complete-collection.md):
периоды по дням МСК, возобновление старого прогресса, одинаковая проверка доступа
для owner/admin/member и уведомление о незавершённом сборе. Linux browser 103/103,
PostgreSQL/RPC 16/16. Исходники синхронизированы; первая живая проверка подтвердила
12 новых доставок участнику (83 вместо 71). Оставшийся объём собирается в фоне,
полный обход на момент этой проверки ещё не завершён.

На DE выпущено [движение Mini App по умолчанию](updates/2026-10-23-mini-app-auto-motion.md) без кнопки паузы. GitHub, оба VPS source и Windows main синхронизированы в отдельной рабочей папке; активная работа HH CAPTCHA в основной папке сохранена.

На DE выпущено [исправление движения](updates/2026-10-23-mini-app-motion-fix.md): возврат и touch-hover больше не удерживают паузу, «Продолжить» работает при reduced motion; настройки скорости/сброса удалены. Исходники Windows и обоих VPS синхронизированы.

23 октября выпущен [орбитальный Mini App и единый дизайн всех внутренних экранов](updates/2026-10-23-mini-app-orbital-release.md). GitHub, Windows и оба VPS синхронизированы; новый DE server healthy. Живое принятие на телефоне остаётся.

Статус на 24 октября 2026 года по записям выпусков. Новую сверку окружения
проводи по [руководству по выпуску](release-workflow.md).
Результат переноса истории и проверки сохранности правил:
[уплотнение документации](updates/2026-10-23-documentation-consolidation.md).

### Текущее состояние

| Направление | Что подтверждено | Что ещё проверить |
| --- | --- | --- |
| HH: письма и история | [Автоматический выбор модели](updates/2026-10-23-jobs-automatic-model-release.md): проверенные бесплатные модели, затем общий платный резерв; ручная настройка удалена. [Полная история обновляется каждый час](updates/2026-10-22-hh-history-hourly-release.md) у всех подключённых пользователей с действующим доступом, независимо от поиска вакансий; архивные и неподтверждённые приглашения отмечаются отдельно | Реальные нажатия и отправка нового отклика с подтверждением |
| HH: подключение и резюме | Личные профили по UUID, [вход по временной ссылке](updates/2026-10-21-hh-login-touch-release.md), [пустые фильтры и ввод фраз списком](updates/2026-10-21-empty-job-filters.md), [выбор резюме в боте и автоподнятие по умолчанию](updates/2026-10-22-hh-resume-bot-defaults-release.md). Явный off и остановка unknown сохраняются | Вход участника, клавиатура iPhone, выбор резюме и первое успешное поднятие; первый worker tick дал `not_due` |
| HH: CAPTCHA и сбор | [Общий ремонт 24 октября](updates/2026-10-24-hh-complete-collection.md) выпущен на DE: branded reader, календарные окна, возобновление, owner/admin/member и уведомления. Обе проверенные CAPTCHA-паузы сняты; новые карточки доставляются. OCR до трёх попыток и остановка unknown сохранены | Полная накопленная выгрузка ещё идёт; следующий CAPTCHA-цикл; точная причина прежнего [403](updates/2026-10-18-hh-captcha-403-investigation.md) не установлена |
| Desktop | Установлена 1.0.2; [надёжность запросов и проверка результата по исходному ID](updates/2026-10-20-desktop-reliability-release.md), сверка установленного кода и bundled runtime прошли | Живой чат, микрофон, paired voice и реальные команды; при приёмке прямой Windows HTTPS/WSS был недоступен |
| Telegram и Mini App | [Роли и личные разрешения](updates/2026-10-18-telegram-mini-app-release.md), [вход без внешнего SDK и удаление «Помощи»](updates/2026-10-18-mini-app-entry-help-removal.md); подпись, TTL и membership проверяются сервером | Реальные owner/admin/member сценарии, Telegram Web cookies и два аккаунта |
| Operations UI | [Орбитальная панель](updates/2026-10-22-orbital-monitoring-release.md) и [живой фон](updates/2026-10-22-living-sky-release.md) установлены; девять разделов с реальными данными проверены | FPS и нагрузка физического телефона |
| Облако, память и Life OS | Fastify/PostgreSQL, личные память и документы, production hybrid retrieval; [Life OS v2](updates/2026-09-15-jarvis-life-os-v2.md), [Telegram parity](updates/2026-09-15-telegram-life-os-parity.md), real-PostgreSQL workflow | Live multi-device, реальные внешние провайдеры и изменяющий Recovery на paired Desktop |
| Vision | [Первый slice](updates/2026-09-09-vision-implementation.md): Camo 1280×720, два экрана, явные leases, локальные analysis/memory | Развёрнутый провайдер и remote/Telegram acceptance |
| VPN и Supervisor | [Последняя VPN-сверка](updates/2026-10-08-vpn-probe-resilience.md): DE/NL активны, четыре подписки экспортируют четыре endpoints; VLESS 443/8443 прошёл в обе стороны. [Ограниченный NL Xray restart](updates/2026-09-24-vpn-supervisor-host-bound-callback-routing.md) подтверждён владельцем, postchecks прошли | Hysteria hopping DE→NL дал смешанный результат; телефонный Happ refresh/traffic. Restore выключен; external timer failures не создают Telegram incidents |
| Эксплуатация | [13 исправлений аудита](updates/2026-10-17-audit-remediation-release.md) установлены; сервер, PostgreSQL и ASR healthy по записям проверки; hopping DNAT сохранён в UFW | Reboot persistence и автоматическое ACME renewal; backup timer и реальная backup/restore-проверка отложены владельцем |
| Планы | Облако и Windows — основные части продукта | PWA, server executors, расписания и реальные account connectors |

Последние выпуски HH обновили затронутые компоненты DE server/collector/browser,
применили миграции 044/045 и синхронизировали исходники обоих VPS. SHA, версии
образов и результаты тестов смотри в записи соответствующего выпуска.
Совпадение исходников не заменяет проверку работающего компонента.

### Основные документы

| Документ | Для чего читать |
| --- | --- |
| [README](../README.md) | Назначение продукта, возможности и запуск |
| [AGENTS](../AGENTS.md) | Обязательные правила для всех агентов |
| [Выпуск](release-workflow.md) | Ветки, GitHub, оба VPS, Desktop и обновление MD |
| [Runtime](runtime-context.md) | Подсистемы, архитектура и границы доверия |
| [Проверки](verification.md) | Команды, тестовые окружения и ограничения |
| [Архитектура Telegram](telegram-button-architecture.md) и [контракт меню](telegram-menu-contract.md) | Маршрутизация, кнопки, права, подтверждения и pre-edit notice; читать оба перед правкой пути |
| [Развёртывание](../deploy/README.md) | Ubuntu, Compose и Host Agent |
| [VPN runbook](VPN_RESILIENCE_RUNBOOK.md), [Supervisor](VPN_SUPERVISOR_REPAIR_GUIDE.md), [настройка ПК](VPN_PC_SETUP.md) | Диагностика, допустимый ремонт и клиент |

<a id="записи-которые-объясняют-нынешний-статус"></a>

### История решений

[Updates](updates/) хранят результаты выпусков, [specs](superpowers/specs/) — решения,
[plans](superpowers/plans/) — исполнение. Поздняя подтверждённая запись имеет
приоритет над прежним планом. Исходный контекст HH:
[договорённости](superpowers/specs/2026-10-14-job-search-initial-agreements.md),
[спецификация](superpowers/specs/2026-10-15-job-search-design.md),
[план](superpowers/plans/2026-10-15-job-search.md).

[Карта до уплотнения](history/2026-10-23-documentation-map.md) сохраняет подробную
хронику, результаты и ссылки. Ещё более ранние
[карта](history/2026-10-08-documentation-map.md) и
[AGENTS](history/2026-10-08-agent-context.md) также сохранены.
Архивы не заменяют действующие правила и новую проверку окружения.

## English

The [October 27 Mini App buttons and memory release](updates/2026-10-27-mini-app-buttons-release.md)
is prepared: 877 server tests, 24 PostgreSQL scenarios, nine browser suites and
independent full-branch review. Both previously failing tests and the reviewed
races were fixed. DE/NL installation and verification are in progress under the authorized release.

On October 27, [Mini App memory actions](updates/2026-10-27-mini-app-memory-development.md)
are ready locally: add, correct and forget with confirmation, a receipt and safe
cancellation of the original request. Server 877/877, PostgreSQL 22/22 and eight
browser suites passed; independent security review completed. Migration 051 is
required; unpublished. Stages 5–6 and additional fixture limitations remain documented.

[Direct Happ subscription delivery](updates/2026-10-26-subscription-generated-links-release.md)
is enabled on DE without Cloudflare, including new links and import buttons
for every profile. All five active profiles belonging to the current owner
produce four entries each; final checks preserved tokens and bindings. The owner
confirmed the result after release. The server is healthy; 863 checks passed
locally and in the Linux image (two database checks skipped in each run), and
seven Caddy scenarios, DNS and strict TLS were verified. Other devices and
long-term operation remain unverified; the original route's root cause is
unknown. URLs already saved in Happ do not change automatically; the shared
generator supplies the new origin for any profile.

[Mini App stage 4](updates/2026-10-26-mini-app-lists-development.md) is ready
locally: refreshing and loading personal lists, expanding cards and loading
older messages in the separate history. Server 874/874; new PostgreSQL suite
7/7 with all 52 migration files through 050. Release and independent stage review
have not been performed.

[Mini App stage 3](updates/2026-10-26-mini-app-handoffs-development.md) is ready
locally: direct navigation to each bot section menu, capability descriptions
and a safe owner-only Operations link. Server 874/874, Mini App PostgreSQL 13/13;
these changes are not installed on either VPS.

[Mini App button fixes, stages 1–2](updates/2026-10-26-mini-app-button-reliability-development.md)
are ready locally: chat failure recovery, HH cancellation races, access-list
refresh ordering and access checks on saved answers. Server 866/866, Mini App
PostgreSQL 12/12. Migration 049 and code are not installed on either VPS;
the remaining stages stay in the plan.

[Three HH collection lanes](updates/2026-10-25-hh-three-lane-release.md) are deployed
on DE: five-minute fresh checks, historical collection and daily full-range
reconciliation. Filters and the Telegram interface are unchanged. Server is
healthy, collector running, migrations 047/048 applied and both VPS sources
synchronized. Two fresh cards were delivered and the original 7345 retained.
Local 862/39/75 tests and isolated Linux checks passed. Full fresh and first daily
cycles and sustained additional resource use remain unverified.

[Shared model instructions, Tavily MCP and cover-letter editing](updates/2026-10-24-shared-instructions-and-search-release.md)
are deployed on DE. Server and HH browser are healthy; migration 046 is applied.
Search is enabled: the installed server returned five sources in 1.1 seconds.
The new images passed 844 server and 103 browser tests; another 16 checks passed
on isolated PostgreSQL, including the two scenarios skipped without a database.
Both VPS source checkouts are updated; Desktop matches the accepted version.
Actual HH, model-generated letters and Telegram taps remain for acceptance;
disabled PAYGO has not been confirmed.

[In-place Telegram inline updates](updates/2026-10-24-telegram-inline-edit-release.md)
are deployed on DE: buttons edit the original message, long text pages within
it, and return controls remain on every page. The server is healthy; 811 server
tests and 75 checks in the new image passed. Both VPS sources are updated;
Desktop did not change.
The bottom menu no longer requests persistent display; hiding and reopening it
with Telegram's icon, scrolling and real taps still need live verification.

The [shared HH CAPTCHA and complete collection repair](updates/2026-10-24-hh-complete-collection.md)
is deployed to DE: Moscow calendar windows, legacy progress migration, consistent
owner/admin/member access checks and durable incomplete-run notices. Linux browser
103/103 and PostgreSQL/RPC 16/16 passed. Sources match; the first live check confirmed
12 new member deliveries (83 instead of 71). Remaining collection continues in the
background; full traversal was still pending at that check.

[Mini App motion is enabled by default](updates/2026-10-23-mini-app-auto-motion.md) on DE without a pause button. GitHub, both VPS sources and Windows main match in the separate worktree; active HH CAPTCHA work in the primary checkout is preserved.

The [motion repair](updates/2026-10-23-mini-app-motion-fix.md) is deployed to DE: return navigation and touch hover no longer retain pause, Resume works under reduced motion, and speed/reset settings are removed. Windows and both VPS sources match.

October 23: the [orbital Mini App and shared design of all interior screens](updates/2026-10-23-mini-app-orbital-release.md) are deployed. GitHub, Windows and both VPS sources match; the new DE server is healthy. Physical phone acceptance remains.

Status as of October 24, 2026, based on release records. Use the
[release guide](release-workflow.md) for a fresh environment comparison.
For history preservation and rule-retention checks, see the
[documentation consolidation record](updates/2026-10-23-documentation-consolidation.md).

### Current status

| Area | Verified result | Outstanding checks |
| --- | --- | --- |
| HH: letters and history | [Automatic model selection](updates/2026-10-23-jobs-automatic-model-release.md): verified free models, then global paid fallback; manual selection is removed. [Full history refreshes hourly](updates/2026-10-22-hh-history-hourly-release.md) for all connected users with current access, independently of vacancy search; archived and unconfirmed invitations have separate labels | Real button taps and a newly confirmed application submission |
| HH: connection and resumes | UUID-scoped profiles, [temporary sign-in links](updates/2026-10-21-hh-login-touch-release.md), [empty filters and multiline phrases](updates/2026-10-21-empty-job-filters.md), [bot resume selection and raising enabled by default](updates/2026-10-22-hh-resume-bot-defaults-release.md). Explicit off and unknown stops remain | Member sign-in, iPhone keyboard, resume selection and the first successful raise; the first worker tick returned `not_due` |
| HH: CAPTCHA and collection | The [October 24 shared repair](updates/2026-10-24-hh-complete-collection.md) is deployed to DE: branded reader, calendar windows, resumption, owner/admin/member access and notices. Both checked CAPTCHA pauses cleared; new cards are being delivered. Three OCR attempts and unknown stops remain | Full backlog collection is ongoing; next CAPTCHA cycle; the exact cause of the earlier [403](updates/2026-10-18-hh-captcha-403-investigation.md) remains unknown |
| Desktop | Version 1.0.2 installed; [bounded requests and result checks by original ID](updates/2026-10-20-desktop-reliability-release.md), installed-source and bundled-runtime comparisons passed | Live chat, microphone, paired voice and real commands; direct Windows HTTPS/WSS was unavailable during acceptance |
| Telegram and Mini App | [Roles and personal permissions](updates/2026-10-18-telegram-mini-app-release.md), [entry without the external SDK and Help removal](updates/2026-10-18-mini-app-entry-help-removal.md); server validation of signatures, TTL and membership | Actual owner/admin/member flows, Telegram Web cookies and two accounts |
| Operations UI | [Orbital monitoring](updates/2026-10-22-orbital-monitoring-release.md) and [living sky](updates/2026-10-22-living-sky-release.md) installed; nine sections checked with real data | Physical-phone frame rate and load |
| Cloud, memory and Life OS | Fastify/PostgreSQL, personal memory/documents, production hybrid retrieval; [Life OS v2](updates/2026-09-15-jarvis-life-os-v2.md), [Telegram parity](updates/2026-09-15-telegram-life-os-parity.md), real-PostgreSQL workflow | Live multi-device, real external providers and changing Recovery on paired Desktop |
| Vision | [First slice](updates/2026-09-09-vision-implementation.md): Camo 1280×720, two displays, explicit leases and local analysis/memory | Deployed provider and remote/Telegram acceptance |
| VPN and Supervisor | [Latest VPN comparison](updates/2026-10-08-vpn-probe-resilience.md): DE/NL active, four subscriptions exporting four endpoints; VLESS 443/8443 passed both ways. [Limited NL Xray restart](updates/2026-09-24-vpn-supervisor-host-bound-callback-routing.md) owner-confirmed, postchecks passed | Mixed Hysteria hopping DE→NL results; phone Happ refresh/traffic. Restore disabled; external timer failures do not create Telegram incidents |
| Operations | [13 audit fixes](updates/2026-10-17-audit-remediation-release.md) installed; server, PostgreSQL and ASR healthy in recorded checks; hopping DNAT persisted in UFW | Reboot persistence and automatic ACME renewal; backup timer and real backup/restore acceptance remain deferred by the owner |
| Plans | Cloud and Windows are the main product components | PWA, server executors, schedules and real account connectors |

The latest HH releases updated the affected DE server/collector/browser components,
applied migrations 044/045 and synchronized both VPS source checkouts. SHAs,
image versions and test results belong in the relevant release record.
Matching sources do not establish that a running component is up to date.

### Main documents

| Document | Purpose |
| --- | --- |
| [README](../README.md) | Product purpose, capabilities and startup |
| [AGENTS](../AGENTS.md) | Mandatory rules for all agents |
| [Release guide](release-workflow.md) | Branches, GitHub, both VPS nodes, Desktop and Markdown updates |
| [Runtime](runtime-context.md) | Subsystems, architecture and trust boundaries |
| [Verification](verification.md) | Commands, test environments and limits |
| [Telegram architecture](telegram-button-architecture.md) and [menu contract](telegram-menu-contract.md) | Routing, buttons, permissions, confirmations and pre-edit notice; read both before editing a path |
| [Deployment](../deploy/README.md) | Ubuntu, Compose and Host Agent |
| [VPN runbook](VPN_RESILIENCE_RUNBOOK.md), [Supervisor](VPN_SUPERVISOR_REPAIR_GUIDE.md), [PC setup](VPN_PC_SETUP.md) | Diagnosis, permitted repairs and client setup |

<a id="records-explaining-the-current-status"></a>

### Decision history

[Updates](updates/) preserve release results, [specs](superpowers/specs/) preserve
decisions, and [plans](superpowers/plans/) preserve execution. Later verified
records take precedence over earlier plans. Original HH context:
[agreements](superpowers/specs/2026-10-14-job-search-initial-agreements.md),
[specification](superpowers/specs/2026-10-15-job-search-design.md),
[plan](superpowers/plans/2026-10-15-job-search.md).

The [map before consolidation](history/2026-10-23-documentation-map.md) preserves
detailed chronology, results and links. The older
[map](history/2026-10-08-documentation-map.md) and
[AGENTS](history/2026-10-08-agent-context.md) are also retained.
Archives do not replace current rules or a fresh environment check.
