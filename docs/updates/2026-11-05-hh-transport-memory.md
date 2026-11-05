# HH: транспорт квитанции и память / Receipt transport and memory

[Русский](#русский) | [English](#english)

## Русский

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
в детерминированном тесте. Установка и отдельное живое наблюдение будут
внесены после завершения выпуска.

## English

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
was used only in the deterministic test. Installation and separate live
observation will be recorded after rollout completion.
