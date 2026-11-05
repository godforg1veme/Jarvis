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
server routes-in-flight, dispatchers/active calls и областей V8. Внутренний toImpl используется
только для диагностики, не для разрешений или исполнения. Недоступность
счётчиков обозначается явно. Ни GC, ни heap dumps не включались.

Проверены положительные контроли удержанного/освобождённого APIResponse,
перекрёстные aborted XHR, большие SSR/GET и 1000 health probes: локальные
случаи не воспроизвели второй источник heap. Candidate прошёл server suite
(941 passed, 2 DB-only skipped), 10/10 профильных Linux/HTTPS и один полный
runtime startup; security review не нашла обхода или утечки содержимого.

Отдельный локальный race с закрытием страницы до завершения route воспроизвёл
удержание 500 server routes при стабильном client objects=16; после GC heap
вырос с 31 до 49 MiB. На DE установлен диагностический 58f39f7; Windows,
GitHub и source обоих VPS совпали. Окружение, mounts и хэши 386 server/56 browser
файлов сверены. За первые десять минут server routes выросли 0 → 49 → 99;
последний замер: active=0, queued=0, pages=1, client objects=21, server active=0,
fetchResponses/fetchLog/WebSocketRoute=0. Это подтверждает retention в рабочем
контексте; доля в прежних OOM пока не измерена.

Кандидат ремонта: после завершения операции остановить оставшиеся ресурсы
через window.stop и закрыть страницу, обе стадии с deadline. Контекстные
guards остаются. Сбой очистки помечает runtime unhealthy. При reconciliation
health escalation происходит после durable ledger.finish, чтобы не терять
уже доказанный результат. Общий helper подключён к чтению, откликам,
поднятию резюме, login, CAPTCHA и health. В Linux на 100 страницах с delayed GET
прямой close оставил 1524 routes и heap 60 MiB после GC; helper — 0 routes,
heap 44 MiB, client objects=16 в обоих случаях. Это короткий regression test;
длительный тест и установка ремонта ещё не завершены. Проверки кандидата:
Linux browser 146/146, 16/16 HTTP/native/journal/recovery/raise проверок,
три runtime acceptance. Ревизия нашла и закрыла пропуск поднятия резюме.
Два старых acceptance fixture приведены к уже действующему userId и числовому
memory-log контракту; production RPC не менялся. Запущен часовой локальный
soak с delayed GET, health probes и post-GC проверками каждые пять минут;
его результат пока не установлен.

Владелец подтвердил общую политику анкет: ответы об опыте берутся из
подтверждённых сведений резюме; если сведений не хватает, отклик останавливается
без отправки. CRM — ожидаемая остановка. Свежая читающая проверка VK не нашла
видимого applied action или допустимого reference; это не доказательство
отсутствия старого POST и не разрешение повторять его.

Установка метрик — не исправление утечки. Проверки и более длительное окно
должны подтвердить окончательный ремонт.
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
routes-in-flight, dispatcher/active-call counts and V8 spaces. Internal toImpl is diagnostic-only,
never used for authorization or execution. Unavailable counters are explicit.
No forced GC or heap dumps were enabled.

Positive controls for retained/disposed APIResponse objects passed. Aborted XHR,
large SSR/GET and 1000 health probes did not reproduce the second heap source
locally. The candidate passed the server suite (941 passed, two DB-only skipped),
10/10 focused Linux/HTTPS checks and full runtime startup; security review found
no bypass or content disclosure.

A local race closing pages before route completion retained 500 server routes
while client objects stayed at 16; post-GC heap grew from 31 to 49 MiB.
Diagnostic 58f39f7 is installed on DE; Windows, GitHub and both VPS sources
matched. Environment, mounts and hashes of 386 server/56 browser files matched.
Over its first ten minutes, server routes grew 0 → 49 → 99. The last sample
had active=0, queued=0, pages=1, client objects=21, server active=0 and zero
fetchResponses/fetchLog/WebSocketRoute. This confirms production-context
retention; its contribution to previous OOMs has not been measured.

Repair candidate: after an operation completes, stop remaining resources with
window.stop and close the page, with a deadline for each stage. Context guards
remain. Cleanup failure marks the runtime unhealthy. During reconciliation,
health escalation follows durable ledger.finish so established proof is retained.
The shared helper covers reads, applications, resume raises, login, CAPTCHA and
health. In Linux, 100 pages with delayed GET retained 1524 routes and 60 MiB
post-GC heap with direct close, versus zero routes and 44 MiB with the helper;
client objects stayed at 16 in both cases. This is a short regression test;
long testing and repair installation are not complete. The candidate passed
Linux browser 146/146, 16/16 HTTP/native/journal/recovery/raise checks and three
runtime acceptances. Review found and closed the omitted resume-raise consumer.
Two stale acceptance fixtures now match the existing userId and numeric memory
log contracts; production RPC is unchanged. A one-hour local soak with delayed
GET, health probes and post-GC checks every five minutes is running; its outcome
is not yet established.

The owner confirmed the general questionnaire policy: personal experience
answers use confirmed resume information; missing information stops submission.
CRM is an expected stop. A fresh read-only VK probe found no visible applied
action or valid reference; this neither proves the old POST was absent nor
authorizes another one.

Installing counters does not fix the leak. Validation and a longer observation
must establish the final repair. Automation remains off; this rollout never authorizes
another POST for uncertain operations. The owner authorized publication/VPS work.
