# Дообученный OCR HH: локальная адаптация / Fine-tuned HH OCR: local adaptation

[Русский](#русский) | [English](#english)

## Русский

Позднейшее решение 18 октября 2026: владелец согласовал зависимости, публикацию
в GitHub и обновление обоих VPS, включая автоматическую обработку ожидающей
CAPTCHA. Результаты установки и живой проверки будут записаны отдельно;
измерения ниже относятся к локальному этапу.
Более новый результат: [установка и живая попытка](2026-10-18-hh-trained-ocr-release.md).

18 октября 2026. Изменения находятся только в локальной ветке
`codex/hh-trained-ocr`. GitHub, оба VPS и установленный Desktop не менялись.
Модель найдена в `F:/OCR Learning`; исходный проект —
[hh-ru-captcha](https://github.com/godforg1veme/hh-ru-captcha), revision
`55b3a412cee68e44c1e35cd655802f16f3448570`.

### Что подготовлено

Сохранён исходный конвейер: выпрямление, дообученная модель, две обрезки,
greedy/beam CTC, frozen selection и дополнительная модель восстановления буквы.
Основные веса закреплены SHA-256
`d1771fbc6a648636b0541225f9f7a92813e70c7f352496f773938ffa88472598`,
rescue — `3d25b99bef7ba60980b19136210e866da04fed835cbc9080a10c818ae1e477b2`.
Bundle manifest: `af3ec0c2ef0148dea41c08b0f468381c32d00581bafd06b3542ebab7e9fa77ea`.
Bundle содержит только закреплённые inference sources, notices/config/dictionary
и веса; датасеты, среды и секреты не копируются. В Git входят только pins,
адаптер и инструменты. Исходный OCR checkout остался чистым.

Новый режим выключен по умолчанию. При opt-in в browser/server одна recovery
получает максимум две сохранённые попытки на разных картинках, не более одной
native отправки каждой. Отказ OCR тоже расходует попытку. После двух неудач
владельцу отправляется прежнее фото с короткой просьбой помочь. Бюджет не
сбрасывается кнопкой обновления или перезапуском. Unknown и прерванная попытка
прекращают автоматику раньше. Успех подтверждает прежнее чтение точного target.

Закрытый `preparing` сохраняет запрос в очереди без Telegram send. Раннее
collector attention подавляется только в новом режиме. Фото проходит прежние
owner/private binding, claim, expiry и deduplication; reply по-прежнему является
подтверждением однократной отправки. Текст OCR не попадает в историю или логи.
Endpoint `/ocr/frozen` исключает незаметную подмену прежним общим OCR.

### Измерения

Это полное совпадение строки с учётом пробела и ё. Параметры по этим ответам
не подбирались. Большой прогон выполнен локально на GPU.

| Набор | Полное совпадение | Невалидный ответ |
| --- | ---: | ---: |
| Знакомые оригиналы, регрессия | 9/9 | 0 |
| Сохранённый final synthetic | 952/1000 (95,2%) | 1 |
| Сохранённый final stress | 463/500 (92,6%) | 1 |
| Новая геометрия, seed 2026101801 | 194/200 (97,0%) | 1 |

Всего 1 709 изображений. На 1 509 ранее оценённых изображениях все ответы
адаптера совпали с исходным отчётом проекта. Новые 200 изображений созданы
исходным генератором со словами из final vocabulary: это новая геометрия,
а не независимый новый словарь. Девять оригиналов участвовали в разработке
модели и не подтверждают точность на новых капчах HH.

Стратифицированный CPU PNG прогон с seed 2026101802: 73/73 ответа совпали с GPU,
72/73 с разметкой. Медиана одиночного запроса — 0,773 с, максимум — 1,211 с.
Предварительная загрузка CPU моделей заняла около 1,7 с. Windows CPU-процесс
при пакетной проверке достигал примерно 521 MiB working set; это не измерение
контейнера Linux под cgroup. В предлагаемом overlay лимит 1 GiB.

Локальные изображения и подробные ответы сохранены только в игнорируемом
`data/hh-ocr-evaluation/`. Сохранённые binding-записи Telegram не содержат
байтов старых картинок, Bot API не позволяет перечитать исходящую историю.
Полный архив прежних Telegram капч не получен; использованы доступные девять
оригиналов, а не заявленная оценка всей истории чата.

### Проверки и ограничения

Offline Edge/Chromium → native form → CAPTCHA broker → настоящий server client
и photo worker проверены для успеха с первой/второй попытки, двух отказов,
unknown и redirect. После отказов проверена ровно одна выдача фото через
подменённый sendPhoto. Отдельный сценарий действительно распознаёт CPU моделью
PNG из canvas браузера. Это локальные фикстуры, не принятие ответа сайтом.
Первый вариант фикстуры ошибочно разрешал браузерный redirect к публичной
странице HH; исправленный прогон выполнен с принудительно отключённой сетью.
В production профиль/credentials он не входил и ответы сайту не отправлял.

Проверены также лимит и serialization, invalid OCR, прерванная попытка,
перезапуск, прежние human claims, повтор картинки, закрытая owner-scoped state,
запрет generic backend и отсутствие ранней доставки. Исходные 10 recognition
tests прошли. Итог: server 725/725, Telegram contract 65/65, browser 52/52
с четырьмя Linux-only skips; worker 10/10, Compose policy 5/5, browser acceptance
2/2. Чистое локальное Python-окружение установлено с теми же версиями предлагаемого
набора, `pip check` прошёл; в нём также прошли worker tests и acceptance с настоящей
CPU моделью. Проверена структура Compose overlay без Docker. Source guard ожидаемо
отклонил незакоммиченный локальный checkout; deploy staging не выполнялся.
Команды находятся в [verification](../verification.md).

Повторная CPU PNG проверка в этом чистом окружении также дала 73/73 совпадений
с GPU и 72/73 с разметкой: медиана 0,772 с, максимум 1,159 с.

Docker и WSL на компьютере отсутствуют. Linux build, зависимости в чистом
образе, UNIX socket permissions, cgroup CPU/memory, перезапуск контейнера и
реальные Telegram/HH ещё не проверены. Предложены отдельные `Dockerfile.frozen`,
hash-locked CPU dependencies и Compose overlay; production-зависимости
Paddle/OpenCV/RapidFuzz и их транзитивные пакеты требуют согласования по AGENTS.
Старый worker/default image не заменён; новый флаг равен нулю по умолчанию.
Изменения Windows runtime отсутствуют, сборка/установка EXE не требуется.

Для следующего этапа нужно согласование зависимостей и публикации в GitHub
`main`. После публикации исходники должны быть синхронизированы с обоими VPS;
на DE изменятся server/browser и отдельный OCR worker после Linux build/tests.
На NL эти компоненты не запускаются, требуется сверка source. Включение нового
режима допустимо после проверки worker и границ; реальная доставка и принятие
HH остаются отдельной приёмкой. Backup/restore и прочие сервисы не затрагиваются.

## English

Later decision on 18 October 2026: the owner approved dependencies, GitHub
publication and both VPS updates, including automatic handling of the waiting
CAPTCHA. Installation and live results will be recorded separately; measurements
below describe the local development stage.
Newer result: [installation and the live attempt](2026-10-18-hh-trained-ocr-release.md).

18 October 2026. Changes exist only on the local `codex/hh-trained-ocr` branch.
GitHub, both VPS nodes and the installed Desktop are unchanged. The model was
found in `F:/OCR Learning`; its source is
[hh-ru-captcha](https://github.com/godforg1veme/hh-ru-captcha), revision
`55b3a412cee68e44c1e35cd655802f16f3448570`.

### Prepared changes

The original pipeline is preserved: rectification, fine-tuned weights, two crops,
greedy/beam CTC, frozen selection and the insertion-rescue model. Main weights
have SHA-256 `d1771fbc6a648636b0541225f9f7a92813e70c7f352496f773938ffa88472598`;
rescue weights have `3d25b99bef7ba60980b19136210e866da04fed835cbc9080a10c818ae1e477b2`.
Bundle manifest SHA-256 is
`af3ec0c2ef0148dea41c08b0f468381c32d00581bafd06b3542ebab7e9fa77ea`.
The bundle contains pinned inference sources, notices/config/dictionary and
weights, excluding datasets, environments and secrets. Git contains only pins,
the adapter and tooling. The original OCR checkout remains clean.

The new mode is disabled by default. When enabled in browser/server, each recovery
gets at most two durable attempts on distinct images, with at most one native
answer per image. Invalid OCR also consumes an attempt. Two failures hand over
the existing photo to the owner with a short request for help. Refresh/restart
cannot replenish the budget. Unknown/interrupted attempts stop automation early.
Success requires the existing exact-target read verifier.

The closed `preparing` outcome retains the queued request without Telegram send.
Early collector attention is suppressed only in this mode. Photos retain the
existing owner/private binding, claim, expiry and deduplication; replying still
confirms one native answer. OCR text enters neither history nor logs. The
`/ocr/frozen` endpoint prevents silent substitution with the generic old model.

### Measurements

Accuracy means an exact string match, including internal space and ё. Settings
were not tuned from these results. The large evaluation ran on the local GPU.

| Set | Exact match | Invalid output |
| --- | ---: | ---: |
| Familiar originals, regression | 9/9 | 0 |
| Preserved final synthetic | 952/1000 (95.2%) | 1 |
| Preserved final stress | 463/500 (92.6%) | 1 |
| New geometry, seed 2026101801 | 194/200 (97.0%) | 1 |

There were 1,709 images in total. All 1,509 previously evaluated predictions
matched the original project report. The new 200 images use the original
generator and final-test vocabulary: new geometry, not an independent new
vocabulary test. The nine originals informed model development and do not
establish accuracy on new HH challenges.

A stratified CPU PNG check with seed 2026101802 matched GPU on 73/73 outputs and
labels on 72/73. Single-request latency was 0.773 s median and 1.211 s maximum.
Preliminary CPU model loading took about 1.7 s. The Windows CPU process reached
about 521 MiB peak working set during batch evaluation; this is not a Linux
cgroup measurement. The proposed overlay uses a 1 GiB limit.

Images and detailed predictions remain only in ignored `data/hh-ocr-evaluation/`.
Historical Telegram bindings retain no image bytes, and Bot API cannot reread
outgoing chat history. The full earlier CAPTCHA archive was not obtained; the
nine available originals were used, with no claim of whole-chat evaluation.

### Verification and limits

Offline Edge/Chromium → native form → CAPTCHA broker → actual server client and
photo worker covered first/second success, two rejections, unknown and redirect.
Failure produced exactly one photo through a synthetic sendPhoto. A separate
scenario actually runs the CPU model on PNG pixels extracted from browser canvas.
These are local fixtures, not proof that HH accepted an answer. The first fixture
mistakenly allowed a browser redirect to a public HH page; the corrected run
forcibly disables networking. It used no production profile/credentials and
submitted no answers to the site.

Other tests cover budgets and serialization, invalid OCR, interrupted attempts,
restart, existing human claims, repeated images, closed owner-scoped state,
generic-backend refusal and early-delivery suppression. All ten original
recognition tests passed. Final results: server 725/725, Telegram contract 65/65,
browser 52/52 with four Linux-only skips, worker 10/10, Compose policy 5/5 and
browser acceptance 2/2. A clean local Python environment installed the same
proposed package versions and passed `pip check`, worker tests and actual CPU-model
acceptance. Compose overlay structure was checked without Docker. The source guard
correctly rejected the uncommitted local checkout; no deployment staging occurred.
Commands are in [verification](../verification.md).

Repeating CPU PNG parity in that clean environment also matched GPU on 73/73
outputs and labels on 72/73, with 0.772 s median and 1.159 s maximum latency.

Docker and WSL are unavailable on this PC. Linux build, clean-image dependencies,
UNIX socket permissions, cgroup CPU/memory, container restart and actual
Telegram/HH acceptance remain unchecked. Separate `Dockerfile.frozen`, hash-locked
CPU dependencies and a Compose overlay are proposed. Production Paddle/OpenCV/
RapidFuzz and their transitive dependencies require approval under AGENTS.
The default worker/image is unchanged; the new flag defaults to zero. Windows
runtime is unaffected, so no EXE build or installation is needed.

The next step requires approval for dependencies and publication to GitHub `main`.
After publication, both VPS source checkouts must be synchronized. DE would update
server/browser and the separate OCR worker after Linux build/tests. NL does not
run these components and needs a source check. Enablement follows worker/boundary
verification; real Telegram delivery and HH acceptance remain separate checks.
Backup/restore and unrelated services are unaffected.
