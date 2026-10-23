# Карта документации Jarvis

[Русский](#русский) | [English](#english)

## Русский

На DE выпущено [движение Mini App по умолчанию](updates/2026-10-23-mini-app-auto-motion.md) без кнопки паузы. GitHub, оба VPS source и Windows main синхронизированы в отдельной рабочей папке; активная работа HH CAPTCHA в основной папке сохранена.

На DE выпущено [исправление движения](updates/2026-10-23-mini-app-motion-fix.md): возврат и touch-hover больше не удерживают паузу, «Продолжить» работает при reduced motion; настройки скорости/сброса удалены. Исходники Windows и обоих VPS синхронизированы.

23 октября выпущен [орбитальный Mini App и единый дизайн всех внутренних экранов](updates/2026-10-23-mini-app-orbital-release.md). GitHub, Windows и оба VPS синхронизированы; новый DE server healthy. Живое принятие на телефоне остаётся.

Статус на 23 октября 2026 года по записям выпусков. Новую сверку окружения
проводи по [руководству по выпуску](release-workflow.md).
Результат переноса истории и проверки сохранности правил:
[уплотнение документации](updates/2026-10-23-documentation-consolidation.md).

### Текущее состояние

| Направление | Что подтверждено | Что ещё проверить |
| --- | --- | --- |
| HH: письма и история | [Автоматический выбор модели](updates/2026-10-23-jobs-automatic-model-release.md): проверенные бесплатные модели, затем общий платный резерв; ручная настройка удалена. [Полная история обновляется каждый час](updates/2026-10-22-hh-history-hourly-release.md) у всех подключённых пользователей с действующим доступом, независимо от поиска вакансий; архивные и неподтверждённые приглашения отмечаются отдельно | Реальные нажатия и отправка нового отклика с подтверждением |
| HH: подключение и резюме | Личные профили по UUID, [вход по временной ссылке](updates/2026-10-21-hh-login-touch-release.md), [пустые фильтры и ввод фраз списком](updates/2026-10-21-empty-job-filters.md), [выбор резюме в боте и автоподнятие по умолчанию](updates/2026-10-22-hh-resume-bot-defaults-release.md). Явный off и остановка unknown сохраняются | Вход участника, клавиатура iPhone, выбор резюме и первое успешное поднятие; первый worker tick дал `not_due` |
| HH: CAPTCHA | [Ответ на фото](updates/2026-10-16-hh-telegram-captcha.md) принят живой проверкой. Отдельный OCR opt-in допускает до трёх попыток; unknown останавливает автоматику. [Ответ OCR прошёл HH](updates/2026-10-18-hh-ocr-live-acceptance.md) после отдельного одобрения | Полностью автономный цикл; точная причина прежнего [403](updates/2026-10-18-hh-captcha-403-investigation.md) не установлена |
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

[Mini App motion is enabled by default](updates/2026-10-23-mini-app-auto-motion.md) on DE without a pause button. GitHub, both VPS sources and Windows main match in the separate worktree; active HH CAPTCHA work in the primary checkout is preserved.

The [motion repair](updates/2026-10-23-mini-app-motion-fix.md) is deployed to DE: return navigation and touch hover no longer retain pause, Resume works under reduced motion, and speed/reset settings are removed. Windows and both VPS sources match.

October 23: the [orbital Mini App and shared design of all interior screens](updates/2026-10-23-mini-app-orbital-release.md) are deployed. GitHub, Windows and both VPS sources match; the new DE server is healthy. Physical phone acceptance remains.

Status as of October 23, 2026, based on release records. Use the
[release guide](release-workflow.md) for a fresh environment comparison.
For history preservation and rule-retention checks, see the
[documentation consolidation record](updates/2026-10-23-documentation-consolidation.md).

### Current status

| Area | Verified result | Outstanding checks |
| --- | --- | --- |
| HH: letters and history | [Automatic model selection](updates/2026-10-23-jobs-automatic-model-release.md): verified free models, then global paid fallback; manual selection is removed. [Full history refreshes hourly](updates/2026-10-22-hh-history-hourly-release.md) for all connected users with current access, independently of vacancy search; archived and unconfirmed invitations have separate labels | Real button taps and a newly confirmed application submission |
| HH: connection and resumes | UUID-scoped profiles, [temporary sign-in links](updates/2026-10-21-hh-login-touch-release.md), [empty filters and multiline phrases](updates/2026-10-21-empty-job-filters.md), [bot resume selection and raising enabled by default](updates/2026-10-22-hh-resume-bot-defaults-release.md). Explicit off and unknown stops remain | Member sign-in, iPhone keyboard, resume selection and the first successful raise; the first worker tick returned `not_due` |
| HH: CAPTCHA | [Photo replies](updates/2026-10-16-hh-telegram-captcha.md) passed live acceptance. Separate OCR opt-in permits up to three attempts; unknown stops automation. [An OCR answer passed HH](updates/2026-10-18-hh-ocr-live-acceptance.md) after separate approval | Fully autonomous operation; the exact cause of the earlier [403](updates/2026-10-18-hh-captcha-403-investigation.md) remains unknown |
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
