# Живой тест ответа OCR / Live OCR answer acceptance

[Русский](#русский) | [English](#english)

## Русский

18 октября 2026, 16:46 МСК. После установки
[закрытой квитанции](2026-10-18-hh-captcha-receipt-diagnosis.md) владелец запросил
свежую картинку, проверил результат установленной frozen OCR-модели и явно
разрешил однократную отправку именно этого ответа. Перед отправкой проверены
owner/private scope, совпадение картинки, revision и срок действия. PNG, ответ,
идентификаторы чата, credentials и private state в Git не помещались.

Квитанция: `stage=finished`, `permitted=1`, `received=true`, `httpStatus=302`,
`verificationStatus=200`, `verification=verified`, `outcome=solved`.
Исходная вкладка оставалась в категории CAPTCHA без распознанной видимой ошибки;
отдельная целевая страница подтвердила доступ. Поэтому прежняя картинка в исходной
вкладке и сам status 302 не означают отказ. Направление redirect в квитанции не
зафиксировано; не делаем вывод о конкретном Location.

Owner-scoped PostgreSQL подтвердил `consumed/solved` для текущего фото,
`status=collecting`, `activated=true`, `paused=false` и сохранённый progress.
Обычный сбор возобновился. Повторного POST, сброса claims или принудительного
включения поиска не было. Для записи этого результата меняются только документы;
работающие компоненты и Desktop пересобирать не требуется.

Этот тест подтверждает реальное прохождение HH с ответом модели после отдельного
одобрения владельца. Полностью автономный цикл без человека в этом тесте не
проверялся. Прежний `unknown` не воспроизвёлся; его точная причина остаётся
недоказанной, поскольку старая ручная отправка не имела сохранённой квитанции.

## English

18 October 2026, 16:46 Moscow time. After installing the
[closed receipt](2026-10-18-hh-captcha-receipt-diagnosis.md), the owner requested
a fresh picture, reviewed the installed frozen OCR model's result and explicitly
approved one submission of that exact answer. Owner/private scope, image identity,
revision and expiry were verified first. PNG pixels, the answer, chat identifiers,
credentials and private state were not added to Git.

Receipt: `stage=finished`, `permitted=1`, `received=true`, `httpStatus=302`,
`verificationStatus=200`, `verification=verified`, `outcome=solved`.
The original tab remained in the CAPTCHA category without a recognized visible
error, while a separate target page verified access. Therefore the old picture
in the original tab and status 302 alone do not indicate rejection. The receipt
did not retain a redirect destination; no specific Location is inferred.

Owner-scoped PostgreSQL confirmed `consumed/solved` for the current photo,
`status=collecting`, `activated=true`, `paused=false` and retained progress.
Normal collection resumed. There was no repeated POST, claims reset or forced
search activation. Recording this result changes documents only; running
components and Desktop do not need rebuilding.

This test confirms real HH access with the model's answer following separate
owner approval. A fully autonomous cycle without human intervention was not
tested here. The previous `unknown` did not recur; its exact cause remains
unproven because the earlier human submission had no persisted receipt.
