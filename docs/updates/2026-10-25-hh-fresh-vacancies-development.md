# Свежие вакансии и ежедневная сверка HH / Fresh HH vacancies and daily reconciliation

[Русский](#русский) | [English](#english)

## Русский

Позднее 25 октября весь подготовленный результат выпущен на DE. Этот документ
сохраняет проверки локального этапа; установленное состояние и первые доставки
описаны в [результате выпуска](2026-10-25-hh-three-lane-release.md).

25 октября локально реализованы поиск свежих вакансий HH и ежедневная полная
сверка выбранного периода. Изменения находятся в `codex/hh-fresh-vacancies`.
Публикация в GitHub и обновление VPS не выполнялись; миграции 047/048 применялись
только в отдельном тестовом кластере PostgreSQL. Установленное поведение на DE
остаётся прежним. Desktop и браузерный пакет не менялись, сборка EXE не нужна.

### Поведение

Свежие вакансии проверяются каждые пять минут по существующим запросам и
фильтрам. Первый проход охватывает последний час, следующие используют свой
checkpoint с часовым перекрытием. После простоя весь пропущенный промежуток
сохраняется. Все три прохода хранят отдельный прогресс; один lease и
последовательные обращения используют существующий браузер. Пауза, включение,
изменение фильтров и текущие разрешения действуют на все проходы. Отдельных
настроек, меню, кнопок и подтверждений не добавлено.

Если свежий обход длится дольше пяти минут, перед ним добавляется новая верхняя
часть выдачи. Незаконченные окна сохраняются, свежие дни обходятся первыми.
Даже насыщенный день позволяет прочитать доступные первые 100 страниц, однако
полный сбор такого дня не объявляется. При более 256 окнах или 96 КиБ их
диапазоны уплотняются по запросам с повторным обходом; непроверенное время не
отбрасывается и checkpoint не продвигается. Это ограничивает размер состояния
ценой повторных чтений при длительной перегрузке. Уведомление о неполном сборе
имеет стабильную идентичность и не повторяется после каждого обновления вершины.

Свежий проход ограничен 12 запросами и 15 секундами между запросами. Для истории
runtime использует 20 запросов и те же 15 секунд. Текущий запрос завершается;
длинный ответ HH может превысить этот бюджет. Ограниченные проходы продолжаются
через десять секунд. Планировщик чередует пользователей и три вида сбора;
tick ограничен четырьмя пользователями каждого вида и минутой между проходами.
Справочник курсов валют общий для трёх сборщиков, второй Chromium не запускается.

Ежедневная сверка заново читает весь выбранный период, по умолчанию 14 дней,
независимо от последних отметок обычного и свежего поиска. Так она находит
пропущенные объявления и старые публикации, которые HH проиндексировал с задержкой.
Первый цикл назначается через 24 часа после установки/создания поиска; начальное
заполнение уже выполняет обычный сбор. Следующий цикл начинается через 24 часа
после окончания предыдущего. Пауза сохраняет прогресс, включение не откладывает
просроченный цикл, изменение фильтров сбрасывает его и назначает через сутки.

Сверка работает порциями до восьми запросов и десяти секунд между запросами;
текущий запрос завершается. Порции чередуются с обычным сбором, а свежие вакансии
проверяются перед фоновой работой. Слишком медленный свежий запрос переносит
очередь фонового прохода на следующий tick, чтобы сверка не простаивала постоянно.
Временный отказ повторяется в пределах 30 минут, если Retry-After не требует дольше.

Недоступные участки записываются компактно по индексам запросов. Цикл с такими
пробелами не меняет отметку последнего успешного полного обхода; остальные окна
обрабатываются, а через сутки повторяется вся актуальная глубина. Сводки 3000
проблемных дней для 100 запросов и максимальные UTF-8 запросы проверены на размер
вместе с ожидающими окнами. Сверка использует обычный приоритет карточек и общую
защиту от повторов. Уведомление о неполноте сохраняет прежние текст и кнопку.

Очередь отдаёт служебные attention первыми, затем свежие карточки и обычные
карточки. Неотправленная queued карточка перечитывается на HH перед повышением
приоритета. Для sent/sending/unknown карточек той же revision фильтров повторное
чтение описания можно пропустить. Дедупликация по пользователю и вакансии
сохраняется; неопределённая отправка не повторяется. Текст и кнопки карточек,
схема CAPTCHA и подтверждение отклика прежние.

### Проверки

- Полный server suite с отдельной PostgreSQL: **862/862**, без пропусков.
- PostgreSQL acceptance, включая HTTP, доступ, CAPTCHA, очередь и четыре сценария
  Edge → authenticated RPC → collector → PostgreSQL: **39/39**, без пропусков.
- Telegram regression gate и callback presentation: **75/75**.
- Проверены новая публикация во время незавершённого старого обхода,
  возобновление страницы, временные ошибки, часовой overlap, простой,
  общие фильтры, stale queued, приоритет attention/fresh, sent/unknown,
  роли и отзыв доступа, общий lease и продолжение следующих пользователей.
- Ежедневная сверка проверена на пропущенных старых вакансиях, поздней индексации,
  повторе полного периода, возобновлении, суточном расписании, недоступных участках,
  отсутствии ложного checkpoint и старейшей дате при глубине 30 дней.
- Проверка размера состояния прошла 1000 обновлений для 100 длинных запросов;
  объединение сохраняет покрытие всех непроверенных интервалов. Отказ сохранения
  не повторяется под тем же переполненным snapshot и освобождает lease штатно.
- Независимая ревизия выполнена; найденные блокировки свежего поиска,
  повышение по устаревшему snapshot и рост прогресса исправлены.
  `git diff --check` прошёл.

Для локального прогона установлены зависимости из существующего server lockfile;
package и lockfile не менялись. Браузерные тесты использовали установленный
Microsoft Edge с локальными HTML fixtures. Они не обращались к настоящему HH
или Bot API. Тестовый кластер создан отдельно от существующей службы PostgreSQL.

### Что осталось

Для включения нужен отдельно порученный выпуск server/collector с миграциями 047/048
на DE и синхронизация исходников обоих VPS по обычному порядку. Образ job-browser
не требует пересборки. Настоящие задержка доставки, количество CAPTCHA и прирост
CPU/RAM/трафика на VPS ещё не измерены. Пять минут являются целевым интервалом:
медленный HH, капча и очередь большого числа пользователей могут его увеличить.
Полнота дня с более 2000 вакансиями по одному запросу не гарантируется.
Удалённые до чтения объявления и даты за выбранной глубиной также могут быть
пропущены. При глубине 30 дней переход через полночь МСК во время запроса может
сделать старейший день недоступным; такой цикл явно сохраняет пробел и не считается полным.

Решение: [спецификация](../superpowers/specs/2026-10-25-hh-fresh-vacancies-design.md).
Команды: [проверки HH](../verification.md#восстановление-hh-captcha--hh-captcha-recovery).

## English

Later on October 25 the complete result was deployed on DE. This document
preserves the local preparation record; installed state and initial deliveries
are in the [release record](2026-10-25-hh-three-lane-release.md).

On October 25 fresh HH search and daily full-range reconciliation were implemented
locally. Changes are on `codex/hh-fresh-vacancies`. Nothing was published
to GitHub or deployed to the VPS; migrations 047/048 were applied only in a disposable
PostgreSQL cluster. Installed collection behavior on DE is unchanged. Desktop
and the browser package were not modified; an EXE build is unnecessary.

### Behavior

Fresh vacancies are checked every five minutes with existing queries and filters.
The first run covers one hour; subsequent runs use their own checkpoint with a
one-hour overlap. Downtime retains the entire missed interval. Fresh and backlog
collection and daily reconciliation keep independent progress, share a user lease and use the existing
browser sequentially. Pause, enable, settings changes and current permissions
apply to all lanes. No separate settings, menus, buttons or confirmations were
added.

Runs longer than five minutes prepend a new head while retaining unfinished
windows and visiting newer days first. Even a saturated day permits reading its
first 100 accessible pages but is never declared complete. Above 256 windows or
96 KiB, per-query range unions restart collection without discarding unchecked
time or advancing the checkpoint. This bounds state size at the cost of repeated
reads during prolonged overload. Incomplete-run notices retain one identity
instead of repeating after each head refresh.

Fresh passes allow 12 requests and 15 seconds checked between requests. Historical
runtime passes allow 20 requests and the same 15 seconds. An in-flight request
completes, so a slow HH response can exceed that budget. Bounded passes resume
after ten seconds. The scheduler interleaves users and all three lanes; each tick is
bounded to four users per lane and one minute checked between passes. Currency
rates are shared by all three collectors; no second Chromium process is launched.

Daily reconciliation rereads the entire selected range, 14 days by default,
independently of incremental checkpoints. It finds missed listings and older
publications that HH indexed late. The first cycle is due 24 hours after
installation/search creation, since initial historical collection already fills
the range. Subsequent cycles start 24 hours after the preceding cycle finishes.
Pause preserves progress, resume retains overdue work, and settings changes reset
the cycle and schedule it in one day.

Reconciliation passes allow eight requests and ten seconds checked between
requests, letting the in-flight request finish. They alternate with historical
collection, with fresh work checked before background work. An unusually slow
fresh request leaves a background turn owed on the next tick to avoid starvation.
Transient failures retry within 30 minutes unless Retry-After requires longer.

Inaccessible ranges are summarized by query index. Incomplete cycles do not
advance the last successful full checkpoint; other windows continue and the
whole current range is retried in one day. Summaries for 3000 failed days across
100 queries, plus pending windows with maximum-width UTF-8 queries, were checked
against storage limits. Reconciliation uses normal card priority and shared
deduplication. Incomplete notices keep their existing text and button.

The outbox puts attention notices first, then fresh cards and normal cards.
Unsent queued cards are reread on HH before promotion. Sent/sending/unknown cards
at the same filter revision can skip another detail read. User/vacancy deduplication
remains; uncertain sends are not repeated. Card text/buttons, CAPTCHA handling and
application confirmation remain unchanged.

### Verification

- Full server suite with disposable PostgreSQL: **862/862**, no skips.
- PostgreSQL acceptance, including HTTP, access, CAPTCHA, outbox and four
  Edge → authenticated RPC → collector → PostgreSQL scenarios: **39/39**, no skips.
- Telegram regression gate and callback presentation: **75/75**.
- Covered fresh arrivals during unfinished backlog collection, page resumption,
  transient failures, hourly overlap, downtime, shared filters, stale queued cards,
  attention/fresh priority, sent/unknown, roles and revocation, shared leases and
  progression beyond the first user batch.
- Daily reconciliation covered missed old listings, late indexing, repeated full
  ranges, resumption, daily scheduling, inaccessible gaps, no false checkpoint and
  the oldest date at a 30-day history depth.
- State-size checks ran 1000 refreshes for 100 long queries. Compaction retains
  every unchecked interval. Rejected oversized state is not saved again and the
  lease is released through normal failure handling.
- Independent review was completed. Fresh-search blocking, stale-snapshot promotion
  and progress growth findings were resolved. `git diff --check` passed.

Server dependencies were restored from the existing lockfile for local testing;
package and lockfile contents were unchanged. Browser tests used installed
Microsoft Edge with local HTML fixtures, without contacting actual HH or Bot API.
The disposable cluster was separate from the existing PostgreSQL service.

### Remaining checks

Enabling this requires a separately authorized server/collector release with
migrations 047/048 on DE and normal source synchronization on both VPS hosts. The
job-browser image needs no rebuild. Actual delivery latency, CAPTCHA frequency
and additional VPS CPU/RAM/traffic remain unmeasured. Five minutes is a target:
slow HH responses, CAPTCHA and many queued users can extend it. A day exceeding
2000 vacancies for one query cannot be guaranteed complete.
Listings removed before reading and dates outside the selected depth may also
be missed. At 30-day depth, crossing Moscow midnight during a request can expire
the oldest day; the cycle records an explicit gap and is not marked complete.

Design: [specification](../superpowers/specs/2026-10-25-hh-fresh-vacancies-design.md).
Commands: [HH verification](../verification.md#восстановление-hh-captcha--hh-captcha-recovery).
