# Журнал автоматических попыток HH / HH automatic attempt evidence

[Русский](#русский) | [English](#english)

## Русский

18 октября 2026. После неудачной попытки выяснилось, что картинки и ответы OCR
не сохранялись. Добавлен приватный архив автоматических попыток в существующем
профиле browser. Старые картинки и ответы восстановить нельзя.

Теперь PNG сохраняется до OCR, валидный нормализованный ответ — до отправки.
Далее записываются исход, HTTP status, наличие receipt, допуск запроса и результат
проверки доступа. Если запись до отправки не удалась, POST не выполняется.
После прерывания остаётся последний сохранённый этап; `dispatch_started` сам по
себе не доказывает отправку или отказ HH. Unknown по-прежнему передаёт управление
человеку, три подтверждённые неудачи исчерпывают обычный бюджет.

Архив привязан к владельцу, хранит максимум 64 записи с TTL 48 часов. Очистка
выполняется при новой записи и каждый час. Каталог 0700, файлы 0600; нет cookies,
ключей картинок, URL, headers, тел ответов сайта или сырых исключений. Данные
не попадают в публичные diagnostics, AI, историю, Git или Telegram-уведомления.
Ручные ответы владельца не архивируются. Экспорт доступен только локальной CLI
в контейнере; HTTP/RPC и новые кнопки не добавлены. Нужен новый browser image;
модель, server и Desktop не изменены.

Код `6290f87340213555ce60f6b6302eea8aa74955ca` опубликован в GitHub и получен
обоими VPS. На DE установлен browser release
`/home/deploy/releases/jarvis-6290f87-captcha-evidence`. Только browser заменён;
остальные контейнеры, окружение и mounts сохранены. Browser/server/OCR здоровы,
все JS-файлы работающего browser совпали с release. Текущая ручная капча,
claims и счётчик сохранены; revision вырос при открытии страницы после рестарта.
CLI export проверен: архив пока пуст, старые данные в него не перенесены.

Windows browser — 55 успешных тестов, семь Linux-проверок пропущены; Linux
browser — 62/62, server — 725/725, Telegram contract — 65/65. Все шесть сценариев
Chromium → broker → Telegram worker прошли на Windows и Linux; Linux проверяет
реальное сохранение PNG/ответов и экспорт с диска. CPU-модель в этом запуске
повторно не проверялась, её код и транспорт не менялись. Desktop не менялся.
Настоящее прохождение HH и причина прежней ранней остановки пока не установлены.

## English

18 October 2026. Investigation of a failed attempt showed that OCR images and
answers were not retained. A private automatic-attempt archive is added to the
existing browser profile. Previous images and answers cannot be recovered.

PNG pixels are saved before OCR, and the valid normalized answer before dispatch.
The outcome, HTTP status, receipt presence, request allowance and access verifier
result are recorded afterward. A write failure before dispatch prevents the POST.
After interruption, the last persisted phase remains; `dispatch_started` alone
does not prove dispatch or HH rejection. Unknown still hands control to the owner;
three confirmed failures exhaust the normal budget.

The owner-bound archive retains at most 64 records with a 48-hour TTL. Cleanup runs
on new records and hourly. Directory permissions are 0700, files 0600. Cookies,
picture keys, URLs, headers, website response bodies and raw exceptions are excluded.
Data does not enter public diagnostics, AI, history, Git or Telegram notifications.
Human answers are not archived. Export is available only through a local container
CLI; no HTTP/RPC or buttons are added. A new browser image is required; the model,
server and Desktop are unchanged.

Code `6290f87340213555ce60f6b6302eea8aa74955ca` is published on GitHub and received
by both VPS nodes. DE runs browser release
`/home/deploy/releases/jarvis-6290f87-captcha-evidence`. Only the browser was replaced;
other containers, environment and mounts are preserved. Browser/server/OCR are
healthy, and all running browser JS files match the release. The current manual
challenge, claims and counter remain intact; its revision advanced when reopening
the page after restart. CLI export works: the archive is empty, without old data.

Windows browser checks have 55 passes and seven Linux-specific skips; Linux
browser checks passed 62/62, server 725/725 and Telegram contract 65/65. All six
Chromium → broker → Telegram worker scenarios passed on Windows and Linux;
Linux verifies actual PNG/answer persistence and disk export. The CPU model was
not retested in this run; its code and transport are unchanged. Desktop is unchanged.
Actual HH acceptance and the reason for the previous early stop remain unconfirmed.
