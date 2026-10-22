# Карта документации Jarvis

[Русский](#русский) | [English](#english)

## Русский

Описание проекта и текущие записи переведены на два языка:
[обновление документации от 16 октября](updates/2026-10-16-bilingual-project-docs.md).
Изменения опубликованы в GitHub и получены обоими VPS; сверка исходников,
Desktop, сервера и Host Agent прошла. Отличия сохранённого образа сборщика
и наблюдение перезапуска браузера перечислены в записи обновления.

Текущий статус ниже опирается на записи о проверках. Правила для агентов
находятся в [AGENTS.md](../AGENTS.md), порядок публикации в
[release-workflow.md](release-workflow.md). Планы описывают намерения;
работающую версию подтверждают код, проверки и фактическое развёртывание.

### Текущее состояние

22 октября выпущены [выбор резюме кнопками бота и автоподнятие по умолчанию](updates/2026-10-22-hh-resume-bot-defaults-release.md).
Явный off и unknown сохраняются. Проверены 787 server tests, 32 PostgreSQL
сценария, включая Telegram owner/member и гонку отзыва права. На DE обновлены
server/collector, применены 042/043; оба VPS синхронизированы. Первая фоновая
проверка вернула `not_due`, поднятие не подтверждено; автоматика включена.

22 октября выпущено [управление резюме HH](updates/2026-10-22-hh-resume-management-release.md):
постоянный выбор основного, обновление списка и отдельный выключатель бесплатного
автоподнятия. Последующий выпуск включил его по умолчанию, как описано выше.
На DE обновлены server, browser и collector; исходники обоих VPS
синхронизированы. Реальный выбор и первое поднятие остаются клиентской приёмкой.

21 октября выпущены [пустые фильтры поиска и ввод фраз списком](updates/2026-10-21-empty-job-filters.md).
Проверены ПК Edge, 785 server tests, 66 Telegram и 10 PostgreSQL-сценариев.
Server и collector DE обновлены, оба VPS синхронизированы, фильтры Сени очищены.

Исправлена [незагружающаяся картинка капчи при входе HH](updates/2026-10-21-hh-login-captcha-repair.md).
В отдельном браузере DE получение картинки на русском и английском прошло;
настоящий вход участника по SMS ещё не подтверждён. Статус выпуска — в записи.

21 октября [выпущены исправление входа HH, личная доставка ссылки
и управление с телефона](updates/2026-10-21-hh-login-touch-release.md).
Server, browser и сборщик DE обновлены; исходники обоих VPS синхронизированы.
Linux: 783 server, 79 browser, 42 миграции и 14 PostgreSQL-проверок прошли.
Настоящий вход участника и клавиатура iPhone ещё требуют проверки.

21 октября [восстановлен сборщик поиска работы на DE](updates/2026-10-21-job-collector-access-repair.md):
добавлена недостающая настройка владельца, поиск продолжил сохранённый прогресс.
Поддержка отдельных HH-профилей, ролей и персонального `jobs` уже существует.
Постоянное исправление конфигурации и защита очереди опубликованы в `main`;
оба VPS синхронизированы, server и сборщик DE обновлены. Новый образ прошёл
781 unit и 3 PostgreSQL-проверки; публичный HTTPS smoke прошёл.

Установлена [орбитальная панель мониторинга](updates/2026-10-22-orbital-monitoring-release.md):
ядро, шесть планет и единая тёмная рабочая область для существующих девяти разделов.
Только поиск в шапке, пять иконок снизу, движущиеся планеты и выезжающий сайдбар.
Выбранная сцена получила узкий Млечный Путь, разнесённые орбиты, индивидуальные
скорости, редкие фоновые события и безопасное кадрирование. Выбранный сайдбар B
реализован: прозрачный список с фильтрами и управлением внутри строки. Unit 42/42, build, WebGL и browser
fixtures на 1440/662/390/320 px прошли.
DE server обновлён; оба VPS синхронизированы. Linux 786/786, public smoke и UI assets прошли.
Вход и девять разделов с реальными данными проверены; FPS физического телефона остаётся для клиентской проверки.

Установлен [живой фон](updates/2026-10-22-living-sky-release.md):
параллакс Млечного Пути и трёх слоёв звёзд, мерцание, общая пауза.
Источник NASA/Gaia заменяет прежнюю текстуру: локальные варианты 4K/8K без апскейла.
Unit 46/46, build, browser и CSP прошли. Образ прошёл 787 Linux-проверок,
11 публичных файлов совпали; DE server и оба VPS source checkout обновлены.

Выпущены [надёжность Desktop и единые проверки](updates/2026-10-20-desktop-reliability-release.md):
ограниченные HTTP-запросы, сохранение ID до отправки, ручная проверка результата
без повтора действия, актуальные подсказки и `test:core`. Прошли 885 проверок
и браузерные fixtures на широком/минимальном окне. Server на DE обновлён,
Desktop пересобран и установлен, исходники обоих VPS синхронизированы.
Linux 778/778 и отдельная PostgreSQL-приёмка прошли. Прямой HTTPS/WSS из Windows
недоступен: установленный Desktop paired/offline, живой чат ещё не подтверждён.

[Выпущено единое время МСК UTC+3](updates/2026-10-19-moscow-time-release.md):
ввод напоминаний без пояса и все пользовательские часы используют Москву.
Server на DE обновлён, Desktop 1.0.2 пересобран и установлен. Проверены
760/760 server tests, PostgreSQL acceptance 1/1 и браузеры в трёх зонах.
Старые напоминания не сдвигаются; телефон и доставка требуют приёмки.

На DE включена [очередь бесплатных моделей OpenRouter](updates/2026-10-19-free-first-routing-release.md):
семь согласованных free, затем два DeepSeek по оценке стоимости. Цены и квота
обновляются при использовании раз в 15 минут; новые ID не добавляются.
Linux server tests 756/756; живой Nemotron Super ответил за $0, отдельная
generation-квитанция подтвердила стоимость. Исходники обоих VPS синхронизированы.

[Telegram Mini App выпущен на DE](updates/2026-10-18-telegram-mini-app-release.md):
3D-ядро, Telegram ID, роли и личные разрешения, админка, аудит, личный диалог
и чтение своих разделов. [Последующее исправление](updates/2026-10-18-mini-app-entry-help-removal.md)
убрало «Помощь» и зависимость входа от внешнего SDK. Linux server tests при этом выпуске:
742/742; первый выпуск прошёл 8 PostgreSQL acceptance и все 40 migrations.
Кнопка запуска настроена, исходники обоих VPS синхронизированы. Настоящий вход
после исправления, Telegram Web cookies, телефонный FPS и два аккаунта ещё требуют
приёмки; второй HH требует собственного подключения.
[Выжимка чата для следующего агента](updates/2026-10-18-mini-app-agent-handoff.md)
содержит решения, проверенного владельца, версии и следующий шаг.

19 октября выпущен [личный вход в HH для участников](updates/2026-10-19-member-hh-login-release.md):
подключение доступно из Mini App по временной HTTPS-ссылке с телефона или ПК,
профиль HH отдельный для каждого пользователя. Код сервера и browser развернут
на DE; миграция 039 применена, исходники обоих VPS синхронизированы.
Server/browser health и публичный HTTPS smoke прошли. Реальный вход в HH и
подтверждение резюме участником пока ждут проверки. Локальная разработка и её
результаты сохранены в [исходной записи](updates/2026-10-19-job-search-member-access-development.md).

[Исследуется новый 403 после корректного OCR](updates/2026-10-18-hh-captcha-403-investigation.md):
native-запрос и browser/API cookies проверены без отправки ответов. Точная причина
старого 403 пока неизвестна; ограниченный классификатор ответа HH установлен на DE,
Linux browser — 71/71. Одобренная отправка в 18:37 МСК снова дала 403/unknown;
CSRF совпал с cookie, пояснение недоступно классификатору. Read-only поиск API
из Windows и DE тоже дал 403 от ddos-guard. Вероятен сетевой отказ до проверки
капчи; точная причина не установлена. `HH_APP_TOKEN` не настроен, авторизованный
доступ к API не проверялся.

[Живой ответ OCR прошёл HH после одобрения владельца](updates/2026-10-18-hh-ocr-live-acceptance.md):
одна отправка, POST 302, проверка целевой страницы 200, `solved`; сбор возобновился.
Полностью автономный цикл этим тестом не подтверждён.

[Разбор неподтверждённой ручной отправки HH](updates/2026-10-18-hh-captcha-receipt-diagnosis.md):
найдена потеря сведений о HTTP/verifier; долговечная закрытая квитанция для обоих
путей установлена на DE, Linux browser — 66/66. Причина предыдущего unknown пока не доказана.

[Приватный журнал попыток OCR установлен на DE](updates/2026-10-18-hh-captcha-evidence.md):
картинка, ответ и закрытые результаты для разбора новых неудач. Linux browser — 62/62;
экспорт проверен, архив пока пуст. Прежние картинки и ответы восстановить нельзя.

[Лимит увеличен до трёх попыток](updates/2026-10-18-hh-captcha-three-attempts-development.md)
перед отправкой капчи владельцу: код в GitHub и на обоих VPS, browser на DE обновлён.

[Дообученный OCR HH установлен на DE](updates/2026-10-18-hh-trained-ocr-release.md):
исходное выпрямление и веса, теперь до трёх автоматических попыток перед Telegram фото,
остановка после unknown и сохранение бюджета при перезапуске. Проверены 1 709
изображений, CPU parity 73/73 и изолированные Linux browser/worker/socket.
Первая живая попытка не подтвердила доступ: автоматика остановилась, фото
отправлено владельцу. Более новый живой тест ответа OCR подтверждён по ссылке выше.

[13 подтверждённых исправлений аудита выпущены](updates/2026-10-17-audit-remediation-release.md):
server/Operations UI на DE, Host Agent на DE/NL, Desktop пересобран и установлен.
Server image 723/723, cloud 73/73, Host Agent по 149/149 на обоих Linux-узлах;
Operations tests/build и browser fixtures прошли. Код и установленные компоненты
сверены. Живые голос, камера, changing commands и owner Operations browser
остаются для клиентской проверки; внешняя Operations-проба с VPS получила 403.

На DE установлена [панель настроек поиска с кнопками](updates/2026-10-16-job-settings-panel-release.md):
отдельные параметры, готовые значения, ввод своего, списки фраз и подтверждение
изменения. Rendering и callbacks проверены; реальные нажатия в Telegram остаются
для пользовательской проверки.

На DE установлен [учёт старых и новых откликов HH](updates/2026-10-16-job-application-tracking-release.md):
единый список, отдельные статусы отправки и работодателя, первый импорт и
обновление по кнопке. Чтение active/archived проверено; первый полный импорт
и реальные нажатия в Telegram остаются для пользовательской проверки.

На DE установлены [четыре варианта сопроводительного](updates/2026-10-16-job-letter-modes-release.md):
базовое, улучшенное с AI, кастомное без AI и с AI. Факты и примеры необязательны;
оба AI-режима учитывают их при наличии. Редактор и выбор вариантов проверены
на работающем сервере; реальные нажатия в Telegram и HH-отклик ещё не проверены.

| Направление | Что подтверждено | Что ещё проверить |
| --- | --- | --- |
| Облако и память | Fastify/PostgreSQL, Telegram/Desktop text, owner-scoped memory, документы и production hybrid retrieval | Live multi-device сценарии |
| Desktop | Установлена 1.0.2; код и bundled Node соответствуют принятой версии | Живой микрофон и paired-Desktop voice |
| Telegram | Реальные owner text/voice, возврат «Миссия → Life OS»; автоматические owner/member и subscription flows | Member-client ограничения, галерея/удаление и changing actions |
| Life OS | Event Spine, Mission, Timeline, commitments, recovery и origin-bound proposals; real-PostgreSQL workflow | Реальные внешние провайдеры, изменяющий Recovery на paired Desktop |
| Vision | Camo 1280×720, два экрана, явные leases и первый memory/analysis slice локально | Развёрнутый провайдер и remote/Telegram acceptance |
| VPN | DE/NL службы активны; четыре активные подписки экспортируют четыре endpoints; VLESS 443/8443 прошёл в обе стороны | Hysteria hopping DE→NL дал смешанный результат; телефонный Happ refresh/traffic |
| VPN Supervisor | Owner-confirmed ограниченный NL Xray restart с postchecks; peer timers включены | Restore отключён; external timer failures ещё не создают Telegram incidents |
| Эксплуатация | Server, PostgreSQL и ASR healthy; hopping DNAT присутствует и сохранён в UFW на обоих узлах | Реальная проверка сохранения после reboot и автоматического ACME renewal; backups отложены владельцем |
| Дальнейшая работа | Облако и Windows являются основными частями продукта | PWA, server executors, расписания и реальные account connectors |
| Поиск работы | Личный вход участников с правом `jobs` установлен на DE; профили HH разделены | [Выпуск](updates/2026-10-19-member-hh-login-release.md); реальный вход участника и подтверждение резюме ещё не проверены |

[Обновление кнопок поиска работы](updates/2026-10-15-job-search-buttons.md)
установлено на DE: включение/выключение и постоянный пункт в нижнем меню.
Также [отключён предпросмотр HH](updates/2026-10-15-job-link-previews.md)
в новых сообщениях и обработаны 260 ранее отправленных карточек.

История CAPTCHA включает [OCR и одну автоматическую попытку](updates/2026-10-15-hh-captcha-recovery-release.md),
[диагностику](updates/2026-10-15-hh-ocr-diagnosis.md),
[исправление изображения](updates/2026-10-15-hh-ocr-preprocessing-development.md)
и [native запроса](updates/2026-10-16-hh-native-captcha-request.md).

По поручению владельца прежний HH web-доступ через Tailscale заменён
[ответом на фото в Telegram](updates/2026-10-16-hh-telegram-captcha.md).
Срок картинки — 10 минут; сама пауза поиска не имеет таймера. В новой схеме
распознаёт картинку владелец. В установленном 16 октября режиме автоматический
OCR не запускался; с 18 октября действует отдельный opt-in, описанный выше.
16 октября владелец подтвердил успешное прохождение капчи вручную.
Серверная проверка подтвердила результат ответа `solved`, снятие ручной паузы
и продолжение сбора: страница сменилась с 15 на 18, число отправленных карточек
выросло с 583 до 602. Это снимок приёмки, а не постоянные показатели поиска.
Прежние результаты мобильной страницы сохранены как история.

Позднее того же дня браузер перестал готовить следующую CAPTCHA после нехватки
памяти. [Исправление установлено на DE](updates/2026-10-16-hh-captcha-resilience-release.md):
новая картинка доставлена в Telegram, сервер подтвердил `solved`, idle coordinator
и продолжение прежнего progress. Запросы обновления сохраняются при сбоях;
health проверяет Chromium, а ошибки получают понятные сообщения.

Сверка 22 октября 2026 года: GitHub, основная Windows-папка и чистые source
checkout обоих VPS совпали на `3ac38f947db1fa4ffb185d8394b2877d44c8372e`.
Server DE healthy, его 338 файлов и входные файлы сборки соответствуют принятому
коду; release SHA — `07edda299f0f226d081974c876e14b80604a15f5`, последующий
коммит меняет только документы. Код browser и collector также совпал с GitHub.
В рабочей БД DE применены все 45 файлов миграций, включая 040–043.
Desktop 1.0.2, Electron, bundled Node и Host Agent на обоих узлах прошли сверку.
Публичные live/ready, Operations и Mini App с Windows вернули 200; из DE — 403.
На момент сверки рабочая ветка Windows совпадала с GitHub; локальная `main` в другом чистом
worktree отстаёт на пять коммитов. Это состояние refs, а не невыпущенный код.
Новые живые проверки HH, голоса и VPN-трафика в этот аудит не входили.
Подробности установленного сервера — в [последнем выпуске](updates/2026-10-22-living-sky-release.md),
порядок повторной сверки — в [руководстве](release-workflow.md).

### Основные документы

| Документ | Для чего читать |
| --- | --- |
| `README.md` | Назначение продукта, возможности и запуск |
| `AGENTS.md` | Короткие обязательные правила для всех агентов |
| `release-workflow.md` | Ветки, GitHub, VPS/Desktop и обновление MD; схема выпуска |
| `runtime-context.md` | Подробности облачных и Windows-подсистем, доверие и deployment records |
| `verification.md` | Команды проверок для изменённых компонентов |
| `telegram-button-architecture.md` | Routing, диагностика, доверие и обязательный pre-edit notice |
| `telegram-menu-contract.md` | Отправляемые кнопки, callbacks, confirmations и regression gate |
| `../deploy/README.md` | Установка и обслуживание Ubuntu/Compose/Host Agent |
| `VPN_RESILIENCE_RUNBOOK.md` | Проверка VLESS/Hysteria/Happ и границы доказательств |
| `VPN_SUPERVISOR_REPAIR_GUIDE.md` | Допустимый ремонт и reconciliation исходного ID |
| `VPN_PC_SETUP.md` | Настройка VPN-клиента на компьютере |

Документы из таблицы доступны в текущем каталоге; корневые README/AGENTS лежат
на уровень выше. [Skill jarvis-release](../.agents/skills/jarvis-release/SKILL.md)
использует руководство по выпуску, без независимой копии правил.

### Записи, которые объясняют нынешний статус

- [Голос и реальные Telegram-сценарии](updates/2026-09-23-telegram-dialogue-acceptance.md).
- [Life OS v2](updates/2026-09-15-jarvis-life-os-v2.md) и
  [Telegram parity](updates/2026-09-15-telegram-life-os-parity.md).
- [Первый Vision slice](updates/2026-09-09-vision-implementation.md).
- [Desktop 1.0.2 и maintenance](updates/2026-09-29-remaining-maintenance.md).
- [Частичная доступность подписок](updates/2026-09-29-subscription-partial-availability.md),
  [original-ID восстановление](updates/2026-09-29-subscription-missing-repair.md)
  и [сохранение hopping](updates/2026-09-29-hysteria-hopping-persistence.md).
- [Фактический scope мониторинга](updates/2026-09-24-vpn-monitoring-alerting-and-repair-scope.md),
  [host-bound Supervisor](updates/2026-09-24-vpn-supervisor-host-bound-callback-routing.md)
  и [таймеры/сертификат NL](updates/2026-09-24-vpn-probe-timers-and-nl-dns-acme.md).
- [Последняя VPN-сверка](updates/2026-10-08-vpn-probe-resilience.md).

### История решений

Первоначальные договорённости по поиску работы зафиксированы до реализации.
[Исходные договорённости от 14 октября 2026 года](superpowers/specs/2026-10-14-job-search-initial-agreements.md)
сохраняют согласованный контекст и открытые вопросы.
[Спецификация от 15 октября](superpowers/specs/2026-10-15-job-search-design.md)
согласована владельцем; подготовлен
[план реализации](superpowers/plans/2026-10-15-job-search.md). На том этапе сбор,
карточки и письма реализовывались локально; результат и ограничение API HH описаны в
[записи разработки](updates/2026-10-15-job-search-development.md). На момент этой
записи функция не была выпущена; более поздний статус приведён выше.

[Specs](superpowers/specs/) и [plans](superpowers/plans/) хранят решения и
исполнение. [Updates](updates/) хранят результаты выпусков. Ищи по подсистеме
и дате; более поздняя подтверждённая запись имеет приоритет над прежним планом.
Все прежние ссылки на `docs/specs/` и `docs/plans/` проверяй: актуальные файлы
находятся под `docs/superpowers/`.

[Прежняя подробная карта](history/2026-10-08-documentation-map.md) и
[прежний AGENTS](history/2026-10-08-agent-context.md) сохранены как архив.
Они не заменяют текущие правила и живую проверку.

## English

The project description and current records now have both language versions:
[documentation update from 16 October](updates/2026-10-16-bilingual-project-docs.md).
The changes were published to GitHub and received by both VPS nodes; source,
Desktop, server, and Host Agent comparisons passed. Differences in the retained
collector image and an observed browser restart are listed in the update record.

The status below is based on verification records. [AGENTS.md](../AGENTS.md)
contains the rules for agents; [release-workflow.md](release-workflow.md)
describes publishing. Plans describe intentions. Code, checks, and actual
deployment establish what is running.

### Current status

October 22: released [bot resume selection and default automatic raising](updates/2026-10-22-hh-resume-bot-defaults-release.md).
Explicit off and unknown stops are preserved. Verified:
787 server tests and 32 PostgreSQL scenarios, including Telegram owner/member
and permission-revocation races. DE server/collector are updated with 042/043;
both VPS sources are synchronized. The first background check returned `not_due`;
raising is unconfirmed and automation remains enabled.

October 22: released [HH resume management](updates/2026-10-22-hh-resume-management-release.md):
persistent primary selection, catalog refresh and a separate free auto-raise switch.
The subsequent release enabled it by default, as described above. DE server,
browser and collector are updated; both VPS source checkouts are synchronized.
Real selection and the first raise remain client acceptance checks.

October 21: released [empty job filters and multiline phrase input](updates/2026-10-21-empty-job-filters.md).
Verified with PC Edge, 785 server tests, 66 Telegram checks and 10 PostgreSQL scenarios.
DE server and collector are updated, both VPS sources are synchronized, and Senya's filters are cleared.

Fixed the [missing CAPTCHA picture during HH sign-in](updates/2026-10-21-hh-login-captcha-repair.md).
Picture loading in Russian and English passed in isolated Chromium on DE;
a member's real SMS sign-in remains unverified. Deployment status is in the record.

On October 21, [HH sign-in, private link delivery and phone controls](updates/2026-10-21-hh-login-touch-release.md)
were released. DE server, browser and collector are updated; both VPS source
checkouts are synchronized. Linux checks passed: 783 server, 79 browser,
42 migrations and 14 PostgreSQL tests. Real member sign-in and the iPhone
keyboard still require acceptance.

On October 21, [the DE job collector was restored](updates/2026-10-21-job-collector-access-repair.md):
the missing owner setting was added, and search resumed from saved progress.
Separate HH profiles, roles and personal `jobs` permissions already exist.
The permanent configuration and queue fixes are published in `main`; both VPS
sources are synchronized, and the DE server and collector are updated. The new
image passed 781 unit tests and 3 PostgreSQL checks; public HTTPS smoke passed.

The [orbital monitoring redesign](updates/2026-10-22-orbital-monitoring-release.md)
is installed: a core, six planets and a dark workspace for the existing nine
pages. Search-only header, five-icon dock, moving planets and sliding workspace.
The approved scene has a narrow Milky Way, separated orbits, individual speeds,
rare ambient events and safe framing. Approved sidebar B is implemented: a translucent
filtered service list with inline controls. Unit 42/42, build, WebGL and browser fixtures at
1440/662/390/320 px passed.
DE server is updated and both VPS sources are synchronized. Linux 786/786, public
smoke and UI asset checks passed. Owner sign-in and all nine sections with real data passed; physical phone FPS remains a client check.

The [living sky update](updates/2026-10-22-living-sky-release.md) is installed:
Milky Way and three star layers with parallax, twinkling and shared pause.
NASA/Gaia replaces the previous texture with local 4K/8K variants without upscaling.
All 46 unit tests, build, browser and CSP checks passed. The image passed 787 Linux
checks, all 11 public files matched; DE server and both VPS source checkouts are updated.

[Desktop reliability and a local test entry point](updates/2026-10-20-desktop-reliability-release.md)
are released: bounded HTTP, IDs saved before sending, read-only result
recovery, connection hints and `test:core`. All 885 checks and wide/minimum-window
browser fixtures passed. DE server and installed Desktop are updated; both VPS
sources are synchronized. Linux 778/778 and isolated PostgreSQL acceptance passed.
Direct Windows HTTPS/WSS is unavailable: Desktop is paired/offline and live chat
is not yet accepted.

[Fixed Moscow UTC+3 time is released](updates/2026-10-19-moscow-time-release.md):
timezone-less reminder input and user-facing clocks use Moscow. DE server
is updated; Desktop 1.0.2 was rebuilt and installed. Server tests passed
760/760, PostgreSQL acceptance 1/1, plus browser checks in three timezones.
Existing reminders are not shifted; phone input and delivery need acceptance.

[Free-first OpenRouter routing](updates/2026-10-19-free-first-routing-release.md)
is enabled on DE: seven approved free models, then two DeepSeek candidates
ranked by estimated cost. Prices/quota refresh on use every 15 minutes; no new
IDs are added. Linux server tests passed 756/756; a live Nemotron Super reply
cost $0, confirmed by a separate generation receipt. Both VPS sources are synchronized.

The [Telegram Mini App is deployed on DE](updates/2026-10-18-telegram-mini-app-release.md):
3D core, Telegram IDs, roles and personal overrides, administration, audit,
private chat and own-section reads. A [subsequent fix](updates/2026-10-18-mini-app-entry-help-removal.md)
removed Help and the entry dependency on the remote SDK. Linux server tests
at that release: 742/742; the first release passed 8 PostgreSQL acceptance tests
and all 40 migrations. The launch button is configured and both VPS source checkouts
are synchronized. Actual login after the fix, Telegram Web cookies, phone FPS
and two accounts still need acceptance; a second HH account needs its own connection.
The [chat handoff for the next agent](updates/2026-10-18-mini-app-agent-handoff.md)
records decisions, the verified owner, revisions and the next step.

On October 19, [personal HH sign-in for members](updates/2026-10-19-member-hh-login-release.md)
was released. Members with current `jobs` permission connect through a temporary
HTTPS link from a phone or PC and use a separate HH profile. The server and
browser are deployed on DE; migration 039 is applied, and both VPS source
checkouts match `main`. Server/browser health and public HTTPS smoke passed.
A real member sign-in and resume confirmation still need acceptance. The local
implementation and its checks remain in the [development record](updates/2026-10-19-job-search-member-access-development.md).

[A new 403 after correct OCR is under investigation](updates/2026-10-18-hh-captcha-403-investigation.md):
native requests and browser/API cookies were checked without submitting answers.
The past 403's exact cause is unknown; a bounded HH response classifier is installed on DE,
with Linux browser checks 71/71. The approved submission at 18:37 Moscow time
again returned 403/unknown; CSRF matched the cookie, but the classifier could not
inspect an explanation. Read-only API searches from Windows and DE also returned
403 from ddos-guard. A network-layer rejection is likely; the exact cause remains
unknown. `HH_APP_TOKEN` is unset, so authenticated API access was not tested.

[A live OCR answer passed HH after owner approval](updates/2026-10-18-hh-ocr-live-acceptance.md):
one submission, POST 302, target verification 200, `solved`; collection resumed.
This test does not confirm a fully autonomous cycle.

[Unconfirmed human HH submission investigation](updates/2026-10-18-hh-captcha-receipt-diagnosis.md):
HTTP/verifier details were not retained; a durable closed receipt for both paths
is installed on DE, with Linux browser checks 66/66. The cause of the previous unknown remains unproven.

[Private OCR attempt evidence is installed on DE](updates/2026-10-18-hh-captcha-evidence.md):
image, answer and closed outcomes for new failure analysis. Linux browser checks passed 62/62;
export works and the archive is empty. Previous images and answers cannot be recovered.

[The limit is now three attempts](updates/2026-10-18-hh-captcha-three-attempts-development.md)
before handing a challenge to the owner: code is on GitHub and both VPS nodes, and the DE browser is updated.

[Fine-tuned HH OCR is installed on DE](updates/2026-10-18-hh-trained-ocr-release.md):
original rectification and weights, now up to three automatic attempts before a Telegram
photo, unknown-result stop and a restart-safe budget. Checks cover 1,709 images,
73/73 CPU parity and isolated Linux browser/worker/socket behavior. The first live
attempt did not confirm access; automation stopped and a photo was sent to the
owner. The newer live OCR answer test is confirmed in the linked record above.

All [13 confirmed audit fixes are deployed](updates/2026-10-17-audit-remediation-release.md):
server/Operations UI on DE, Host Agent on DE/NL, Desktop rebuilt and installed.
The server image passed 723/723, cloud 73/73, and Host Agent 149/149 on each Linux
node; Operations tests/build and browser fixtures passed. Source and installed
components were compared. Live voice, camera, changing commands and owner
Operations browser access remain client checks; an external Operations probe
from the VPS received 403.

The [button-based job settings panel](updates/2026-10-16-job-settings-panel-release.md)
is deployed on DE: separate fields, presets, custom values, phrase lists and
explicit save confirmation. Rendering and callbacks passed; actual Telegram taps
remain for user acceptance.

[Tracking old and new HH applications](updates/2026-10-16-job-application-tracking-release.md)
is deployed on DE: a merged list, separate submission and employer states, an initial
import and explicit refresh. Active/archived reading passed; the first full import
and real Telegram taps remain for user acceptance.

[Four cover-letter modes](updates/2026-10-16-job-letter-modes-release.md)
are deployed on DE: base, AI-improved, custom without AI and custom with AI.
Facts/examples are optional and included in both AI modes when present. The
editor and mode selection were checked on the running server; real Telegram
taps and an HH application remain unverified.

| Area | Confirmed | Still to check |
| --- | --- | --- |
| Cloud and memory | Fastify/PostgreSQL, Telegram/Desktop text, owner-scoped memory, documents, and production hybrid retrieval | Live scenarios across multiple devices |
| Desktop | Version 1.0.2 installed; code and bundled Node match the accepted version | Live microphone and paired Desktop voice |
| Telegram | Real owner text/voice, Mission → Life OS return; automated owner/member and subscription flows | Member-client restrictions, gallery/deletion, and actions that change state |
| Life OS | Event Spine, Mission, Timeline, commitments, recovery, origin-bound proposals; workflow against real PostgreSQL | Real external providers and Recovery that changes state on a paired Desktop |
| Vision | Camo at 1280×720, two screens, explicit leases, and the first local memory/analysis workflow | Deployed provider and remote/Telegram acceptance |
| VPN | DE/NL services active; four active subscriptions export four endpoints; VLESS 443/8443 passed in both directions | Hysteria hopping DE→NL had mixed results; Happ refresh/traffic on a phone |
| VPN Supervisor | Limited NL Xray restart with owner confirmation and postchecks; peer timers enabled | Restore disabled; external timer failures do not yet create Telegram incidents |
| Operations | Server, PostgreSQL, and ASR healthy; hopping DNAT present and persisted in UFW on both nodes | Persistence after reboot and automatic ACME renewal; backups deferred by the owner |
| Further work | Cloud and Windows are the main product components | PWA, server executors, schedules, and real account connectors |
| Job search | Personal sign-in for members with `jobs` permission is deployed on DE, with separate HH profiles | [Release record](updates/2026-10-19-member-hh-login-release.md); real member sign-in and resume confirmation remain unverified |

The [job-search button update](updates/2026-10-15-job-search-buttons.md) is
installed on DE, with enable/disable controls and a permanent bottom-menu entry.
[HH link previews were also disabled](updates/2026-10-15-job-link-previews.md)
in new messages, and 260 previously sent cards were updated.

The CAPTCHA history includes [OCR and one automatic attempt](updates/2026-10-15-hh-captcha-recovery-release.md),
[diagnosis](updates/2026-10-15-hh-ocr-diagnosis.md),
[image preprocessing](updates/2026-10-15-hh-ocr-preprocessing-development.md),
and the [native request fix](updates/2026-10-16-hh-native-captcha-request.md).

At the owner's request, the former HH web access through Tailscale was replaced
with [replies to Telegram photos](updates/2026-10-16-hh-telegram-captcha.md).
Images expire after 10 minutes; the search pause has no timer. The owner reads
the image in this workflow. The mode installed on 16 October did not run automatic
OCR; a separate opt-in has been active since 18 October, as described above.
On 16 October, the owner confirmed solving the CAPTCHA manually.
The server confirmed `solved`, cleared the manual pause, and resumed collection:
the page advanced from 15 to 18 and sent cards increased from 583 to 602.
These figures describe the acceptance check, not ongoing search metrics.
Earlier mobile-page results remain in the history.

Later that day, the browser stopped preparing the next CAPTCHA after running out
of memory. The [fix was installed on DE](updates/2026-10-16-hh-captcha-resilience-release.md):
a new image reached Telegram, and the server confirmed `solved`, an idle
coordinator, and continued progress from the saved position. Refresh requests
survive failures; health checks test Chromium, and failures receive clear messages.

Comparison on October 22, 2026: GitHub, the primary Windows checkout and clean
source checkouts on both VPS nodes matched `3ac38f947db1fa4ffb185d8394b2877d44c8372e`.
DE server is healthy; its 338 files and build inputs match the accepted code.
Its release SHA is `07edda299f0f226d081974c876e14b80604a15f5`; the following
commit changes documentation only. Browser and collector code also matched GitHub.
The DE production database has all 45 migration files applied, including 040–043.
Desktop 1.0.2, Electron, bundled Node and Host Agent on both nodes passed comparison.
Public live/ready, Operations and Mini App returned 200 from Windows and 403 from DE.
At comparison time the Windows task branch matched GitHub; local `main` in another clean worktree
is five commits behind. This is a ref difference, with no unpublished code.
New live HH, voice and VPN traffic checks were outside this audit.
See the [latest release](updates/2026-10-22-living-sky-release.md) for installed-server
details and the [guide](release-workflow.md) for repeating the comparison.

### Main documents

| Document | Purpose |
| --- | --- |
| `README.md` | Product purpose, capabilities, and startup |
| `AGENTS.md` | Short mandatory rules for all agents |
| `release-workflow.md` | Branches, GitHub, VPS/Desktop, Markdown updates, and release flow |
| `runtime-context.md` | Cloud and Windows subsystems, trust boundaries, and deployment records |
| `verification.md` | Verification commands for changed components |
| `telegram-button-architecture.md` | Routing, diagnostics, trust, and mandatory pre-edit notice |
| `telegram-menu-contract.md` | Emitted buttons, callbacks, confirmations, and regression gate |
| `../deploy/README.md` | Ubuntu/Compose/Host Agent installation and maintenance |
| `VPN_RESILIENCE_RUNBOOK.md` | VLESS/Hysteria/Happ checks and limits of evidence |
| `VPN_SUPERVISOR_REPAIR_GUIDE.md` | Permitted repairs and reconciliation using the original ID |
| `VPN_PC_SETUP.md` | VPN client setup on the computer |

Documents in the table are in this directory; the root README/AGENTS files are
one level above. The [jarvis-release skill](../.agents/skills/jarvis-release/SKILL.md)
uses the release guide without maintaining an independent set of rules.

### Records explaining the current status

- [Voice and real Telegram scenarios](updates/2026-09-23-telegram-dialogue-acceptance.md).
- [Life OS v2](updates/2026-09-15-jarvis-life-os-v2.md) and
  [Telegram parity](updates/2026-09-15-telegram-life-os-parity.md).
- [First Vision workflow](updates/2026-09-09-vision-implementation.md).
- [Desktop 1.0.2 and maintenance](updates/2026-09-29-remaining-maintenance.md).
- [Partial subscription availability](updates/2026-09-29-subscription-partial-availability.md),
  [recovery using the original ID](updates/2026-09-29-subscription-missing-repair.md),
  and [hopping persistence](updates/2026-09-29-hysteria-hopping-persistence.md).
- [Actual monitoring scope](updates/2026-09-24-vpn-monitoring-alerting-and-repair-scope.md),
  [host-bound Supervisor](updates/2026-09-24-vpn-supervisor-host-bound-callback-routing.md),
  and [NL timers/certificate](updates/2026-09-24-vpn-probe-timers-and-nl-dns-acme.md).
- [Latest VPN comparison](updates/2026-10-08-vpn-probe-resilience.md).

### Decision history

The original job-search agreements were recorded before implementation.
The [agreements from 14 October 2026](superpowers/specs/2026-10-14-job-search-initial-agreements.md)
preserve the agreed context and open questions. The owner approved the
[15 October specification](superpowers/specs/2026-10-15-job-search-design.md),
and an [implementation plan](superpowers/plans/2026-10-15-job-search.md) was prepared.
At that stage, collection, cards, and letters were being implemented locally;
the result and HH API limitation are in the
[development record](updates/2026-10-15-job-search-development.md). The feature
had not been released when that record was written; later status appears above.

[Specs](superpowers/specs/) and [plans](superpowers/plans/) preserve decisions
and execution. [Updates](updates/) preserve release results. Search by subsystem
and date; a later confirmed record takes precedence over an earlier plan.
Check old links to `docs/specs/` and `docs/plans/`: current files are under
`docs/superpowers/`.

The [former detailed map](history/2026-10-08-documentation-map.md) and
[former AGENTS](history/2026-10-08-agent-context.md) remain archived.
Current rules and live verification take precedence over them.
