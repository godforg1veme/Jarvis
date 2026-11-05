# HH: повторное расследование / Reopened runtime investigation

[Русский](#русский) | [English](#english)

## Русский

После прежнего 30-минутного окна browser 168d823 ещё четыре раза завершился
с V8 heap OOM. Page-scoped WebSocket fix сохраняет WebSocketRoute=0,
но не устранил весь рост JS heap. Прежнее заключение о полном исправлении
памяти отозвано; успешное окно сохранено как ограниченное свидетельство.

Для VK 138448900 исходная операция получила JOB_HH_RECEIPT_HTTP, а шесть
читающих попыток и дополнительная ручная сверка не установили sent.
Повторная отправка запрещена. Точный прежний HTTP status не был сохранён;
его нельзя восстановить из общего failure code. CRM 138563100 остановился
без application: модель выбрала manual для трёх вопросов работодателя,
включая опыт CRM и конкретный A/B-тест. Это отдельная остановка по данным.

Текущий candidate диагностический. Он различает redirect, CAPTCHA/login,
forbidden, rate limit, client/server error и ограниченные XSRF/origin причины.
Классификатор не переходит по Location, не повторяет запрос и не объявляет
ошибочный HTTP-ответ успехом. Разбор текста допускается только существующим
bounded helper для малого объявленного несжатого text/JSON; наружу выходят
литеральные категории, без тела, headers, URL и исключений.

Метрики памяти дополнены числовыми размерами server fetchResponses/fetchLog,
server dispatchers/active calls и областей V8. Внутренний toImpl используется
только для диагностики, не для разрешений или исполнения. Недоступность
счётчиков обозначается явно. Ни GC, ни heap dumps не включались.

Проверены положительные контроли удержанного/освобождённого APIResponse,
перекрёстные aborted XHR, большие SSR/GET и 1000 health probes: локальные
случаи не воспроизвели второй источник heap. Candidate прошёл server suite
(941 passed, 2 DB-only skipped), 10/10 профильных Linux/HTTPS и один полный
runtime startup; security review не нашла обхода или утечки содержимого.

Установка метрик — не исправление утечки. Следующий шаг — сопоставить
продовые server counters и V8 при росте, получить воспроизведение, затем
исправить подтверждённый источник и проверить более длительное окно.
Автопоиск остаётся off; диагностический выпуск не разрешает новый POST
для неопределённых операций. Публикация и VPS согласованы владельцем.

## English

After the previous 30-minute observation, browser 168d823 crashed four more
times with V8 heap OOM. The page-scoped WebSocket fix keeps WebSocketRoute=0
but did not eliminate all JS heap growth. The previous conclusion that memory
was fully repaired is withdrawn; that successful window remains limited evidence.

VK vacancy 138448900's original operation received JOB_HH_RECEIPT_HTTP.
Six read-only attempts and an additional manual check did not establish sent;
another submission is forbidden. The old HTTP status was not retained and
cannot be recovered from a generic failure code. CRM 138563100 stopped without
an application: the model selected manual for three employer questions,
including CRM experience and a specific A/B test. This is a separate data stop.

The current candidate is diagnostic. It distinguishes redirects, CAPTCHA/login,
forbidden, rate limiting, client/server errors and bounded XSRF/origin reasons.
Classification never follows Location, retries a request or treats an error
HTTP response as success. Text inspection uses the existing bounded helper for
small declared uncompressed text/JSON; only literal categories leave it, without
bodies, headers, URLs or exceptions.

Memory diagnostics add numeric server fetchResponses/fetchLog sizes, server
dispatcher/active-call counts and V8 spaces. Internal toImpl is diagnostic-only,
never used for authorization or execution. Unavailable counters are explicit.
No forced GC or heap dumps were enabled.

Positive controls for retained/disposed APIResponse objects passed. Aborted XHR,
large SSR/GET and 1000 health probes did not reproduce the second heap source
locally. The candidate passed the server suite (941 passed, two DB-only skipped),
10/10 focused Linux/HTTPS checks and full runtime startup; security review found
no bypass or content disclosure.

Installing counters does not fix the leak. Next: correlate production server
counters and V8 growth, reproduce it, repair the confirmed source and verify a
longer window. Automation remains off; this diagnostic rollout never authorizes
another POST for uncertain operations. The owner authorized publication/VPS work.
