# Разбор unknown после CAPTCHA / Diagnosing unknown after CAPTCHA

[Русский](#русский) | [English](#english)

## Русский

18 октября 2026. Владелец отдельно проверил OCR последней отправленной картинки
и поручил однократно отправить распознанный ответ. Картинка и revision совпали,
ответ был передан браузеру один раз. В 16:20 МСК сохранён исход `unknown`, поиск
остался на паузе; перезапуска browser не было. Ответ повторно не отправлялся.

Точный HTTP-ответ этой попытки не сохранён. Предыдущий архив сохранял сведения
только автоматических попыток; ручной ответ прошёл через другой путь.
Нельзя доказать по этим данным, что OCR ошибся, что HH вернул redirect или что
страница показала конкретную ошибку. Это остаётся открытой проверкой.

Проверка кода выявила причины неоднозначности: ответ native POST подменяется
синтетическим 204 без redirect и тела; исходная вкладка не показывает реальный
ответ HH. Доступ проверяется отдельным GET. `unknown` объединяет отсутствие
receipt, неподтверждённый POST (включая status не 200) и неподтверждённую целевую
страницу. Синтетический 204 не доказывает ни успех, ни отказ.

Добавлена закрытая последняя квитанция в owner-bound manual state: hash операции,
время, этап, допуск запроса, HTTP status, категория redirect, receipt, категория
видимой страницы и ошибки, status и этап verifier, исход. Она сохраняется для
автоматических и ручных отправок, переживает перезапуск. Ответ, URL, cookies,
ключи, headers, тело сайта и произвольный текст в неё не входят.
Отдельный локальный `node src/exportCaptchaReceipt.js` экспортирует только эту
метаинформацию. HTTP/RPC, Telegram-кнопки, подтверждение и правила повторов прежние.
Запись до dispatch обязательна; ошибка не разрешает POST. Старый образ не умеет
читать новое optional поле: не восстанавливай старый state и claims ради отката.

Код `821dc20a0ae22432c9eec46cc0c954fd2fd19263` опубликован в GitHub и получен
обоими VPS. На DE установлен browser release
`/home/deploy/releases/jarvis-821dc20-captcha-receipts`. Заменён только browser;
окружение, mounts, остальные контейнеры, manual revision 1606, четыре claims и
прежняя передача человеку сохранены. Browser/server/OCR здоровы, JS-файлы
работающего browser совпали с release. CLI receipt export работает и возвращает
`null` для старой попытки, подтверждая отсутствие сохранённой квитанции.

Linux browser — 66/66, server — 725/725, Telegram contract — 65/65. Все шесть
автоматических browser/broker/worker сценариев и отдельный ручной redirect
сценарий прошли на Windows и Linux. Проверены schema, отсутствие сырых данных,
restart и запрет POST при ошибке предварительной записи. CPU-модель повторно
не проверялась; её код и транспорт не менялись. Desktop не менялся.

Настоящая причина предыдущего `unknown` не доказана;
для её определения нужна новая отдельно разрешённая попытка с квитанцией.

## English

18 October 2026. The owner separately tested OCR on the last delivered picture
and authorized one submission of that answer. The image and revision matched,
and the answer was passed to the browser once. At 16:20 Moscow time the stored
outcome was `unknown`; search remained paused and the browser had not restarted.
The answer was not submitted again.

That attempt's exact HTTP response was not retained. The previous archive covered
automatic attempts only; the human answer followed a separate path. These records
cannot prove an OCR error, an HH redirect or a particular visible error. This
remains an open verification item.

Code review identified the ambiguity: native POST responses are replaced with a
synthetic 204 without a redirect or body, so the original tab does not display
HH's actual response. A separate GET verifies access. `unknown` combines a missing
receipt, an unconfirmed POST (including a non-200 status) and an unverified target
page. The synthetic 204 proves neither success nor rejection.

A closed latest receipt is added to owner-bound manual state: operation hash,
time, stage, request allowance, HTTP status, redirect category, receipt presence,
visible page/error category, verifier status/stage and outcome. Both automatic
and human submissions retain it across restarts. Answers, URLs, cookies, keys,
headers, website bodies and arbitrary text are excluded. The local command
`node src/exportCaptchaReceipt.js` exports only this metadata. HTTP/RPC, Telegram
buttons, confirmation and retry rules remain unchanged. A write before dispatch
is mandatory; its failure does not authorize a POST. Older images cannot read
the new optional field: never restore stale state or claims to roll back.

Code `821dc20a0ae22432c9eec46cc0c954fd2fd19263` is published on GitHub and received
by both VPS nodes. DE runs browser release
`/home/deploy/releases/jarvis-821dc20-captcha-receipts`. Only the browser was replaced;
environment, mounts, other containers, manual revision 1606, four claims and
the existing human handover are preserved. Browser/server/OCR are healthy, and
running browser JS files match the release. CLI receipt export works and returns
`null` for the old attempt, confirming that its receipt was not retained.

Linux browser checks passed 66/66, server 725/725 and Telegram contract 65/65.
All six automatic browser/broker/worker scenarios plus a human redirect scenario
passed on Windows and Linux. Checks cover schema, exclusion of raw data, restart
and preventing POST on a failed initial write. The CPU model was not retested;
its code and transport are unchanged. Desktop is unchanged.

The actual cause of the previous `unknown` remains
unproven; establishing it requires a new separately authorized attempt with a receipt.
