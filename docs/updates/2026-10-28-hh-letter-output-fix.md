# Проверка ответа модели при создании письма / Cover-letter model output validation

## Русский

После исправления чтения резюме пользователь получил сообщение «Ответ модели
не прошёл проверку. Предыдущий черновик сохранён». Оно означает отказ при
разборе JSON или проверке его полей, а не ошибку чтения HH. Исторический ответ
модели не сохранялся, поэтому конкретный дефект той попытки установить нельзя.
Повторная диагностика на синтетических данных и на материалах последней
неудачной задачи сначала дала корректные ответы; новый черновик не создавался.

Затем полный запрос с production-настройками воспроизвёл обрыв: HTTP 200,
`finish_reason=length`, ровно 3000 токенов и неполный JSON. Один лишь строгий
формат этот сбой не устраняет. Проверка с низким уровнем рассуждения и запасом
до 6000 токенов завершилась успешно: `finish_reason=stop`, 3842 токена,
валидные структура и ссылки на факты. Однако повторная проверка с `low` вернула
пустой текст и `length` на 6000 токенах. Низкий effort оказался недостаточен.
Явное `reasoning.enabled=false` на тех же материалах дало полный ответ с `stop`
и 595 токенами. Адаптер писем теперь отключает reasoning и ждёт ответ до 120 секунд.
Модели с обязательным reasoning исключаются заранее. Если модель объявляет
параметр reasoning, каталог должен явно подтверждать `mandatory=false`.
Общий лимит генерации составляет 6000 токенов. Предел сохраняемого текста
остаётся 10000 символов. Настройка рассуждения обычного чата не меняется.

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

Локально прошли 890 серверных тестов и 10 PostgreSQL acceptance-сценариев,
включая невалидный JSON, неверную схему, обрезанный ответ, выдуманные fact IDs,
пустой обрезанный ответ, сохранность черновика, учёт расхода и запрет повторного
вызова. Независимая ревизия дефектов не нашла. На момент проверки живой каталог
содержал две бесплатные и две разрешённые платные модели с поддержкой схемы.
Доступность моделей может меняться.

Промежуточное серверное исправление установлено на DE: `8720496f11fc8ddfaade6ec3f54ac0a725ee881d`,
образ `jarvis-letter-output:8720496`. Linux-образ прошёл 887 тестов; два теста с
БД пропущены в изолированном запуске без сети и отдельно пройдены локально.
372 серверных файла и Compose release inputs совпали с принятой версией,
health healthy, readiness HTTP 200. Окружение, именованные хранилища и inode
смонтированных секретов проверены до замены контейнера. Изменён только server;
browser, Host Agent и Desktop не пересобирались. Оба VPS source и Windows
синхронизированы с GitHub main. Реальный отклик работодателю не отправлялся.
Обновление с отключением reasoning ещё не установлено. Проверка полного создания
письма через пользовательский интерфейс Telegram после выпуска остаётся за пользователем.

## English

After the resume-reader fix, the user received “The model response did not pass
validation. The previous draft has been preserved.” This indicates a JSON parse
or field-validation failure rather than an HH read failure. The original model
response was not retained, so its precise defect cannot be recovered. Diagnostic
generation with synthetic inputs and with materials from the latest failed task
initially returned valid responses without saving a new draft.

A full request using production settings then reproduced truncation: HTTP 200,
`finish_reason=length`, exactly 3000 tokens and incomplete JSON. Strict formatting
alone does not address this failure. A live request with low reasoning and a
6000-token allowance completed successfully: `finish_reason=stop`, 3842 tokens,
valid structure and fact references. However, a repeat with `low` returned empty
content and `length` at 6000 tokens. Low effort was insufficient. Explicit
`reasoning.enabled=false` on the same materials produced a complete response
with `stop` and 595 tokens. The letter adapter now disables reasoning and allows
up to 120 seconds. Models with mandatory reasoning are excluded before dispatch.
For models advertising a reasoning parameter, the catalog must explicitly
confirm `mandatory=false`. The total
generation allowance is 6000 tokens; saved letter text still has a 10000-character
limit. Ordinary chat reasoning settings are unchanged.

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

Local checks passed: 890 server tests and 10 PostgreSQL acceptance scenarios,
covering malformed JSON, wrong schema, truncation including empty output, invented fact IDs, draft
retention, usage accounting and request deduplication. Independent review found
no defects. The live catalog had two free and two approved paid schema-capable
models when checked; future availability can change.

The intermediate server fix is deployed on DE at `8720496f11fc8ddfaade6ec3f54ac0a725ee881d`,
image `jarvis-letter-output:8720496`. The Linux image passed 887 tests; two DB
tests were skipped in the isolated network-free run and passed separately locally.
All 372 server files and Compose release inputs match the accepted version;
health is healthy and readiness returns HTTP 200. Environment values, named
storage volumes and mounted secret inodes were compared before replacement.
Only the server changed; browser, Host Agent and Desktop were not rebuilt.
Both VPS source checkouts and Windows are synchronized with GitHub main.
No employer application was submitted. The update disabling reasoning has not
been deployed yet. A full letter-creation check through the user's Telegram
interface after deployment remains for the user.

API contract: [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs).
