# Три попытки OCR перед Telegram / Three OCR attempts before Telegram

[Русский](#русский) | [English](#english)

## Русский

18 октября 2026. Локальное изменение по запросу владельца: лимит автоматических
попыток увеличен с двух до трёх. Публикация и установка на VPS ещё не выполнены;
там остаётся [предыдущий выпуск](2026-10-18-hh-trained-ocr-release.md).

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

## English

18 October 2026. Local change requested by the owner: the automatic attempt limit
increases from two to three. Publication and VPS installation have not happened;
the nodes still run the [previous release](2026-10-18-hh-trained-ocr-release.md).

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
