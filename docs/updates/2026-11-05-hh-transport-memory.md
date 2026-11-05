# HH: транспорт квитанции и память / Receipt transport and memory

[Русский](#русский) | [English](#english)

## Русский

Более новый результат: [повторное расследование](2026-11-05-hh-runtime-reopened.md). После этого окна обнаружены ещё четыре heap OOM; вывод о полном исправлении памяти отозван. Результат окна ниже сохраняется как история.

### Причины и ремонт

Предыдущий живой тест локализовал сбой первичной квитанции в Chromium
`response.body()`: отклик был принят, но подтверждался только последующим GET.
Точное старое исключение не сохранялось. Новый путь отправляет единственный
проверенный запрос через `route.fetch` без редиректов и сетевых повторов.
Квитанция читается из исходного APIResponse, освобождаемого в `finally`.
Синтетический 204 браузеру не является доказательством отправки. Проверки
вакансии, выбранного резюме, точного письма и ответов анкеты сохранены.
Неопределённая операция по-прежнему не допускает другого POST.

В сохранённых логах перезапусков обнаружен V8 fatal heap OOM. Перед аварией
major GC оставлял около 505 MiB живой кучи при пределе около 512 MiB.
Локальный контроль воспроизвёл удержание WebSocketRoute в Playwright 1.64:
контекстная блокировка WebSocket сохраняет channel после закрытия страницы.
На 200 WS-страницах с 200 health probes число объектов выросло 16→216;
без WS осталось 16. С page-scoped блокировкой и контекстной защитой для
остальных окон объекты остались 16, WebSocketRoute после закрытия — 0.

`newGuardedPage` устанавливает запрет WS до навигации и закрывает страницу
при ошибке установки. Через него создаются рабочие страницы чтения/входа,
CAPTCHA/проверки и health probes. Контекстный запрет сохранён для прочих окон.
Предел контейнера 1 GiB не увеличен. Диагностика раз в пять минут пишет только
округлённые числовые показатели памяти, страниц/очереди и объектов Playwright;
cookie, URL, содержимое HH, сырые исключения и heap dumps не сохраняются.

### Проверки до публикации

Server: 941 passed, 2 DB-only skipped. Linux/Chromium: 143/143 без пропусков.
PostgreSQL/RPC: 21/21. Реальный локальный HTTPS fixture проверил исходную
квитанцию и cookies, HTTP 307 без перехода, потерю соединения без retry,
стандартный application driver и ledger replay без повторного запроса.
Browser runtime startup и fatal/restart прошли отдельно на пустых профилях.
Устаревший negative assertion для валидного member UUID воспроизвёлся на
прежнем образе; тест исправлен на невалидный UUID, без изменения runtime прав.
Независимые security и общая ревизии не нашли подтверждённых дефектов.

30-минутный изолированный soak завершён: 8 218 WS-страниц и столько же health
probes, 16 объектов на выходе, 0 оставшихся WebSocketRoute, 0 реальных upgrade,
45 MiB JS heap после GC. Контроль прежнего способа на том же Linux/Chromium:
100 страниц → 116 объектов, из них 100 удержанных WebSocketRoute.
Лимит контейнера в обоих случаях 1 GiB; GC принудительно вызывался только
в детерминированном тесте. Код `168d8230264964d81ff4b7ed6dfe166b35730f49` опубликован, source Windows/DE/NL
синхронизирован. На DE установлен immutable release
`/home/deploy/releases/jarvis-168d823-hh-transport-memory`:
`jarvis-hh-transport-server:168d823` для server/collector,
`jarvis-hh-transport-browser:168d823` для браузера. Source guard прошёл на всех
узлах, окружение и mounts совпали до/после установки. Профиль HH и секреты
сохранены; 386 server/shared и 56 browser/shared файлов совпали с source.
Новый browser image прошёл ещё 9/9 профильных проверок. Новая миграция не нужна.
Desktop не менялся; прежнее отсутствие одного неиспользуемого shared-файла
в EXE остаётся единственным замечанием общей release-проверки.

Живое 30-минутное окно начато 5 ноября в 07:07:09 МСК, срок до 07:37:09 МСК.
Исходное состояние владельца off; включён только его штатный JobAutomationService
с текущими scope, правами, резюме и revision. Установлен автоматический возврат
в off при неизменной revision владельца. Другие аккаунты не включались.
На старте Node heap 46 MiB, Playwright objects 16, WebSocketRoute 0;
server/browser healthy, restart count всех трёх новых контейнеров 0.
Окно завершилось автоматически в 07:37:09 МСК, off восстановлен, revision 18.
Обработано 120 элементов: 4 новых обычных отклика, 113 пропусков оценки/фильтра,
2 ручные остановки из-за недостающих данных кандидата и 1 отмена при выключении.
Все четыре application records имеют sent, исходную квитанцию HH и
reconciliation_attempts=0. В каждой паре ledger ровно один claim, одна operation
и один sent result. Новых unknown, ошибок квитанции или повторных отправок нет.
Вакансии: 139136698, 138531975, 139138141, 139138865.

113 пропусков: 65 OUT_OF_DIRECTION, 38 UNCERTAIN, 4 INSUFFICIENT_FIT,
6 до оценки моделью. Для двух ручных остановок сохранены закрытые причины
JOB_HH_ANSWER_UNAVAILABLE и JOB_APPLICANT_ANSWER_REQUIRED; application не создана.
Последний item ещё был submitting в момент off, затем стал skipped/preparation/
JOB_AUTOMATION_UNAVAILABLE с пустым operation ID и нулём application records.
Так живая проверка подтвердила и ремонт классификации отмены. Активных items
окна после завершения нет. Учтено 122 модельных запроса на $0.06078095,
неизвестных сумм нет.

За окно server/browser healthy, collector running, у всех трёх restart count 0,
OOMKilled=false; новых fatal heap OOM нет. Семь числовых выборок показали
JS heap 46–152 MiB под обычным GC; принудительный GC в production не вызывался.
WebSocketRoute=0 во всех выборках. В последней выборке простоя: 1 пустая страница,
0 активных/ожидающих операций, 21 объект Playwright, 0 Response, 0 WebSocketRoute.
Это отдельное свидетельство от изолированного soak с GC и не подменяет его.

Успешная новая живая нативная анкета в окно не встретилась; её wire-путь
проверен Chromium fixtures. Код общий для аккаунтов, но живой тест выполнялся
только в личном scope владельца. Старые неоднозначные операции не переотправлялись.
Временные тестовые контейнеры/БД/сети/staging удалены; наблюдатель после завершения
удалён, новые автоматизации/таймеры обслуживания не устанавливались.

## English

Newer result: [reopened investigation](2026-11-05-hh-runtime-reopened.md). Four later heap OOM crashes invalidate the conclusion that memory was fully repaired. The observation below is preserved as history.

### Causes and repair

The previous live test localized initial receipt failure to Chromium's
`response.body()`: HH accepted the application, but a later GET established
proof. The exact old exception was not retained. The new path sends the single
validated request through `route.fetch` with zero redirects/network retries.
Receipt verification reads the original APIResponse, disposed in `finally`.
The synthetic browser-facing 204 is not proof. Vacancy, selected resume, exact
letter and questionnaire answer checks remain. An uncertain operation still
cannot authorize another POST.

Retained restart logs showed V8 fatal heap OOM. Major GC left approximately
505 MiB of live heap before failure, near a 512 MiB limit. A local control
reproduced Playwright 1.64 WebSocketRoute retention: a context-level WebSocket
block retains its channel after page closure. Across 200 WS pages and 200 health
probes, object count grew 16→216; without WS it stayed 16. With page-scoped
blocking plus the context backstop, count stayed 16 and closed-page
WebSocketRoute count was 0.

`newGuardedPage` installs the WS block before navigation and closes the page
if registration fails. It creates managed reading/login, CAPTCHA/verification
and health pages. The context block remains for other windows. The 1 GiB
container limit was not increased. Every five minutes, diagnostics emit only
rounded numeric memory/page/queue/Playwright counts; no cookies, URLs, HH
contents, raw exceptions or heap dumps are retained.

### Pre-publication verification

Server: 941 passed, two DB-only skipped. Linux/Chromium: 143/143 without skips.
PostgreSQL/RPC: 21/21. A real local HTTPS fixture checked the original receipt
and cookies, HTTP 307 without following, dropped connections without retries,
the default application driver and ledger replay without another request.
Browser runtime startup and fatal/restart checks passed separately on empty
profiles. A stale negative assertion for a valid member UUID also failed on
the previous image; it now checks an invalid UUID, without changing runtime
permissions. Independent security and general review found no confirmed defect.

The 30-minute isolated soak completed: 8,218 WS pages and as many health
probes, 16 final objects, zero retained WebSocketRoute objects, zero real
upgrades and 45 MiB JS heap after GC. A control on the same Linux/Chromium
using the old approach retained 116 objects after 100 pages, including 100
WebSocketRoute objects. Both containers used the same 1 GiB limit; forced GC
was used only in the deterministic test. Code `168d8230264964d81ff4b7ed6dfe166b35730f49` was published; Windows/DE/NL
sources were synchronized. DE uses immutable release
`/home/deploy/releases/jarvis-168d823-hh-transport-memory`, with
`jarvis-hh-transport-server:168d823` for server/collector and
`jarvis-hh-transport-browser:168d823`. Source guards passed on all nodes;
environment and mounts matched before/after cutover. HH profile and secrets
were preserved; 386 server/shared and 56 browser/shared files matched source.
The installed browser image passed another 9/9 focused checks. No new migration
is needed. Desktop was unchanged; the existing missing unused shared file in
the EXE remains the only general release-check issue.

The live 30-minute window started November 5 at 07:07:09 MSK, ending at
07:37:09 MSK. The owner's initial setting was off; only that account was enabled
through JobAutomationService with current scope, access, resume and revision
checks. Automatic restoration to off is scheduled unless the owner changes
the revision. Other accounts were not enabled. Initially, Node heap was 46 MiB,
Playwright object count 16, WebSocketRoute count 0; server/browser healthy and
all three new containers had restart count 0.
The window ended automatically at 07:37:09 MSK; off was restored at revision 18.
It processed 120 items: four new ordinary applications, 113 evaluation/filter
skips, two manual stops for missing applicant information and one cancellation
at disablement. All four application records are sent, have the original HH
receipt and reconciliation_attempts=0. Each ledger pair has exactly one claim,
one operation and one sent result. No new unknown result, receipt error or
repeated submission occurred. Vacancies: 139136698, 138531975, 139138141, 139138865.

The 113 skips include 65 OUT_OF_DIRECTION, 38 UNCERTAIN, four INSUFFICIENT_FIT
and six before model evaluation. The manual stops retain closed reasons
JOB_HH_ANSWER_UNAVAILABLE and JOB_APPLICANT_ANSWER_REQUIRED; neither created an
application. The last item was submitting at disablement, then became
skipped/preparation/JOB_AUTOMATION_UNAVAILABLE, without an operation ID or any
application record. This also verified the cancellation classification live.
No window items remain active. Recorded model usage: 122 requests,
$0.06078095, no unknown costs.

Throughout the window server/browser were healthy and collector was running;
all three restart counts were 0, OOMKilled=false and no new fatal heap OOM
occurred. Seven numeric samples showed 46–152 MiB JS heap under ordinary GC;
production GC was not forced. WebSocketRoute count was 0 in every sample.
The last idle sample had one blank page, zero active/queued operations,
21 Playwright objects, zero Response and zero WebSocketRoute objects. This is
separate evidence from the isolated soak with GC, rather than a substitute.

No new successful live native questionnaire occurred during this window;
its wire path passed Chromium fixtures. Code is shared across accounts, while
live observation used only the owner's personal scope. Old ambiguous operations
were not resent. Temporary test containers/database/networks/staging were removed;
the observer was removed after completion. No recurring maintenance automation
or timer was installed.
