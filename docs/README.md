# Карта документации Jarvis

[Русский](#русский) | [English](#english)

## Русский

2 ноября после выпуска обнаружен [недостаточный лимит reasoning при оценке HH](updates/2026-11-02-hh-evaluation-token-budget.md).
Для вакансии 138512145 запрос дошёл до модели, но весь лимит 1024 токена ушёл
на reasoning. Лимит увеличен до 6000 и установлен на DE; 24 профильных и 916 серверных
тестов прошли, server healthy. Исходная unknown-операция не повторялась.

2 ноября на DE [исправлен отбор HH и добавлены ответы работодателю](updates/2026-11-02-hh-context-and-answers-release.md):
полный контекст фильтров, проверка направления, защита от выдуманных намерений и
поддерживаемые нативные вопросы HH. Server/browser healthy, миграции 056/057
применены; исходники обоих VPS синхронизированы. Реальная отправка новой анкеты
ещё не проверена; Desktop не менялся.

1 ноября [сверены действующие руководства](updates/2026-11-01-current-documentation-refresh.md):
ручной и автоматический HH, модель, расходы и отдельная приёмка профилей.


1 ноября на DE установлен [автопоиск с LLM](updates/2026-11-01-hh-autonomous-search-release.md):
личный переключатель в боте/Mini App, правдивый отбор частичных соответствий,
тихие автоотклики, передача тестов и одно уведомление о $2 за месяц.
GLM 5.3 Flash проверен через существующий OpenRouter; reasoning low обязателен.
Исходники обоих VPS синхронизированы, сервер healthy, режим выключен по умолчанию.
[Вход HH восстановлен, полное резюме проверено](updates/2026-11-01-hh-session-and-complete-resume-repair.md).
Первый реальный автоотклик ещё не подтверждён. Неполный снимок блокирует автоматику.

27 октября установлена [диагностика чтения резюме HH](updates/2026-10-27-hh-resume-diagnostics-release.md).
28 октября reader исправлен: сервер прочитал название, опыт и навыки выбранного
резюме. Защита привязки писем и migration 053 установлены на DE.
28 октября также исправлен [обрыв ответа при создании письма](updates/2026-10-28-hh-letter-output-fix.md):
строгая JSON-схема, отключённый reasoning и запас до 6000 токенов для всех профилей.
890 серверных тестов и 10 PostgreSQL-сценариев прошли; сервер обновлён.
Живая диагностика с выбранным резюме прошла; создание письма через Telegram ещё открыто.

27 октября завершён [этап 5 Mini App](updates/2026-10-27-mini-app-stage-five-release.md):
документы, устройства, Life OS и явная сверка неизвестного результата HH.
Проверено 885 server tests, 32 PostgreSQL acceptance tests, десять браузерных
fixture-программ и отдельный E2E с настоящими API, БД и файловым хранилищем.
Выпуск установлен на DE: healthy, 54 миграции, 371 server file и 24 assets
совпали с принятым кодом; оба VPS source синхронизированы с GitHub main.
Этап 6, живая приёмка Telegram, остаётся открытым.

27 октября на DE установлен [выпуск кнопок и памяти Mini App](updates/2026-10-27-mini-app-buttons-release.md):
877 server tests, 24 PostgreSQL-сценария, девять браузерных наборов и независимая
ревизия всей ветки. Прежние два падающих теста и найденные ревизией гонки исправлены.
Миграции 049–051 установлены, server healthy; оба VPS source и Windows совпадают
с GitHub main. Проверены 366 server files и 23 Mini App assets. Живая приёмка Telegram открыта.

27 октября выпущены [операции памяти Mini App](updates/2026-10-27-mini-app-memory-development.md):
добавление, исправление и удаление с подтверждением, квитанцией и безопасной отменой
исходного запроса. Server 877/877, PostgreSQL 22/22, восемь браузерных наборов;
независимая security-ревизия выполнена. Миграция 051 установлена в новом выпуске.
Остальная часть этапа 5 завершена новым результатом выше; живая приёмка этапа 6 открыта.

На DE работает [прямая выдача подписок Happ](updates/2026-10-26-subscription-generated-links-release.md)
без Cloudflare, включая новые ссылки и кнопку импорта для всех профилей.
Все пять активных подписок текущего владельца формируют по четыре подключения;
токены и привязки при итоговой проверке сохранены. Владелец подтвердил результат
после выпуска. Server healthy; 863 проверки прошли локально и в Linux-образе
(по две с БД пропущены), семь сценариев Caddy, DNS и строгий TLS проверены.
Остальные устройства и длительная работа ещё не проверены; первопричина
сбоя старого маршрута не установлена. Уже сохранённые в Happ адреса не меняются
автоматически — общий генератор выдаёт новый origin для любого профиля.

27 октября выпущен [этап 4 Mini App](updates/2026-10-26-mini-app-lists-development.md):
обновление и догрузка личных списков, раскрытие карточек и предыдущие сообщения
отдельной истории. Server 874/874; новая PostgreSQL-проверка 7/7 с полным
pipeline из 52 файлов по миграцию 050. Более новый общий результат указан в записи выпуска выше.

27 октября выпущен [этап 3 Mini App](updates/2026-10-26-mini-app-handoffs-development.md):
переходы сразу к меню нужного раздела бота, пояснения возможностей и безопасная
ссылка Operations для владельца. Server 874/874, Mini App PostgreSQL 13/13;
установлен вместе с остальными исправлениями Mini App.

27 октября выпущены [исправления кнопок Mini App, этапы 1–2](updates/2026-10-26-mini-app-button-reliability-development.md):
восстановление после ошибки диалога, гонки отмены HH, обновление списка доступа
и проверка прав на сохранённый ответ. Server 866/866, Mini App PostgreSQL 12/12.
Миграция 049 и код установлены; оставшаяся работа указана в плане.

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

Сводка записей выпусков обновлена 2 ноября 2026 года. Новую сверку окружения
проводи по [руководству по выпуску](release-workflow.md).
Результат переноса истории и проверки сохранности правил:
[уплотнение документации](updates/2026-10-23-documentation-consolidation.md).

### Текущее состояние

| Направление | Что подтверждено | Что ещё проверить |
| --- | --- | --- |
| HH: письма, автопоиск и расходы | [Полный контекст и ответы HH](updates/2026-11-02-hh-context-and-answers-release.md) установлены на DE; миграции 056/057, server/browser healthy. GLM учитывает направление, фильтры, резюме и базовое письмо; поддерживаемые нативные вопросы проходят через сохранённые точные ответы. Личное согласие и unknown сохраняются | Живая новая анкета, owner/member и новый текст Telegram; первое реальное автодействие нельзя считать проверенным по фикстурам |
| HH: подключение и резюме | Код общий для всех UUID-профилей, изоляция проверена тестами. [Личный вход и полное чтение резюме владельца подтверждены](updates/2026-11-01-hh-session-and-complete-resume-repair.md); установлен reader полного привязанного состояния. Прежнее основное резюме сохранено, server state показал available=true при выключенной автоматике | Реальные входы и полные резюме участников, клавиатура iPhone, первое успешное поднятие. Неподдерживаемые непустые разделы требуют вмешательства; успешная проверка владельца не доказывает работу каждого профиля |
| HH: CAPTCHA и сбор | [Общий сбор](updates/2026-10-24-hh-complete-collection.md), три прохода и сохранение прогресса установлены; после восстановления входа 1 ноября ограниченный тик свежей очереди завершился без failure code; очередь продолжает обход. OCR ограничен тремя попытками, unknown останавливает отправку | Старый исторический диапазон дал JOB_COLLECTION_WINDOW_EXPIRED; полный backlog не объявлен прочитанным. Следующий CAPTCHA-цикл. HTTP 403 с формой входа 1 ноября не устанавливает причину прежнего CAPTCHA-отказа |
| Desktop | Установлена 1.0.2; [надёжность запросов и проверка результата по исходному ID](updates/2026-10-20-desktop-reliability-release.md), сверка установленного кода и bundled runtime прошли | Живой чат, микрофон, paired voice и реальные команды; при приёмке прямой Windows HTTPS/WSS был недоступен |
| Telegram и Mini App | [Роли и личные разрешения](updates/2026-10-18-telegram-mini-app-release.md), [вход без внешнего SDK и удаление «Помощи»](updates/2026-10-18-mini-app-entry-help-removal.md); подпись, TTL и membership проверяются сервером | Реальные owner/admin/member сценарии, Telegram Web cookies и два аккаунта |
| Operations UI | [Орбитальная панель](updates/2026-10-22-orbital-monitoring-release.md) и [живой фон](updates/2026-10-22-living-sky-release.md) установлены; девять разделов с реальными данными проверены | FPS и нагрузка физического телефона |
| Облако, память и Life OS | Fastify/PostgreSQL, личные память и документы, production hybrid retrieval; [Life OS v2](updates/2026-09-15-jarvis-life-os-v2.md), [Telegram parity](updates/2026-09-15-telegram-life-os-parity.md), real-PostgreSQL workflow | Live multi-device, реальные внешние провайдеры и изменяющий Recovery на paired Desktop |
| Vision | [Первый slice](updates/2026-09-09-vision-implementation.md): Camo 1280×720, два экрана, явные leases, локальные analysis/memory | Развёрнутый провайдер и remote/Telegram acceptance |
| VPN и Supervisor | [UDP-буферы и свежие пробы 29 октября](updates/2026-10-29-vpn-udp-buffers.md): DE/NL лимиты 7 МиБ, Hysteria-сокеты увеличены; VLESS 443/8443, Hysteria fixed/hopping прошли в обе стороны | Звонок/стрим Happ и обход приложения ресторана на устройстве; reboot persistence. Restore выключен; внешние пробы не создают Telegram incidents |
| Эксплуатация | [13 исправлений аудита](updates/2026-10-17-audit-remediation-release.md) установлены; сервер, PostgreSQL и ASR healthy по записям проверки; hopping DNAT сохранён в UFW | Reboot persistence и автоматическое ACME renewal; backup timer и реальная backup/restore-проверка отложены владельцем |
| Планы | Облако и Windows — основные части продукта | PWA, server executors, расписания и реальные account connectors |

Последние выпуски HH обновили затронутые компоненты DE server/collector/browser,
применили миграции по 055 включительно и синхронизировали исходники обоих VPS. SHA, версии
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

November 2: a [too-small HH evaluation reasoning allowance](updates/2026-11-02-hh-evaluation-token-budget.md)
was found after release. Vacancy 138512145 reached the model, but reasoning used
the entire 1024-token cap. The 6000-token repair is deployed on DE and passed
24 focused and 916 server tests; server is healthy. The original unknown operation
was not retried.

November 2: [HH selection and employer answers](updates/2026-11-02-hh-context-and-answers-release.md)
are deployed on DE: complete filter context, direction checks, unsupported-intent
guards and supported native HH questions. Server/browser are healthy, migrations
056/057 are applied, and both VPS sources are synchronized. A real new
questionnaire submission remains unverified; Desktop code is unchanged.

November 1: [current guides are reconciled](updates/2026-11-01-current-documentation-refresh.md):
manual/autonomous HH, model policy, spending and separate profile acceptance.


November 1: [autonomous job search](updates/2026-11-01-hh-autonomous-search-release.md)
is deployed on DE: personal Telegram/Mini App controls, truthful partial-match
selection, quiet applications, test handoff and one $2 monthly notice. GLM 5.3 Flash
passed live probes with the existing OpenRouter key; low reasoning is required.
Both VPS sources are synchronized, server is healthy, automation defaults to off.
[HH sign-in and complete resume reading are verified](updates/2026-11-01-hh-session-and-complete-resume-repair.md).
The first autonomous application remains unverified. Partial snapshots block automation.

October 27: [HH resume read diagnostics](updates/2026-10-27-hh-resume-diagnostics-release.md)
are deployed. On October 28, the fixed reader successfully read the selected
resume's title, experience and skills. Draft provenance guards and migration 053
are deployed on DE. October 28: [cover-letter truncation is also addressed](updates/2026-10-28-hh-letter-output-fix.md)
with strict JSON output, disabled reasoning and a 6000-token allowance
for every profile. All 890 server tests and 10 PostgreSQL scenarios passed;
the server is updated. Live diagnostic generation with the selected resume
passed; full letter creation through Telegram remains open.

October 27: [Mini App stage 5](updates/2026-10-27-mini-app-stage-five-release.md)
is complete: documents, devices, Life OS and explicit verification of unknown
HH results. Validation passed 885 server tests, 32 PostgreSQL acceptance tests,
ten browser fixture programs and a separate E2E with real APIs, database and
file storage. Deployed to DE: healthy, 54 migrations, 371 server files and
24 assets verified against accepted code; both VPS sources match GitHub main.
Stage 6, live Telegram acceptance, remains open.

The [October 27 Mini App buttons and memory release](updates/2026-10-27-mini-app-buttons-release.md)
is installed on DE: 877 server tests, 24 PostgreSQL scenarios, nine browser suites and
independent full-branch review. Both previously failing tests and the reviewed
races were fixed. Migrations 049–051 are applied and server is healthy; both VPS
source checkouts and Windows match GitHub main. All 366 server files and 23 Mini
App assets were checked. Live Telegram acceptance remains open.

On October 27, [Mini App memory actions](updates/2026-10-27-mini-app-memory-development.md)
were released: add, correct and forget with confirmation, a receipt and safe
cancellation of the original request. Server 877/877, PostgreSQL 22/22 and eight
browser suites passed; independent security review completed. Migration 051 was
applied in the new release. The newer result above completes stage 5; live stage-6 acceptance remains open.

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

[Mini App stage 4](updates/2026-10-26-mini-app-lists-development.md) was released
on October 27: refreshing and loading personal lists, expanding cards and loading
older messages in the separate history. Server 874/874; new PostgreSQL suite
7/7 with all 52 migration files through 050. The newer full-branch result appears
in the release record above.

[Mini App stage 3](updates/2026-10-26-mini-app-handoffs-development.md) is ready
locally: direct navigation to each bot section menu, capability descriptions
and a safe owner-only Operations link. Server 874/874, Mini App PostgreSQL 13/13;
these changes were installed with the other Mini App fixes on October 27.

[Mini App button fixes, stages 1–2](updates/2026-10-26-mini-app-button-reliability-development.md)
were released on October 27: chat failure recovery, HH cancellation races, access-list
refresh ordering and access checks on saved answers. Server 866/866, Mini App
PostgreSQL 12/12. Migration 049 and code are installed; remaining work stays in the plan.

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

Release-record summary updated on November 2, 2026. Use the
[release guide](release-workflow.md) for a fresh environment comparison.
For history preservation and rule-retention checks, see the
[documentation consolidation record](updates/2026-10-23-documentation-consolidation.md).

### Current status

| Area | Verified result | Outstanding checks |
| --- | --- | --- |
| HH: letters, automation and spending | [Complete context and HH answers](updates/2026-11-02-hh-context-and-answers-release.md) deployed on DE; migrations 056/057, healthy server/browser. GLM receives direction, filters, resume and base letter; supported native questions use saved exact answers. Personal consent and original unknown IDs are retained | A live new questionnaire, owner/member and updated Telegram text; fixtures do not establish real autonomous sending |
| HH: connection and resumes | Shared code covers all UUID profiles; isolation is tested. [Personal sign-in and complete resume reading passed for the owner](updates/2026-11-01-hh-session-and-complete-resume-repair.md). The bound-state reader is installed; the original primary was retained. Server state returned available=true with automation off | Real member sign-ins/resumes, iPhone keyboard and first successful raise. Unsupported nonempty sections need intervention; owner acceptance does not establish every profile works |
| HH: CAPTCHA and collection | [Shared collection](updates/2026-10-24-hh-complete-collection.md), three lanes and durable progress are deployed. After November 1 sign-in recovery, a bounded fresh-queue tick finished without a failure code; collection continues. OCR allows three attempts; unknown stops submission | An old history range returned JOB_COLLECTION_WINDOW_EXPIRED; the full backlog is not accepted. Next CAPTCHA cycle. The November 1 HTTP 403 login page does not establish the cause of earlier CAPTCHA failures |
| Desktop | Version 1.0.2 installed; [bounded requests and result checks by original ID](updates/2026-10-20-desktop-reliability-release.md), installed-source and bundled-runtime comparisons passed | Live chat, microphone, paired voice and real commands; direct Windows HTTPS/WSS was unavailable during acceptance |
| Telegram and Mini App | [Roles and personal permissions](updates/2026-10-18-telegram-mini-app-release.md), [entry without the external SDK and Help removal](updates/2026-10-18-mini-app-entry-help-removal.md); server validation of signatures, TTL and membership | Actual owner/admin/member flows, Telegram Web cookies and two accounts |
| Operations UI | [Orbital monitoring](updates/2026-10-22-orbital-monitoring-release.md) and [living sky](updates/2026-10-22-living-sky-release.md) installed; nine sections checked with real data | Physical-phone frame rate and load |
| Cloud, memory and Life OS | Fastify/PostgreSQL, personal memory/documents, production hybrid retrieval; [Life OS v2](updates/2026-09-15-jarvis-life-os-v2.md), [Telegram parity](updates/2026-09-15-telegram-life-os-parity.md), real-PostgreSQL workflow | Live multi-device, real external providers and changing Recovery on paired Desktop |
| Vision | [First slice](updates/2026-09-09-vision-implementation.md): Camo 1280×720, two displays, explicit leases and local analysis/memory | Deployed provider and remote/Telegram acceptance |
| VPN and Supervisor | [October 29 UDP buffers and fresh probes](updates/2026-10-29-vpn-udp-buffers.md): DE/NL limits raised to 7 MiB and Hysteria sockets enlarged; VLESS 443/8443 and Hysteria fixed/hopping passed both ways | Happ call/stream and restaurant-app bypass on device; reboot persistence. Restore disabled; external probes do not create Telegram incidents |
| Operations | [13 audit fixes](updates/2026-10-17-audit-remediation-release.md) installed; server, PostgreSQL and ASR healthy in recorded checks; hopping DNAT persisted in UFW | Reboot persistence and automatic ACME renewal; backup timer and real backup/restore acceptance remain deferred by the owner |
| Plans | Cloud and Windows are the main product components | PWA, server executors, schedules and real account connectors |

The latest HH releases updated the affected DE server/collector/browser components,
applied migrations through 055 and synchronized both VPS source checkouts. SHAs,
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
