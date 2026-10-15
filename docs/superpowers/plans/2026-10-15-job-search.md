# Поиск работы: план реализации

**Обновление 15 октября:** задачи подключения официального applicant API
остановлены после приведённого владельцем уведомления о прекращении поддержки.
До продолжения этих задач требуется согласовать [новый канал](../specs/2026-10-15-job-search-without-api-options.md)
и обновить план. Уже проверенные доменные и Telegram-компоненты сохраняются.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Порядок для этой задачи: выполнение в текущем чате через доступный
`executing-plans`, без автоматического запуска субагентов. Указанный выше
вариант subagent-driven-development не установлен и не требуется.

**Goal:** Доставлять вакансии HH в существующий Telegram Jarvis и по выбору
владельца готовить, редактировать и отправлять подтверждённый отклик.

**Architecture:** Ядро в `server/src/jobs/`, адаптер HH, PostgreSQL и отдельный
сборщик DE. Основной сервер владеет Telegram polling и доставкой очереди;
модель вызывается только по явному запросу. Подключение и отправка отделены
от поиска, чтобы не блокировать проверку карточек отсутствием HH-авторизации.

**Tech Stack:** Node.js/CommonJS, Fastify, PostgreSQL, существующие pg/zod/grammy,
стандартные fetch/crypto, общий OpenRouter-транспорт, существующий Compose.

**Spec:** [Согласованная спецификация](../specs/2026-10-15-job-search-design.md).

Статус плана: выполняется локально. Имена ниже задают целевую структуру;
наличие конкретного модуля и его готовность проверяются по коду и тестам.

### Контрольная точка 15 октября

Реализованы конфигурация, PostgreSQL-хранилище, фильтры, самостоятельный сборщик,
карточки/настройки/профиль Telegram, генерация/правки/перевод, учёт расходов,
основной runtime и opt-in Compose-профиль. Это существенная часть задач 1–7
и 10; чекбоксы отдельных приёмочных/выпускных действий не закрыты автоматически.

Выполнены 625 серверных тестов, 65 тестов Telegram regression gate,
12 доменных real-PG сценариев, локальный HTTP/SDK E2E с подтверждением,
потерей ответа и проверкой исходной операции без повторного POST,
полный runtime с 32 миграциями и настоящим pgvector. Источник результатов:
[запись разработки](../../updates/2026-10-15-job-search-development.md).

State machine задачи 9 реализована и проверена через доверенный тестовый
коннектор. Production-адаптер не подключён. Задача 8 и реальная отправка
требуют проверки доступного HH-канала: актуальная официальная
OpenAPI не содержит прежние applicant send/resume-list операции. Поиск
без авторизации в живой пробе вернул 403; добавлена конфигурация `HH_APP_TOKEN`
для разрешённого чтения. Отправка не подменяется тестовым успехом. Владельцу
направлен вопрос о действиях при недоступном API; остальные проверки продолжаются.

## Global Constraints

- «До отправки карточки модель не вызывается.»
- «Нет фильтра по стажу, образованию, уровню junior/middle/senior, технологиям или необходимости учиться.»
- «3 USD — месячный порог уведомления, не жёсткий лимит.»
- «Месяц календарный по Europe/Moscow, расходы в USD, только для поиска работы.»
- «Первый проход охватывает последние 14 дней. Затем проверка каждые 30 минут».
- CommonJS, UTF-8; без новых production-зависимостей и изменений Desktop/VPN.
- Секреты и приватный профиль не попадают в Git, callback, промпт вакансии или диагностику.
- Проверять владельца и исходный чат; новая версия письма аннулирует подтверждение.
- Не повторять неизвестный результат отправки под новым ID.
- Существующий API-ключ используется через `OPENROUTER_API_KEY`; не печатать значение.
- План не разрешает push, PR, deploy, реальные отклики или изменение production.
- Обязательны AGENTS, release-workflow, оба Telegram-документа и verification.

## Карта файлов и интерфейсов

Новые модули организованы по задаче, без изменения остальных доменов:

| Файлы | Ответственность |
| --- | --- |
| `server/src/jobs/jobSchemas.js`, `jobSearchDefaults.js` | Закрытые структуры, группы запросов и значения по умолчанию |
| `jobFilters.js`, `salaryRules.js`, `currencyRates.js` | Чистые правила и датированные курсы |
| `jobSearchRepository.js`, `jobProfileRepository.js` | Owner-scoped настройки, профиль, вакансии и пользовательские состояния |
| `jobDeliveryRepository.js`, `jobDeliveryWorker.js` | Очередь карточек и результат Telegram-доставки |
| `hhClient.js`, `hhConnectionService.js`, `hhConnectionRoutes.js`, `jobSecretBox.js` | Ограниченный транспорт HH, OAuth и защита токенов |
| `jobCollector.js`, `collectorMain.js` | Сбор, страницы, checkpoint и самостоятельный процесс |
| `jobModelAdapter.js`, `jobPrompt.js`, `jobDraftService.js` | Генерация и версии писем |
| `jobDraftRepository.js`, `jobUsageRepository.js` | Черновики, стоимость, месячное уведомление |
| `jobApplicationRepository.js`, `jobApplicationService.js` | Подтверждение, отправка, reconciliation |
| `jobTelegramCallbacks.js`, `jobTelegramViews.js`, `jobTelegramService.js` | Закрытые callback, представление и действия Telegram |

Все перечисленные файлы находятся в `server/src/jobs/`. Новые тесты лежат
в `server/test/` и используют префикс `job` либо `hhConnection`.
Миграции — `029_job_search.sql`, `030_job_search_interactions.sql`;
перед созданием повторно проверить номера и выбрать следующие свободные,
сохранив имена и миграции чужой работы.

Общий scope: `{ userId, conversationId, chatId, channel: 'telegram' }`;
ID — UUID, chatId — строка. Домен проверяет этот scope, не только UI.
Методы принимают объект аргументов. В репозиториях используется `pool`
и параметризованный SQL; clock и внешние транспорты инъецируются для тестов.

## Task 1: Предварительная проверка и изолированная конфигурация

**Files:** читать `AGENTS.md`, `docs/release-workflow.md`, `deploy/README.md`,
`server/src/runtime.js`, `config/loadConfig.js`, `providers/providerFactory.js`;
изменять `server/src/config/loadConfig.js`, `deploy/env.example`;
тест `server/test/jobConfig.test.js`.

**Interfaces:** `loadConfig()` добавляет `jobSearchEnabled`,
`jobCollectorIntervalMs`, `jobHistoryDays`, `jobSearchModel`, `jobBudgetUsd`,
`jobSecretKey`. Значения: false, 1800000, 14, пустая модель, 3, секрет из env.
`OPENROUTER_API_KEY` остаётся существующим ключом общего транспорта.

- [ ] Повторить read-only аудит и live-сверку перед началом реализации:

```powershell
py deploy/scripts/release-status.py --fetch --vps
git worktree list
gh pr list --state open --json number,headRefName,baseRefName
```

Учитывать текущую ветку `codex/job-search-design`; не создавать цепочку веток
и не считать её ожидаемую грязную документацию production-проблемой.
Состояние DE/NL и server health проверять по runbook без вывода env.

- [ ] Добавить тест defaults и отказа нечисловому/неположительному интервалу:

```js
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config/loadConfig');
const config = loadConfig({ NODE_ENV: 'test', JARVIS_JOB_SEARCH_ENABLED: 'false' });
assert.equal(config.jobSearchEnabled, false);
assert.equal(config.jobBudgetUsd, 3);
assert.equal(config.jobHistoryDays, 14);
```

Сигнатура проверена: `loadConfig(env = process.env)`.
Секреты в тест не подставлять, использовать синтетические значения.
- [ ] Запустить `node --test test/jobConfig.test.js` из `server`, зафиксировать
ожидаемый провал новых полей, затем добавить конфигурацию без включения функции.
- [ ] Проверить ключ только булевым признаком внутри сервиса; отсутствие
блокирует генерацию, но не сбор. Не выполнять API-запрос для проверки на этом этапе.
- [ ] Повторить тест и существующий config-тест. Локальный коммит:
`feat: add isolated job search configuration` после проверки diff.

## Task 2: Данные, owner scope и постоянная очередь

**Create:** `jobSchemas.js`, пять репозиториев поиска/профиля/доставки/писем/расходов,
`jobApplicationRepository.js`; миграция `029_job_search.sql`.
**Tests:** `jobRepositories.test.js`, `jobPostgresAcceptance.cjs`.

**Interfaces:**
- `JobSearchRepository.upsertVacancy({ source, externalId, snapshot })`,
  `getSettings({ userId })`, `saveSettings({ scope, expectedRevision, settings })`,
  `recordMatch({ userId, vacancyId, filterRevision })`, `saveCheckpoint({ userId, checkpoint })`.
- `JobProfileRepository.get({ userId })`,
  `replace({ scope, expectedRevision, profile })` возвращают versioned профиль.
- `JobDeliveryRepository.enqueue({ userId, vacancyId })`, `claim({ workerId })`,
  `finish({ deliveryId, outcome, telegramMessageId })`.
- `JobDraftRepository.get({ userId, draftId })`,
  `append({ scope, vacancyId, profileRevision, parentDraftId, text, facts })`.
- `JobUsageRepository.record({ userId, requestId, costUsd, outcome, occurredAt })`,
  `getMonth({ userId, now })`, `claimBudgetNotice({ userId, month, thresholdUsd })`.
- `JobApplicationRepository` хранит один активный отклик для пары owner/vacancy/resume,
  подтверждения, immutable approved text, исходный operationId и статусы.

- [ ] Написать real-PG тест на foreign scope, две конкурентные enqueue,
перезапуск и повтор `requestId` учёта расходов. Ожидаемые проверки:

```js
assert.equal(await countDeliveries(userId, vacancyId), 1);
assert.equal(await foreignOwnerCanReadDraft(), false);
assert.equal(await duplicateUsageChangesTotal(), false);
```

`countDeliveries`, `foreignOwnerCanReadDraft`, `duplicateUsageChangesTotal`
определить в acceptance-файле над fixture-schema и реальными репозиториями;
не заменять SQL in-memory коллекцией.
- [ ] Запустить в отдельной тестовой БД, проверить провал до миграции.
- [ ] Создать таблицы `job_searches`, `job_profiles`, `job_connections`,
`job_vacancies`, `job_matches`, `job_deliveries`, `job_drafts`, `job_usage`,
`job_budget_notices`, `job_applications`, `job_confirmations`, `job_tasks`.
Unique: source/externalId, owner/vacancy delivery, owner/requestId usage,
owner/month/threshold notice. Версии, timestamps и CHECK закрытых статусов обязательны.
- [ ] Реализовать claim через короткую транзакцию и `FOR UPDATE SKIP LOCKED`;
не держать SQL-транзакцию во время сетевого запроса. Истёкший lease внешней
мутации переходит в unknown, а не прямо в повторную отправку.
- [ ] Повторить real-PG тест и миграцию второй раз; commit
`feat: persist owner scoped job search state`.

## Task 3: Детерминированный отбор и оплата

**Create:** `jobSearchDefaults.js`, `jobFilters.js`, `salaryRules.js`, `currencyRates.js`.
**Tests:** `jobFilters.test.js`, `jobSalaryRules.test.js`.

**Interfaces:** `evaluateVacancy({ vacancy, settings, rateSnapshot })`
→ `{ include, reasonCodes, annotations }`;
`evaluateSalary({ salary, description, targetRub, rateSnapshot })` — тот же формат;
`CurrencyRates.get({ date })` → датированный курс или classified unavailable.
Причины — закрытые enum, текст вакансии не становится диагностикой.

- [ ] Тестами зафиксировать 100k net, 80–150k, только upper bound,
фиксированные 90k net, неизвестные налоги, премии, hourly, конфликт полей,
неизвестный курс и foreign currency; два ключевых примера:

```js
assert.equal(evaluateVacancy({ vacancy: aiSeniorWithoutSalary, settings }).include, true);
assert.equal(evaluateVacancy({ vacancy: coldCallSalesRole, settings }).include, false);
```

Fixtures задаются литералами безопасных вымышленных вакансий в тесте.
- [ ] Запустить `node --test test/jobFilters.test.js test/jobSalaryRules.test.js`.
- [ ] Реализовать нормализацию регистра, русских вариантов и поиск по названию/
описанию; use-cases продаж отличать от обязанностей продавать. Не использовать LLM.
- [ ] Ввести все группы из спецификации; годы опыта и образование не входят
в exclude. Salary unknown остаётся include с annotation; неоднозначный текст
не превращать в надёжно извлечённую сумму. Курс получать ограниченным fetch.
- [ ] Повторить тесты; commit `feat: add broad deterministic AI job filters`.

## Task 4: HH-сборщик с checkpoint

**Create:** `hhClient.js`, `jobCollector.js`, `collectorMain.js`.
**Modify:** `server/package.json` (script `jobs:collect`, без зависимостей).
**Tests:** `jobCollector.test.js`, `jobHhClient.test.js`.

**Interfaces:** `HhClient.search({ query, publishedFrom, page, signal })`,
`getVacancy({ externalId, signal })`; нормализованные записи не содержат credentials.
`JobCollector.runOnce({ userId, now })` → counts и closed outcome;
`collectorMain` создаёт config/pool/repos/collector, не создаёт Telegram bot.

- [ ] Перед реализацией сверить актуальный официальный HH OpenAPI:
параметры поиска, страницы, временные ограничения, rate limits и User-Agent.
Сохранить в тестовых fixtures только форму ответа и вымышленные данные.
- [ ] Тест: два запроса находят один ID, pages проходят полностью, ошибка
середины прохода не продвигает checkpoint; collector model-spy имеет 0 вызовов.

```js
assert.equal(modelCalls.length, 0);
assert.equal(deliveriesForSameExternalId.length, 1);
assert.equal(checkpointAfterFailedPage, checkpointBeforeFailedPage);
```

- [ ] Ограничить response bytes при stream-read до JSON.parse, тайм-аут,
число страниц/проход и retries. `429` учитывает Retry-After, `401/403`
классифицируется без автоматической бесконечной переавторизации.
- [ ] Реализовать поиск 14 дней, последующие перекрывающиеся окна,
claim на owner/search, проверку паузы, enqueue всех include.
Дедупликация не зависит от текста названия. Проверить shutdown по SIGTERM.
- [ ] Тесты плюс `node --check src/jobs/collectorMain.js`; commit
`feat: collect HH vacancies in a standalone worker`.

## Task 5: Карточки, вход в меню и очередь Telegram

**Create:** `jobTelegramCallbacks.js`, `jobTelegramViews.js`, `jobTelegramService.js`,
`jobDeliveryWorker.js`.
**Modify:** `runtime.js`, `telegram/bot.js`, `telegram/messageService.js`,
`telegram/telegramMenuService.js`; оба Telegram-документа.
**Tests:** `jobTelegram.test.js`, `jobDelivery.test.js` и действующий regression gate.

**Interfaces:** `parseJobCallback(data)` → закрытые action/ID;
`JobTelegramService.handle({ scope, action, targetId })` → безопасная reply;
`JobDeliveryWorker.tick()` использует `sendTelegramText` из существующего транспорта.
Сборщик лишь пишет queue, bot polling существует только в основном runtime.

- [ ] До первой правки пути отправить owner change notice: новый inline
вход из Home, карточка → действие → domain → очередь/ответ; вероятные файлы
выше, неизменная нижняя клавиатура, owner-only private chat, regression и live taps.
- [ ] Тест через настоящий message/menu handler: owner видит вход, member
не видит и не может вызвать напрямую; foreign chat и oversized callback отклонены.
Карточка не вызывает модель. «Скрыть» не меняет фильтр и HH.
- [ ] Ввести грамматику `job:<action>:<uuid>` с фиксированными actions,
menu actions без тела. ID черновика определяет его ревизию в БД; не помещать
номер+длинный payload в callback. Разрешить HTTPS HH URL по проверенному hostname,
без расширения общего URL gate на произвольные адреса.
- [ ] Реализовать queue delivery, known success/messageId, known fail/retry,
unknown при потере ответа. Один in-flight send на delivery. Не обещать exactly-once
для неизвестного результата Bot API; показать диагностику в статусе поиска.
- [ ] Проверить карточку длинного описания, escaping, отсутствие зарплаты,
пагинацию сохранённых/откликов и pause/resume; commit
`feat: deliver job cards through the existing Telegram bot`.

## Task 6: Профиль, настройки и typed guided input

**Modify:** `jobTelegramService.js`, `jobTelegramViews.js`, `jobProfileRepository.js`,
`telegram/telegramInteractionRepository.js`, `telegram/messageService.js`;
миграция `030_job_search_interactions.sql`.
**Tests:** `jobGuidedInput.test.js` и real-PG acceptance.

**Interfaces:** новые kinds: `job_settings_edit`, `job_profile_edit`,
`job_draft_edit`, `job_draft_translate`. Context shape:
`{ targetId, revision }`, UUID и positive integer, без дополнительных keys.
Все четыре входят одновременно в runtime allowlist и актуальный PG CHECK.

- [ ] Тесты настоящего `begin` + message handlers: invalid retry,
success, single consumption, expiry, foreign user/chat/conversation,
конфликт expectedRevision. Не подменять `begin` stub-функцией.
- [ ] Добавить forward-only CHECK migration, сохранив каждый существующий kind.
Настройки проверять закрытой zod shape: запросы, исключения, оплата,
география, interval/history, model, notice budget; не принимать shell/SQL.
- [ ] Ввод профиля хранить приватно с revision/facts/examples и признаком
подтверждения; обычный диалог сам не добавляет подтверждённые достижения.
- [ ] Перед записью фильтров показывать before/after и owner confirmation.
`Проверить сейчас` ставит deduped job, не обходит rate limits; historical
recheck сохраняет delivered IDs.
- [ ] Запустить `node --test test/jobGuidedInput.test.js`, PG acceptance;
commit `feat: manage job settings and confirmed facts in Telegram`.

## Task 7: Письма по кнопке и фактические расходы

**Create:** `jobModelAdapter.js`, `jobPrompt.js`, `jobDraftService.js`.
**Modify:** `providers/openAiCompatibleProvider.js`, `jobUsageRepository.js`,
`jobTelegramService.js`, `jobTelegramViews.js`.
**Tests:** `jobDraftService.test.js`, `jobBudget.test.js`, существующий provider-тест.

**Interfaces:** общий provider получает `answerWithUsage({ text, messages, maxTokens })`
→ `{ text, usage, requestId }`; прежний `answer()` возвращает только строку,
поэтому обычные диалоги сохраняют контракт.
`JobModelAdapter.generate({ messages, maxTokens, userId, requestId })` → text/usage;
`JobDraftService.generate({ scope, vacancyId, parentDraftId, instruction, language })`
→ новый immutable draft. usage.cost неизвестный → pending reconciliation, не zero.

- [ ] Тест: prepare вызывает модель один раз и HH-send ноль раз;
повторный update не генерирует; перегенерация создаёт новую версию,
ошибка сохраняет старую. `answer()` по-прежнему string.
- [ ] Разделить trusted instruction и untrusted vacancy/profile data.
Ограничить вход и output; ответ закрытой shape `{ text, factIds }`,
неизвестные factIds отклоняются. Факты не выводить в diagnostics.
Проверка ссылок на факты не считается полной защитой от выдумок: финальный
контроль — просмотр владельцем плюс отдельная модельная приёмка.
- [ ] Реализовать редактирование/перевод, auto language, 2–3 релевантных
подтверждённых кейса без заполнения квоты выдумками. Нет скрытых генераций
при сборе, сохранении или открытии карточки.
- [ ] Тест месяца на границе UTC/Moscow, duplicate usage, переход 2.99→3.01,
одна notification, дальнейший запрос разрешён. Оплаченная попытка с ошибкой
учитывается; неустановленная стоимость явно pending.
- [ ] Запустить focused tests и provider regression; commit
`feat: generate approved fact based job letters with usage accounting`.

## Task 8: Подключение HH и одно резюме

**Create:** `hhConnectionService.js`, `hhConnectionRoutes.js`, `jobSecretBox.js`.
**Modify:** `hhClient.js`, `runtime.js`, `jobTelegramService.js`, `loadConfig.js`,
`deploy/env.example` (только названия переменных).
**Tests:** `hhConnection.test.js`, `jobSecretBox.test.js`.

**Interfaces:** `HhConnectionService.begin({ scope })` → authorization URL;
`complete({ state, code })` → safe connection status;
`selectResume({ scope, resumeId })` → revision; `disconnect({ scope })`.
`JobSecretBox.seal({ userId, payload })` / `open({ userId, blob })`.

- [ ] Проверить текущую регистрацию HH-приложения, требуемые разрешения,
callback и доступность методов резюме/отклика по официальной документации.
Не считать OpenRouter-ключ авторизацией HH; если доступа нет, зафиксировать
это как блокировку live-send, продолжить другие независимые задачи.
- [ ] Тест state: случайный nonce, один раз, TTL, owner/chat binding,
истёкший/чужой/повторный отказ; callback не логирует query string.
- [ ] Реализовать OAuth без передачи пароля. AES-256-GCM стандартным crypto,
случайный nonce, AAD owner, отдельный runtime key; не переиспользовать
ключи VPN/visual memory. Запись токенов и refresh с row lock/lease и revision,
чтобы refresh не размножался. Unknown refresh не повторять слепо.
- [ ] Показать доступные резюме и сохранить одно выбранное. Отозванный токен
→ connection attention; резюме недоступно → отправка запрещена, без выбора замены.
- [ ] Запустить тесты, проверить отсутствие секретов в ответах и логах;
commit `feat: connect HH applicant account and primary resume`.

## Task 9: Одобренная отправка и неизвестные результаты

**Create:** `jobApplicationService.js`.
**Modify:** `jobApplicationRepository.js`, `hhClient.js`, `jobTelegramService.js`,
`jobTelegramViews.js`; **Tests:** `jobApplications.test.js`, real-PG acceptance.

**Interfaces:** `prepareConfirmation({ scope, draftId })` → frozen preview + ID;
`confirm({ scope, confirmationId })` → operation status;
`reconcile({ scope, operationId })` → known result или unknown;
`HhClient.apply({ vacancyId, resumeId, letter, credential })`,
`lookupApplication({ vacancyId, resumeId, credential })` — по проверенному HH контракту.

- [ ] Тест: generate/edit/translate не отправляют; confirmation TTL 600000ms;
два confirm создают один apply, foreign/stale/expired не создают apply.

```js
assert.equal(hhApplyCalls.length, 1);
assert.equal(await confirmOldDraftAfterEdit(), 'stale');
assert.equal(await repeatUnknownOperation(), 'unknown');
```

Функции-помощники в тесте используют реальный service и fixtures repositories;
конкурентность повторно проверяется настоящим PostgreSQL.
- [ ] Зафиксировать confirmation атомарно с immutable letter/resume/vacancy
revision. До сетевого запроса сохранить operationId и sending. Изменение
профиля/резюме/вакансии требует свежего preview и подтверждения.
- [ ] Определённый отказ отличать от timeout/connection loss. Сохранять unknown,
проверять исходную пару vacancy/resume через API; отсутствие результата
одной пробы не доказывает, что POST не был обработан. Не делать новый POST
пока исходная отправка не разрешена достоверно.
- [ ] При external form/дополнительных шагах вернуть manual_required,
готовое письмо и HH URL. Уже существующий отклик не дублировать.
Only verified provider result даёт `sent`; Telegram delivery не определяет успех HH.
- [ ] Повторить тесты и PG race suite; commit
`feat: submit version bound HH applications after owner confirmation`.

## Task 10: Runtime, развёртываемый сборщик и итоговая приёмка

**Create:** `server/src/jobs/jobRuntime.js`, `server/test/jobRuntime.test.js`,
`server/test/jobModelAcceptance.cjs`.
**Modify:** `runtime.js`, `deploy/docker-compose.yml`, `deploy/README.md`,
`docs/runtime-context.md`, `docs/README.md`, Telegram menu contract.

**Interfaces:** `createJobRuntime({ config, pool, botTransport, clock })`
→ `{ telegramService, deliveryWorker, close }`; feature off не создаёт
workers/routes/menu. Collector uses `collectorMain`, не `createRuntime()`.

- [ ] Тест feature off, graceful close, один polling bot, collector без
Telegram token и без model factory, рестарт с queue/checkpoint; cycle без HH
credentials поддерживает только разрешённый публичный сбор.
- [ ] Compose: отдельный профиль `job-search-de`, command
`node src/jobs/collectorMain.js`, тот же server image, private backend network,
PostgreSQL, без ports/socket/sudo/Telegram key. Профиль запускается только DE;
NL получает исходники, но не запускает сборщик. Существующие bind mounts
и production env сохраняются по release-workflow.
- [ ] В основном сервере включить domain через jobRuntime, без разрастания
runtime.js всей бизнес-логикой. Включение feature не делает автоматический
отклик, генерацию или историческую рассылку до подтверждённой настройки владельца.
- [ ] Прогнать focused gate из Telegram menu contract, `server/npm test`,
real-PG acceptance. Сверить все 12 разделов спецификации с этими задачами.
Проверка сравнения моделей — opt-in, 10–15 приватных вакансий, два языка,
без записи материалов в Git; фактический API расход учитывается.
- [ ] Обновить статус по фактам. До выпуска предложить пользователю
конкретный результат, локальные проверки, компоненты и оставшуюся live-приёмку.
Не выполнять push/deploy по одному факту прохождения тестов.

После поручения на выпуск: source guard, GitHub main, оба VPS source,
изменившийся server runtime и сборщик DE, health/preflight/smoke.
Не запускать backup timer/restore и не пересобирать Desktop без изменений.
Live acceptance: owner/member меню, первые карточки, restart без дублей,
подготовка/правка/перевод, один выбранный реальный отклик только после
просмотра владельцем; вывод о статусе каждого шага отдельно.

Локальный коммит этапа: `feat: wire job search runtime and deployment profile`.

## Проверка плана перед исполнением

- Все тестовые shell-команды выполняются из `server`, если не указано иначе.
- Никакой тест без явного opt-in не обращается к живой модели, Telegram или HH.
- Тексты и credentials fixture вымышленные, запросы ограничены по размеру.
- Имена методов в задачах являются контрактом; изменение имени требует
одновременного исправления соседних задач и тестов.
- После каждого этапа diff, focused tests и локальный коммит только своих файлов;
не включать чужие файлы, секреты и runtime data.
- Промежуточно исправные карточки не объявлять полной готовностью отправки.
- Реализация — отдельный следующий шаг; этот документ не свидетельствует
о существовании миграций, подключения HH или работающего сборщика.
