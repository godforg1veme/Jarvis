# HH: закрытие страниц и ожидание проверки / Page cleanup and challenge waiting

[Русский](#русский) | [English](#english)

## Русский

### Повторный ремонт установлен на DE

В 22:01 МСК установлен release `2a201a0`: browser и server/collector.
GitHub main, Windows и source обоих VPS совпали. Серверные live/ready дали 200;
server/browser healthy, restart=0. Env, mounts, bind inodes, ресурсные и
security-параметры сверены до и после; остальные службы не пересоздавались.
Desktop не изменялся. Release-status подтверждает оба VPS и 388 server-файлов;
единственное прежнее расхождение — один неиспользуемый shared-файл Desktop.

Код `a95218e` устраняет два воспроизведённых случая в Playwright 1.64.0:
маршрут страницы остаётся до первого terminal call после закрытия target;
обработанный маршрут остаётся при ошибке continue/abort/fulfill. Небольшой
build-time patch удаляет только маршруты конкретной закрытой страницы и
выполняет terminal bookkeeping в finally. Сборка проверяет точную версию и
SHA-256 исходного и итогового bundle; несовпадение останавливает сборку.
Проверка ветви future handler до разрешённого continue сохранена.

Отдельный локальный сценарий выявил гонку закрытия страницы с периодическим
POST: window.stop не убирает таймеры документа. Общий helper теперь загружает
свежий about:blank до load при действующих guards, затем закрывает target.
Даже документ с URL about:blank заменяется заново. Неудачная навигация
завершает runtime без прямого закрытия живого документа; при подтверждённом
isClosed потеря ACK закрытия не считается новой неизвестной отправкой.
Во время штатной остановки сначала завершается текущая health probe.
Доказательство отклика сохраняется до ошибки последующей очистки.
Если renderer уже упал и отказывается от навигации, требуется перезапуск
browser с прежним журналом. Проверка same-process refresh заменена проверкой
восстановления после перезапуска; crash coverage сохранён.

На канонической сборке из Git archive проверено:

- Linux browser 151/151, native/driver/journal 11/11, три runtime acceptance
  на образе для выпуска с LF. Первая сборка из Windows archive содержала
  CRLF; проверка shell fixture это выявила. Повторный source archive создан
  с core.autocrlf=false. Код HH и patched bundle при этом не менялись.
- 1 000 закрытий с периодическим POST: заблокировано 1 665 попыток,
  до локального сервера дошло 0 POST. Это изолированный fixture, не запросы HH.
- Сквозной Telegram-handler → PostgreSQL intent → RPC → Chromium → journal:
  сохранён точный исходный отклик, потеря ответа и restart не создают второй POST.
- Часовой delayed-GET soak 16:45:26–17:45:42 МСК: 10 115 циклов,
  routes=0, clientObjects=16, fatal=0; post-GC heap 44 → 45 MiB,
  промежуточные значения 45–46 MiB.
- Точный LF образ для установки дополнительно прошёл 30 минут
  17:15:33–17:45:52 МСК: 5 016 циклов, те же нулевые counters,
  heap 44 → 44 MiB. Проверены 58 browser-файлов, включая package/patch,
  и 388 server-файлов; bundle имеет ожидаемый SHA-256.

Код `d7bc189` также распространяет существующую 15-минутную паузу на
временную недоступность HH, rate limit, занятый браузер и необходимость входа
до модели. Исходная vacancy остаётся pending; модель и отправка не вызываются.
После начала модели или отправки unknown и исходные ID сохраняются.
Уведомление о входе прежнее; доступ и согласие проверяются заново при повторе.
Проверено: worker 20/20, server 945 passed и 2 DB-only skipped;
независимая ревизия не нашла обхода согласия или повторной отправки.
Полный серверный набор повторно прошёл на Linux и Node 22 рабочего образа.
Отдельный набор с PostgreSQL прошёл 12/12, включая оба DB-only случая
серверного набора. Он проверил личное выбранное резюме, паузу, возврат той же
строки/ID и остановку после отзыва согласия. Прошли четыре CAPTCHA-сценария;
один сценарий с внешней frozen OCR-моделью пропущен без её артефакта.

Ниже сохранён первый частичный этап, остаточное удержание которого
и потребовало повторного ремонта.
В 17:29–17:31 МСК три read-only чтения HH прошли без POST; полный снимок
выбранного резюме прочитан по настоящему RPC, заполнены все пять полей.
Ручная пауза стала idle; auto off, revision 24. Это не подтверждает новый
отклик. Доступность HH к моменту установки проверена отдельно ниже.

Свежая проверка в 22:03 МСК остановила живой auto-test до включения:
manual active, CAPTCHA от 21:09:43 МСК дала 403 ещё до установки,
automatic human, claims=2.
Переключатель остался off, revision 24; отправки в этом тесте не начинались.
Ошибка первого Python launcher теста исправлена до включения автоматики;
затем фактической причиной остановки был JOB_HH_MANUAL_ACTIVE.
Человеку запрошена текущая проверка в Telegram. Отдельное наблюдение runtime
в 22:04:40–22:14:40 МСК прошло: 600 секунд, 21 замер, 0 перезапусков,
0 закрытых/неизвестных routes, heap 47–64 MiB без принудительного GC.
Server/browser healthy, live/ready 200; за окно после установки нет новых
applications или model usage. Off, revision 24 сохранён. Это наблюдение сервиса
при CAPTCHA-паузе; успешный живой отклик после выпуска не подтверждён.
Исходный VK остаётся unknown с шестью сверками, повторного POST не было.

### Первый этап и обнаруженное ограничение

**Дополнение в 06:50 МСК:** новый счётчик обнаружил один route закрытой
страницы при active=0. Очистка window.stop не закрывает все случаи.
Полное исправление памяти не подтверждено; ниже сохранены результаты
уже выпущенного частичного ремонта. Продолжается ремонт bookkeeping
закрытых страниц и ошибок terminal route в Playwright.

Результат продолжает [расследование 5 ноября](2026-11-05-hh-runtime-reopened.md).
Общий ремонт памяти `f543cc4` установлен в job-browser на DE 6 ноября.
На первом этапе browser `b6ede63` дополнительно различает маршруты закрытых страниц,
активную загрузку и неизвестную принадлежность; отправку это не меняет.
Он действует для владельца и подключённых аккаунтов. Разрешения, выбранные
резюме, фильтры, claims и журнал исходных операций сохранены.

В Playwright 1.64 закрытие страницы с незавершёнными HTTP-запросами удерживает
server routes в persistent context. На диагностическом выпуске счётчик вырос
0 → 49 → 99, последний замер был без активных операций; ночью browser ещё
дважды завершился с heap OOM. Кэш APIResponse и WebSocketRoute были пусты.
Прежнее исправление WebSocket оставалось необходимым, но не закрывало HTTP.

Первый вариант общей очистки останавливал оставшиеся ресурсы через window.stop,
затем закрывал страницу. Обе стадии ограничены по времени. Очистка идёт
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
- Новые числовые счётчики прошли Linux unit/runtime 4/4 и положительный
  контроль: все 971 удержанный route старого close распознаны как closed,
  unknown=0. Повторный 100-cycle helper test оставил routes=closed=unknown=0,
  post-GC heap=44 MiB. Значения URL, headers и содержимое страниц не выводятся.

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
Первый часовой fixture не воспроизвёл остаточное удержание, которое позднее
обнаружил рабочий closed-page counter. Его результат не доказывает полный ремонт.

## English

### Second repair installed on DE

Release `2a201a0` was installed at 22:01 Moscow time: browser and server/collector.
GitHub main, Windows and both VPS source checkouts matched. Server live/ready
returned 200; server/browser were healthy with zero restarts. Environment, mounts,
bind inodes, resource limits and security settings matched before and after;
other services were not recreated. Desktop was unchanged. Release-status verified
both VPS and 388 server files; the sole existing difference is one unused shared
file in the installed Desktop.

Code `a95218e` fixes two reproduced Playwright 1.64.0 cases: a page route remains
before its first terminal call when the target closes, and a handled route remains
when continue/abort/fulfill fails. A small build-time patch removes only the exact
closed page's routes and finishes terminal bookkeeping in finally. The build checks
the exact version and input/output bundle SHA-256; a mismatch stops the build.
Future-handler validation before an allowed continue remains unchanged.

A separate local fixture exposed page-close races with periodic POST requests:
window.stop leaves document timers alive. Shared cleanup now loads a fresh
about:blank through load while guards remain active, then closes the target.
Even a document already at about:blank is replaced. Failed navigation exits the
runtime without directly closing a live document; confirmed isClosed prevents a
lost close ACK from being mistaken for a new uncertain submission. Normal shutdown
awaits the current health probe. Application proof is persisted before escalating
subsequent cleanup failure.
An already crashed renderer that refuses navigation requires a browser restart
with the existing journal. The old same-process refresh assertion now checks
recovery after restart and retains crash coverage.

Canonical Git-archive build validation:

- Linux browser 151/151, native/driver/journal 11/11 and three runtime acceptances
  on the LF release image. The first Windows archive exported CRLF, detected by
  a shell fixture. The source archive was recreated with core.autocrlf=false;
  HH logic and the patched bundle did not change.
- 1,000 closures with periodic POSTs blocked 1,665 attempts; zero POSTs reached
  the local server. This is an isolated fixture, with no HH requests.
- Full Telegram handler → PostgreSQL intent → RPC → Chromium → journal preserved
  the exact original application; lost acknowledgement and restart never added
  a second POST.
- Hour-long delayed-GET soak at 16:45:26–17:45:42 Moscow time: 10,115 cycles,
  zero retained routes, 16 client objects and zero fatal events; post-GC heap
  44 → 45 MiB, with intermediate samples at 45–46 MiB.
- The exact LF image intended for installation also passed 30 minutes at
  17:15:33–17:45:52 Moscow time: 5,016 cycles, the same zero counters,
  heap 44 → 44 MiB. All 58 browser files including package/patch and 388 server
  files matched source; the patched bundle matched its expected SHA-256.

Code `d7bc189` also extends the existing 15-minute backoff to temporary HH failure,
rate limiting, a busy browser and required sign-in before model invocation.
The original vacancy stays pending, with no model call or submission. After a
model or submission begins, unknown and original IDs remain protected. Existing
sign-in attention is preserved; each retry rechecks access and consent. Validation:
worker 20/20, server 945 passed with two DB-only skipped; independent review found
no consent bypass or duplicate-submission path.
The full server suite also passed on Linux and the production image's Node 22.
The separate PostgreSQL suite passed 12/12, including both DB-only cases skipped
by the full server suite. It verified the personal selected resume, the pause,
reclaiming the same row/request ID, and stopping after consent revocation.
Four additional CAPTCHA scenarios
passed; one requiring an external frozen OCR model was skipped without its artifact.

The first partial stage remains below; its residual retention required this
second repair.
At 17:29–17:31 Moscow time, three read-only HH reads passed without POSTs;
the full selected resume was read through real RPC with all five fields populated.
Manual pause became idle; automation remained off at revision 24. This does not
confirm a new application. HH availability at installation was checked again below.

The fresh 22:03 Moscow-time check stopped the live auto-test before enabling:
manual active, the CAPTCHA at 21:09:43 Moscow time returned 403 before installation,
automatic human, two claims.
Automation stayed off at revision 24; this test never started a submission.
The first test Python launcher's error was fixed before enabling automation;
the actual subsequent gate was JOB_HH_MANUAL_ACTIVE. A current Telegram human
check was requested. The separate runtime watch at 22:04:40–22:14:40 Moscow time
passed: 600 seconds, 21 samples, zero restarts, zero closed/unknown-page routes,
heap 47–64 MiB without forced GC. Server/browser remained healthy, live/ready
returned 200, and no new applications or model usage appeared after installation.
Automation stayed off at revision 24. This observes the service during CAPTCHA
pause; a successful live application after release is unconfirmed. The original
VK operation remains unknown after six reconciliations, without another POST.

### First stage and discovered limitation

**Update at 06:50 Moscow time:** the new counter found one closed-page route
with active=0. The window.stop cleanup does not cover every case. A complete
memory repair is unconfirmed; the deployed partial repair results remain below.
Playwright bookkeeping cleanup for closed pages and terminal route failures
is being repaired.

This continues the [November 5 investigation](2026-11-05-hh-runtime-reopened.md).
Shared memory repair `f543cc4` was installed in the DE job-browser on November 6.
At the first stage, browser `b6ede63` additionally distinguishes closed-page routes, active
loads and unknown page ownership, without changing submission behavior.
It covers the owner and connected accounts. Permissions, selected resumes,
filters, claims and original-operation journals were preserved.

In Playwright 1.64, closing a page with unfinished HTTP requests retains server
routes in the persistent context. Diagnostic counters grew 0 → 49 → 99, with
no active operation in the last sample; overnight the browser had two further
heap OOM crashes. APIResponse caches and WebSocketRoute were empty. The earlier
WebSocket fix remained necessary but did not address HTTP retention.

The first shared cleanup stopped remaining resources with window.stop, then closed
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
- New numeric counters passed Linux unit/runtime 4/4 and a positive control:
  all 971 retained direct-close routes were classified closed, with zero
  unknown page owners. A repeat 100-cycle helper test left routes=closed=unknown=0
  and 44 MiB post-GC heap. URLs, headers and page contents are never printed.

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
first hour-long fixture did not reproduce residual retention later detected by
the production closed-page counter. That result does not establish a complete repair.
