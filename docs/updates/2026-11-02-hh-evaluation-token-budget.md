# HH: лимит оценки / Evaluation token allowance

## Русский

2 ноября после [выпуска контекста и ответов](2026-11-02-hh-context-and-answers-release.md)
проверено уведомление о временной недоступности для вакансии 138512145.
Ниже описано локальное исправление; на VPS оно ещё не установлено.

Сохранённая операция остановилась на оценке, до письма и отправки: статус unknown,
решение отсутствует, draft и application operation не созданы. Учёт провайдера
содержит failed с квитанцией и стоимостью $0.0002974. Значит, запрос дошёл до
модели; общее уведомление само по себе не доказывает сетевую недоступность.
Чтение метаданных исходного запроса не выполняло новый запрос к модели.

Провайдер указал 1024 native completion tokens и 1024 native reasoning tokens
при лимите оценки 1024. Весь выделенный объём ушёл на reasoning. Скрытие reasoning
из ответа не исключает его из лимита. Код отвергает ответ без корректного JSON и
объединяет такой отказ с недоступностью модели в личном уведомлении. Исходное
тело ответа не сохранялось; точный текст не восстановлен. Квитанция имеет stop,
поэтому диагностика не опирается только на finish reason.

Локально лимит оценки увеличен до 6000, как у генерации письма. Модель,
провайдерные ограничения, reasoning low, строгий формат и запрет повторов прежние.
Это максимальный объём, а не фиксированная стоимость каждого запроса. Лимит не
гарантирует завершения любого будущего ответа.

Проверка на отдельном вымышленном AI-профиле и вакансии с новым лимитом вернула
HTTP 200, stop и корректное DIRECTION_FIT: 767 completion tokens, из них
704 reasoning, стоимость $0.00015452. Это диагностическая проверка модели,
без настоящего отклика и изменения исходной операции. Узкие регрессии: 24/24.
Проверены cap запроса, формат решения, учёт невалидного/усечённого ответа и
отсутствие повторной отправки. Полный server suite: 916 прошли, 2 пропущены
без отдельной PostgreSQL; код БД в этом исправлении не меняется.

Исходная unknown-операция не переотправлялась и не ставилась в очередь заново.
Автопоиск может продолжить другие вакансии; уведомление не означает повтор этой
карточки. Для применения нужно опубликовать исправление и обновить DE server.
Миграции, browser, collector и Desktop не меняются.

## English

On November 2, after the [context and answers release](2026-11-02-hh-context-and-answers-release.md),
the temporary-unavailability notice for vacancy 138512145 was investigated.
This record describes a local repair, not an installed VPS update.

The saved operation stopped during evaluation before drafting or submission:
unknown status, no decision, draft or application operation. Provider accounting
records failed with a receipt and $0.0002974 cost. The model request reached the
provider; the generic notice does not establish network unavailability. Reading
the original generation metadata did not invoke the model again.

The provider reports 1024 native completion tokens and 1024 native reasoning
tokens with a 1024-token evaluation cap. Reasoning consumed the whole allowance.
Excluding reasoning from visible output does not exclude it from the cap. Code
rejects a missing valid JSON decision and maps that failure to the same private
notice as model unavailability. The original response body was not stored; its
exact text cannot be recovered. The receipt says stop, so this diagnosis does
not rely on finish reason alone.

The local repair raises evaluation to 6000 tokens, matching letter generation.
Model, provider restrictions, low reasoning, strict output and no-retry behavior
remain the same. This is a maximum allowance, not a fixed per-request cost, and
cannot guarantee every future response completes.

A separate fictional AI profile/vacancy probe with the new cap returned HTTP 200,
stop and valid DIRECTION_FIT: 767 completion tokens including 704 reasoning,
cost $0.00015452. It sent no real application and did not alter the original
operation. Focused regressions passed 24/24, covering request cap, decision format,
billed invalid/truncated output and no resubmission. Full server suite: 916 passed,
two skipped without isolated PostgreSQL; this repair changes no database code.

The original unknown operation was neither resubmitted nor requeued. Automation
may continue with other vacancies; the notice does not promise to retry this
card. Applying the repair requires publication and a DE server update. No
migrations, browser, collector or Desktop changes are needed.
