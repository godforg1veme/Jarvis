# HH: закрытие страниц и ожидание проверки / Page cleanup and challenge waiting

[Русский](#русский) | [English](#english)

## Русский

Результат продолжает [расследование 5 ноября](2026-11-05-hh-runtime-reopened.md).
Общий ремонт памяти `f543cc4` установлен в job-browser на DE 6 ноября.
Он действует для владельца и подключённых аккаунтов. Разрешения, выбранные
резюме, фильтры, claims и журнал исходных операций сохранены.

В Playwright 1.64 закрытие страницы с незавершёнными HTTP-запросами удерживает
server routes в persistent context. На диагностическом выпуске счётчик вырос
0 → 49 → 99, последний замер был без активных операций; ночью browser ещё
дважды завершился с heap OOM. Кэш APIResponse и WebSocketRoute были пусты.
Прежнее исправление WebSocket оставалось необходимым, но не закрывало HTTP.

Общая очистка теперь останавливает оставшиеся ресурсы через window.stop,
затем закрывает страницу. Обе стадии ограничены по времени. Очистка идёт
после результата операции, сохраняет контекстные guards и помечает неудачный
runtime unhealthy. При сверке доказанный результат сначала сохраняется
в ledger; сбой последующей очистки не должен терять подтверждение.

Проверки:

- Linux browser: 146/146; native HTTP, отправка, lost acknowledgement,
  восстановление, durable journal и поднятие резюме: 16/16.
- Три runtime acceptance: запуск с sandbox, ручной broker и восстановление
  после принудительной потери Chromium. Два старых fixture приведены к уже
  действующим userId и числовым memory-log контрактам.
- Один час с локальными delayed GET и health probes: 8 919 циклов,
  retainedRoutes=0, clientObjects=16, fatal=0 во всех контрольных точках.
  Heap после GC: warmup 44 MiB, checkpoints 45–46 MiB, final 44 MiB.
  Прямой close в коротком Linux baseline оставлял 1 524 routes за 100 циклов.
- Независимая ревизия нашла пропущенный consumer поднятия резюме; он исправлен.
  Окружение и mounts сверены без вывода значений, 57 browser-файлов совпали
  с опубликованным source. Desktop не изменялся.

Живой тест начат в 06:26:44 МСК и остановлен до новых отправок: owner manual
coordinator был active, предыдущая CAPTCHA дала HTTP 403 и осталась на экране.
Cookie/token совпадали; картинки не были старыми. Это не устанавливает,
почему HH отклонил запрос: неверный ответ, серверная защита и транспорт
не различены. Неопределённая CAPTCHA-попытка повторно не отправлялась.
Первый тест остановлен с off, revision 22. После проверки исправленной паузы
итоговый переключатель — off, revision 24. Требуется текущая проверка человека
в Telegram, затем отдельный живой тест успешного отклика.

Тест также выявил отдельный дефект до обращения к модели: ожидающая CAPTCHA
помечала вакансии failed по одной. Исправление `93eed34` сохраняет item pending
и делает origin/revision-bound паузу 15 минут. Вызова модели и отправки нет.
После уже начатой модели/отправки защита unknown и исходного ID сохраняется.
Проверки: 18 worker tests, server 943 passed, 2 DB-only skipped. Server и collector
`93eed34` установлены на DE; образ server сверён по 386 файлам. Живая проверка
в 06:38:09–06:38:24 МСК: один pending с JOB_HH_MANUAL_ACTIVE, next_attempt_at
более чем на 14 минут впереди, 0 model calls и 0 applications. Личный off
восстановлен через revision CAS. Накопленные до ремонта 47 failed до модели
остаются историей теста; их не выдаём за отправленные отклики.

Политика анкет подтверждена владельцем: личный опыт берётся из подтверждённых
сведений резюме; если данных для обязательного ответа не хватает, отправки нет.
Поэтому CRM 138563100 — ожидаемая остановка. VK 138448900 остаётся unknown:
старый HTTP status не сохранён, точного доказательства отправленного письма
нет. Исходная операция не переотправлялась; шесть попыток сверки сохранены.

Успешный живой автоотклик после этого ремонта пока не подтверждён.
Часовой тест доказывает исправление воспроизведённого удержания маршрутов,
но не гарантирует отсутствие любых будущих OOM или отказов HH.

## English

This continues the [November 5 investigation](2026-11-05-hh-runtime-reopened.md).
Shared memory repair `f543cc4` was installed in the DE job-browser on November 6.
It covers the owner and connected accounts. Permissions, selected resumes,
filters, claims and original-operation journals were preserved.

In Playwright 1.64, closing a page with unfinished HTTP requests retains server
routes in the persistent context. Diagnostic counters grew 0 → 49 → 99, with
no active operation in the last sample; overnight the browser had two further
heap OOM crashes. APIResponse caches and WebSocketRoute were empty. The earlier
WebSocket fix remained necessary but did not address HTTP retention.

Shared cleanup now stops remaining resources with window.stop, then closes
the page, with a deadline for each stage. Cleanup follows the operation result,
preserves context guards and marks a failed runtime unhealthy. Reconciliation
persists established proof to the ledger before escalating cleanup failure.

Validation:

- Linux browser: 146/146; native HTTP, submission, lost acknowledgement,
  recovery, durable journal and resume raising: 16/16.
- Three runtime acceptances covered sandboxed startup, the manual broker and
  recovery after forced Chromium loss. Two stale fixtures now match the
  existing userId and numeric memory-log contracts.
- One hour of local delayed GET and health probes: 8,919 cycles, zero retained
  routes, 16 client objects and zero fatal events at every checkpoint. Post-GC
  heap: 44 MiB warmup, 45–46 MiB checkpoints, 44 MiB final. Direct close retained
  1,524 routes over 100 cycles in the short Linux baseline.
- Independent review found the omitted resume-raise consumer; it was repaired.
  Environment and mounts matched without printing values; 57 browser files
  matched published source. Desktop was unchanged.

The live test began at 06:26:44 Moscow time and was stopped before any new
submissions: the owner's manual coordinator was active after a previous
CAPTCHA returned HTTP 403 and remained visible. Cookie/token matched and the
image was fresh. This does not establish why HH rejected the request: answer
correctness, server protection and transport remain undistinguished. The
uncertain CAPTCHA attempt was not repeated. The first test restored off at
revision 22; after validating the repaired backoff, the final setting is off,
revision 24. A current human check in Telegram is needed before a separate
successful live application test.

The test also exposed a pre-model defect: waiting for CAPTCHA marked vacancies
failed one by one. Repair `93eed34` keeps the item pending and applies an
origin/revision-bound 15-minute backoff, without calling a model or submitting.
After a model or submission has started, unknown/original-ID protection stays.
Validation: 18 worker tests, server 943 passed and two DB-only skipped. Server
and collector `93eed34` are installed on DE; the server image matched 386 files.
Live validation at 06:38:09–06:38:24 Moscow time produced one pending item with
JOB_HH_MANUAL_ACTIVE, next_attempt_at more than 14 minutes ahead, zero model
calls and zero applications. Personal off was restored through revision CAS.
The 47 pre-model failed items from before the repair remain test history and
are not reported as sent applications.

The owner confirmed questionnaire policy: personal experience uses confirmed
resume facts; missing information for a required answer stops submission.
CRM 138563100 is therefore an expected stop. VK 138448900 remains unknown: its
old HTTP status was not retained and exact sent-letter proof is unavailable.
The original operation was not repeated; its six reconciliation attempts remain.

A successful live application after this repair is not yet confirmed. The
hour-long test establishes the reproduced route-retention repair, without
guaranteeing that every future OOM or HH rejection has been eliminated.
