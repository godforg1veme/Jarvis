# Три попытки OCR перед Telegram / Three OCR attempts before Telegram

[Русский](#русский) | [English](#english)

## Русский

18 октября 2026. По запросу владельца лимит автоматических попыток увеличен
с двух до трёх. Код `2cf8b66accecee5e877309b0482d52b9ceafd177` опубликован
в GitHub и получен обоими VPS. На DE установлен отдельный browser release
`/home/deploy/releases/jarvis-2cf8b66-three-captcha`. Он продолжает
[предыдущий выпуск OCR](2026-10-18-hh-trained-ocr-release.md).

Каждая попытка использует отдельную картинку. После трёх подтверждённых отказов
владелец получает прежнее фото в исходном Telegram-чате. Успех с первой, второй
или третьей попытки завершает восстановление без фото. Ошибка OCR расходует
попытку. Unknown или прерванная отправка передают управление человеку раньше:
неопределённый запрос не повторяется. Уже переданная человеку капча сохраняет
ручной режим после обновления. Перезапуск не сбрасывает счётчик.

Лимит вынесен в общую константу для координатора и проверки сохранённого
состояния. Telegram-кнопки, подпись, права и подтверждение ответом на фото прежние.
Модель, веса и Desktop не изменены.

Проверки: пакет browser — 53 успешных теста, четыре Linux-проверки пропущены
на Windows. Проверены третья попытка, сохранение двух отказов через перезапуски,
исчерпание лимита и сохранение прежней передачи человеку.
Изолированная проверка Chromium → broker → Telegram worker прошла во всех шести
сценариях: успех с первой, второй и третьей попытки, три отказа, unknown и
неподтверждённая отправка. Telegram contract — 65/65. Повторный тест CPU-модели
в этом запуске пропущен: модель и её транспорт не менялись.
Linux browser — 57/57, все шесть браузерных сценариев также прошли на Linux.
Файлы работающего browser совпали с release, фактический лимит равен трём.
Проверены здоровье browser/server/OCR, неизменность остальных контейнеров,
прежние mounts и окружение без вывода значений. Ручной режим, claims и счётчик
текущей капчи сохранены; revision вырос при открытии страницы после рестарта.
Текущая капча остаётся у владельца после прежнего unknown. Живое прохождение
новой капчи с третьей попытки пока не проверено.

## English

18 October 2026. At the owner's request, the automatic attempt limit increases
from two to three. Code `2cf8b66accecee5e877309b0482d52b9ceafd177` is published
on GitHub and received by both VPS nodes. DE runs the separate browser release
`/home/deploy/releases/jarvis-2cf8b66-three-captcha`, continuing the
[previous OCR release](2026-10-18-hh-trained-ocr-release.md).

Each attempt uses a distinct picture. After three confirmed failures, the owner
receives the existing photo in the original Telegram chat. Success on the first,
second or third attempt completes recovery without a photo. OCR errors consume
an attempt. Unknown or interrupted dispatch hands control to the owner earlier:
an uncertain request is never repeated. A challenge already handed to the owner
stays manual after upgrading. Restarting does not reset the counter.

The coordinator and stored-state validation share one limit constant. Telegram
buttons, caption, permissions and photo-reply confirmation remain unchanged.
The model, weights and Desktop are unchanged.

Checks: the browser package has 53 passing tests; four Linux-specific checks are
skipped on Windows. Coverage includes the third attempt, two failures surviving
restarts, budget exhaustion and preserving an existing human handover.
The isolated Chromium → broker → Telegram worker check passed all six scenarios:
first, second and third success, three failures, unknown and unconfirmed dispatch.
Telegram contract checks passed 65/65. The CPU model test was skipped in this run:
the model and its transport are unchanged.
Linux browser checks passed 57/57, and all six browser scenarios also passed on Linux.
Running browser files match the release, and the actual limit is three.
Checks confirmed browser/server/OCR health, unchanged other containers, existing
mounts and matching environment without exposing values. The current challenge's
manual mode, claims and counter are preserved; its revision advanced when opening
the page after restart. The current challenge stays with the owner following the
previous unknown result. Solving a new live challenge on the third attempt remains
unverified.
