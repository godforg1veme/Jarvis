# Свежие вакансии HH / Fresh HH vacancies

## Русский

Согласовано пользователем 25 октября: добавить поиск новых вакансий по тем же
запросам и фильтрам, сохранив Telegram-бот и его интерфейс. Свежие вакансии
проверяются каждые пять минут независимо от незавершённого обхода прошлых дней.

Два прохода используют существующий браузер последовательно. У каждого свои
checkpoint, progress и срок следующего запуска; lease пользователя общий.
Начальный свежий проход охватывает последний час. Последующие проходят от
своего checkpoint с часовым перекрытием до зафиксированного начала прохода.
После простоя диапазон начинается от checkpoint: ограничение последним часом
не отбрасывает пропущенное время. Верхняя отметка продвигается только после
полного обхода всех запросов и страниц. Если проход не завершён за пять минут,
перед сохранёнными окнами появляется новая верхняя часть выдачи. `headUntil`
хранит её границу, а исходный `until` сохраняет идентичность уведомления.
Календарное разбиение МСК сохраняется, свежие дни идут первыми. Насыщенный день
позволяет прочитать доступные первые 100 страниц, но остаётся незавершённым.

При более 256 окнах или 96 КиБ прогресс консервативно уплотняется: все оставшиеся
интервалы одного запроса объединяются в покрывающий диапазон с повторным обходом.
Непроверенное время сохраняется; checkpoint не продвигается. Обычные offsets
сохраняются между проходами. Следующая свежая проверка начинает с очередного
незаконченного запроса, чтобы длинный список не всегда начинался с первой фразы.

Свежему проходу выделяются до 12 запросов и 15 секунд между запросами; текущий
запрос не прерывается. Продолжение ограниченного прохода назначается через
10 секунд. Планировщик чередует короткие свежие проходы с проходами истории,
перечитывая готовность свежих перед каждым пользователем истории. Один tick
ограничен по числу обслуживаемых пользователей, чтобы новые проверки не ждали
обхода всех ста пользователей. Пять минут — целевой интервал, не SLA HH.

Уже подходящие вакансии той же revision фильтров пропускают повторное чтение
описания только для sent/sending/unknown карточек. Queued карточки перечитываются
перед повышением приоритета; ранее исключённые вакансии также читаются снова:
ID сам по себе не доказывает неизменность текста. Общая outbox сохраняет dedup по пользователю
и вакансии. Свежие queued карточки идут раньше обычных; attention остаётся
первым. Sent, sending и unknown не переотправляются и не меняют состояние.

Пауза и отзыв jobs останавливают оба прохода. Настройки общие; новая настройка
сбрасывает незавершённый свежий проход и его отметку. CAPTCHA и неопределённые
результаты сохраняют существующую процедуру, без повторной отправки ответа.
Уведомление о неполном сборе проверяет прогресс именно своего прохода.
Новых кнопок, callbacks, guided kinds, прав и production-зависимостей нет.

Миграция 047 только добавляет поля свежего прогресса и приоритет доставки.
Проверки: независимость двух отметок при restart/ошибке, свежая вакансия во
время старого обхода, перекрытие и pagination, общий lease, revision/pause/access,
очередь и unknown, справедливость планировщика. Реальный PostgreSQL используется
только в отдельном тестовом кластере. Нагрузка и свежесть настоящего HH проверяются
после отдельно порученного выпуска; локальные fixtures их не подтверждают.

### Дополнение: ежедневная сверка

Пользователь дополнительно согласовал повторный полный обход выбранного периода.
Третий проход `reconcile` использует общие queries/filters и существующий браузер,
но отдельные `reconciliation_checkpoint`, `reconciliation_progress` и
`reconciliation_next_check_at`. Общий lease исключает одновременную работу трёх
проходов одного пользователя. Migration 048 добавляет только эти поля и индекс.

Первая сверка назначается через 24 часа после установки/создания поиска: начальный
общий сбор уже читает весь период. Новый цикл всегда начинает от текущего времени
минус `historyDays`, игнорируя последний успешный checkpoint как нижнюю границу.
Полный успешный цикл назначает следующий через 24 часа после завершения. Пауза
сохраняет прогресс, включение не откладывает просроченную сверку, изменение фильтров
сбрасывает её прогресс и назначает новый цикл через сутки.

Одна порция сверки ограничена восемью запросами и десятью секундами между запросами.
Планировщик чередует обычный сбор и сверку; перед каждой фоновой порцией проверяет
свежие вакансии. Полная сверка не повышает приоритет старых карточек, а общая outbox
не повторяет sent/sending/unknown. Описание перечитывается, чтобы снова применить
текущие фильтры и найти ранее не попавшую в базу вакансию.

Временный сбой сохраняет страницу и повторяется не позднее чем через 30 минут
(с учётом Retry-After); лимит порции даёт продолжение через десять секунд. Неизвлекаемые
насыщенные/изменившиеся/просроченные окна обходятся по очереди с остальными. После
обработки доступных окон такой цикл хранит компактные сводки пробелов по индексам
запросов в `gaps` и `cycleFinished:true`,
не меняет последний успешный checkpoint и назначает новую полную попытку через сутки.
Следующий цикл снова читает весь актуальный период, поэтому один проблемный день
не останавливает ежедневную сверку остальных дней. Старый raw progress хранит результат
до начала следующего цикла; alias progress при новой claim пустой.

Уведомление о неполноте использует тот же текст/кнопку, отдельный lane и один ключ
на цикл. Подтверждения, Telegram UI, доступ, CAPTCHA и исходный чат прежние.
Повторная сверка уменьшает риск пропусков, но не гарантирует чтение удалённых вакансий,
периода за выбранной глубиной и результатов за ограничением HH.

Для 30-дневной глубины календарный запрос передаёт момент конца того же начального
дня МСК, не меняя дату запроса и исходную точную границу фильтра. Это устраняет
обычное истечение browser age guard во время RPC. При пересечении полуночи самый
старый день всё же может стать недоступным; это сохраняется как явный пробел.

## English

Approved by the user on October 25: add fresh vacancy collection using the same
queries and filters, retaining the Telegram bot and its interface. Fresh searches
run every five minutes independently of unfinished historical collection.

Both lanes use the existing browser sequentially, with separate checkpoints,
progress and due times, and one shared per-user lease. The first fresh run covers
one hour; later runs begin one hour before their own checkpoint and retain the
whole missed range after downtime. Each run freezes its upper bound. Checkpoints
advance only after all queries and pages complete. Incomplete runs prepend a new
head every five minutes, recording its bound in `headUntil` while retaining the
original `until` as the notice identity. Moscow calendar splitting remains, with
newer days first. Saturated days permit reading their first 100 accessible pages
but remain incomplete. Above 256 windows or 96 KiB, per-query unions retain every
unchecked interval and restart those cursors without advancing the checkpoint.
Ordinary cursors survive between passes; head refresh starts with the next pending
query so a long query list does not always restart with the first phrase.

Fresh passes allow 12 requests and a 15-second budget checked between requests;
an in-flight request completes. Bounded passes resume after ten seconds. The
scheduler interleaves fresh and historical passes and rechecks fresh work before
each historical user, with a bounded user batch. Five minutes is a target, not
an HH service guarantee.

Already matched vacancies at the same filter revision skip another detail read
only for sent/sending/unknown cards. Queued cards are reread before promotion;
excluded vacancies are read again because an ID cannot prove unchanged content.
The shared outbox keeps
user/vacancy deduplication. Fresh cards precede normal queued cards; attention
remains first. Sent, sending and unknown deliveries are never replayed.

Pause and jobs revocation apply to both lanes. Settings changes reset fresh
progress/checkpoint. Existing CAPTCHA handling and uncertain-outcome safeguards
remain. Incomplete-collection notices validate their own lane's saved run.
There are no new controls, callbacks, guided kinds, permissions or dependencies.

Forward-only migration 047 adds fresh state and delivery priority. Tests cover
independent progress/restarts, fresh arrivals during backlog collection, overlap,
pagination, shared leases, revision/pause/access, delivery priority/unknown and
scheduling fairness. PostgreSQL checks use a disposable local cluster only.
Actual HH freshness and VPS resource impact require a separately authorized
release and live observation; fixtures do not establish those results.

### Addition: daily reconciliation

The user also approved a full recurring scan of the selected history range. A
third `reconcile` lane uses shared filters/browser and independent
`reconciliation_checkpoint`, `reconciliation_progress` and
`reconciliation_next_check_at`, retaining one shared user lease. Migration 048
adds only these fields and a due index. The first scan is due after 24 hours;
initial historical collection already covers the selected range. Every new cycle
starts at current time minus `historyDays`, ignoring its successful checkpoint as
a lower bound. A completed cycle schedules the next 24 hours after completion.
Pause preserves progress, resume retains overdue work, and settings edits reset
progress and schedule another cycle in one day.

Passes allow eight requests and ten seconds checked between requests. Historical
collection and reconciliation alternate, with fresh work checked before each
background pass. Reconciliation rereads descriptions using current filters and
keeps normal card priority and existing sent/sending/unknown deduplication.

Transient failures retain cursors and retry within 30 minutes unless Retry-After
requires more; bounded passes resume in ten seconds. Inaccessible saturated,
changed or expired windows do not prevent processing other windows. After all
accessible work is attempted, an incomplete cycle retains compact per-query-index gap summaries in `gaps` and
`cycleFinished:true`, does not advance the last successful checkpoint, and
schedules another full attempt in one day. The next claim aliases progress to
null for a new full range; raw gap state remains until that cycle starts.

Incomplete notices retain the same text/button and one identity per lane/cycle.
UI, access, CAPTCHA and confirmation boundaries remain unchanged. Rescans reduce
misses but cannot guarantee deleted vacancies, dates outside the selected depth
or results beyond HH's accessible limit.

At 30-day depth the calendar transport uses the end of the same oldest Moscow day,
preserving both the requested date and the original exact filter bound. This avoids
ordinary RPC age expiry. Crossing midnight can still expire that oldest day; the
cycle records an explicit gap rather than claiming completion.
