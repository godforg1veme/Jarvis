# Проверка ответа модели при создании письма / Cover-letter model output validation

## Русский

После исправления чтения резюме пользователь получил сообщение «Ответ модели
не прошёл проверку. Предыдущий черновик сохранён». Оно означает отказ при
разборе JSON или проверке его полей, а не ошибку чтения HH. Исторический ответ
модели не сохранялся, поэтому конкретный дефект той попытки установить нельзя.
Повторная диагностика на синтетических данных и на материалах последней
неудачной задачи дала корректные ответы; новый черновик не создавался.

Найдена слабая гарантия формата: JSON запрашивался только текстом инструкции.
Теперь JobModelAdapter передаёт строгую JSON-схему с обязательными `text` и
`factIds`, без дополнительных полей. Общий маршрутизатор выбирает для такого
запроса только модели с `structured_outputs` и требует поддержку параметров
на выбранном endpoint. Очередь бесплатных моделей, ценовые ограничения,
правила повторов и обычный чат сохраняют прежнее поведение.

Проверка на сервере остаётся обязательной: длина и структура письма, допустимые
ссылки на факты, актуальное резюме и его ревизия проверяются до сохранения.
Обрезанный или отфильтрованный ответ отклоняется. В payload неудачной задачи
сохраняется только закрытая причина: `json`, `schema`, `truncated`, `filtered`,
`size` или `facts`. Текст ответа, письма и резюме туда не попадает. Прежний
черновик остаётся текущим, расход модели учитывается, повтор того же request ID
не вызывает модель ещё раз. Изменение применяется ко всем профилям.

Локально прошли 888 серверных тестов и 10 PostgreSQL acceptance-сценариев,
включая невалидный JSON, неверную схему, обрезанный ответ, выдуманные fact IDs,
сохранность черновика, учёт расхода и запрет повторного вызова. Независимая
ревизия дефектов не нашла. Проверка живого каталога обнаружила две бесплатные
и две разрешённые платные модели с поддержкой схемы; это состояние на момент
проверки, а не гарантия будущей доступности.

Выпуск и проверка живого structured-output запроса ещё не завершены.
Реальный отклик работодателю при диагностике не отправлялся.

## English

After the resume-reader fix, the user received “The model response did not pass
validation. The previous draft has been preserved.” This indicates a JSON parse
or field-validation failure rather than an HH read failure. The original model
response was not retained, so its precise defect cannot be recovered. Diagnostic
generation with synthetic inputs and with materials from the latest failed task
returned valid responses without saving a new draft.

The format guarantee was weak: JSON was requested only in the prompt. The job
adapter now sends a strict JSON schema requiring `text` and `factIds`, with no
extra fields. For these requests, routing selects models advertising
`structured_outputs` and requires endpoint parameter support. Free-model order,
price caps, retry rules and ordinary chat behavior are preserved.

Server validation remains mandatory. Letter size and shape, allowed fact IDs,
the selected resume and its revision are checked before saving. Truncated or
filtered output is rejected. Failed-task payloads retain only a closed reason:
`json`, `schema`, `truncated`, `filtered`, `size` or `facts`. No letter, model
response or resume text is stored there. The current draft survives a failure,
model usage is accounted for, and repeating the same request ID never calls the
model again. This applies to every profile.

Local checks passed: 888 server tests and 10 PostgreSQL acceptance scenarios,
covering malformed JSON, wrong schema, truncation, invented fact IDs, draft
retention, usage accounting and request deduplication. Independent review found
no defects. The live catalog had two free and two approved paid schema-capable
models when checked; future availability can change.

Deployment and a live structured-output check are still pending. No employer
application was submitted during diagnosis.

API contract: [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs).
