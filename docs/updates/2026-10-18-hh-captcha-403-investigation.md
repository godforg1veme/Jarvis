# Разбор HTTP 403 при правильном OCR / HTTP 403 investigation

[Русский](#русский) | [English](#english)

## Русский

18 октября 2026. В последней автоматической попытке в 17:58 МСК HH вернул 403,
receipt получен, допущен один native POST. GET целевой страницы вернул 200 с
капчей. Автоматика остановилась после одной попытки с `unknown`; владелец
подтвердил правильность текста OCR. Код 403 не доказывает ошибку распознавания.
Тело того ответа уже удалено, поэтому точная серверная причина пока неизвестна.

Проведены две изолированные проверки штатной страницы с тем же owner profile.
Production browser временно остановлен и восстановлен с прежним container ID.
Все три тестовых answer POST перехвачены и отменены до сети; тестовый текст,
cookies, CSRF, URL и ключи не публиковались. Через 1 и 15 секунд после готовности
картинки штатный JS создаёт одинаковый XHR с пустым body, пятью ожидаемыми query
полями и CSRF header; `isBot=false`, hidden CSRF не менялся. В отдельной пробе
browser/API cookies совпали, `_xsrf` один, header совпал с cookie; API GET дал
ожидаемый 302. Эти пробы не выявили ошибки формата, дубликатов cookies или гонки
гидратации. Они не доказывают состояние сервера и tokens в прежней неудачной попытке
и не исключают серверную проверку времени или сессии.

Original browser восстановлен healthy. Claims, бюджет и human handover сохранены.
После рестарта обычный worker открывал новые human-картинки и увеличивал revision;
неизвестный ответ не повторялся, счётчик не сбрасывался. Поиск остался на attention.

Добавлено поле `serverError` в закрытую квитанцию. Оно различает явный отказ
CSRF/origin, просроченную/неверную капчу, rate limit, общий Forbidden и отсутствие
доступного пояснения. Содержимое сайта не сохраняется. Анализируется только
небольшой, явно ограниченный Content-Length (до 32 КиБ), несжатый text/json ответ;
остальные тела не запрашиваются. Неопределённая категория не объявляется причиной.
Дополнительно сохраняются тип запроса, возраст картинки/страницы и закрытый исход
сопоставления CSRF с cookie. Значения tokens, cookies и headers не сохраняются.
Старые квитанции принимаются; отсутствующее пояснение не восстанавливается догадкой.
Способ отправки, HTTP headers и правила трёх попыток/unknown не менялись.

Код `cb39189693a8f416efd77a6bfbd5d4f9080fdc03` опубликован в GitHub и получен
обоими VPS. На DE установлен browser release
`/home/deploy/releases/jarvis-cb39189-captcha-403`. Окружение, mounts и остальные
контейнеры сохранены; browser/server/OCR здоровы. Claims (два), automatic budget
(одна попытка, human) и прежняя квитанция 403 сохранены. Поля пояснения для неё
не добавлялись задним числом. Старая запись архива прочитана новым валидатором.
Все JS-файлы работающего browser совпали с release, локальный export проверен.

Проверки: Linux browser 71/71, Windows browser 64 успешных и семь Linux skips,
server 725/725, Telegram contract 65/65. Шесть автоматических browser/broker/worker
сценариев, отдельные ручной redirect и 403/CSRF прошли на Windows и Linux.
В 403-фикстуре категория остаётся и в долговечном receipt, и в приватном архиве,
следующий POST не появляется. CPU-модель в этом запуске повторно не тестировалась;
её код и транспорт не менялись. Desktop не затронут.

Истинная причина прошлого 403 не доказана. Для
завершения разбора нужен новый серверный отказ с пояснением; новая отправка требует
свежей картинки и отдельного одобрения владельца, прежняя не повторяется.

## English

18 October 2026. At 17:58 Moscow time the last automatic attempt received HTTP
403 from HH. A receipt arrived and one native POST was permitted. Target GET
returned 200 with a CAPTCHA. Automation stopped after one attempt as `unknown`;
the owner confirmed the OCR text was correct. Status 403 does not prove a
recognition error. That response body was discarded, so its exact reason is unknown.

Two isolated probes used the native page and the same owner profile. The production
browser was temporarily stopped and restored with its original container ID.
All three test answer POSTs were intercepted and aborted before the network;
test text, cookies, CSRF, URLs and picture keys were not published. At 1 and 15
seconds after image readiness, native JS produced the same XHR: empty body, five
expected query fields and CSRF header; `isBot=false` and hidden CSRF unchanged.
Another probe found identical browser/API cookies, one `_xsrf`, a matching header
and cookie, and expected API GET 302. The probes found no format error, duplicate
cookies or hydration race. They do not prove prior server/token state or rule out
server-side timing or session checks.

The original browser is healthy again. Claims, budget and human handover are
preserved. After restart the regular worker opened fresh human pictures and
advanced revision; no unknown answer was repeated or counter reset. Search stays
on attention.

The closed receipt gains `serverError`, distinguishing explicit CSRF/origin
rejection, expired/invalid CAPTCHA, rate limiting, generic Forbidden and unavailable
explanations. Website content is not retained. Only a small, explicitly declared
Content-Length (up to 32 KiB), uncompressed text/JSON response is inspected; other
bodies are not requested. An ambiguous category is not presented as a root cause.
Request type, image/page age and a closed CSRF/cookie comparison outcome are also
retained. Token, cookie and header values are excluded. Legacy receipts are accepted;
missing explanations are not reconstructed by guessing. Transport, HTTP headers
and the three-attempt/unknown rules are unchanged.

Code `cb39189693a8f416efd77a6bfbd5d4f9080fdc03` is published on GitHub and received
by both VPS nodes. DE runs browser release
`/home/deploy/releases/jarvis-cb39189-captcha-403`. Environment, mounts and other
containers are preserved; browser/server/OCR are healthy. Two claims, automatic
budget (one attempt, human handover) and the old 403 receipt are preserved. No
explanation fields were retroactively invented. The new validator read the old
archive record. Running browser JS files match the release and local export works.

Checks: Linux browser 71/71, Windows browser 64 passes and seven Linux-specific
skips, server 725/725, Telegram contract 65/65. Six automatic browser/broker/worker
scenarios plus human redirect and 403/CSRF cases passed on Windows and Linux.
The 403 fixture retains the category in both the durable receipt and private
archive and does not issue another POST. The CPU model was not retested; its code
and transport are unchanged. Desktop is unaffected.

The actual cause of the past 403 remains unproven.
Completing the investigation requires another server rejection with an explanation;
submission needs a fresh picture and separate owner approval, without repeating the
old answer.
