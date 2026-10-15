# HH Browser Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Execute inline in the existing task branch; no delegated agents.

**Goal:** Заменить сбор и подтверждённую отправку HH браузерным адаптером,
сохранив отдельный процесс DE и существующие Telegram/PostgreSQL границы.

**Architecture:** `job-browser` владеет единственным приватным профилем Chromium.
Ограниченный HTTP RPC доступен только в отдельной Docker network, без host ports;
запросы аутентифицированы отдельным секретом и связаны с одним настроенным owner ID.
Server/collector используют узкий клиент; модель не управляет браузером.

**Tech Stack:** CommonJS, Node HTTP/crypto/fs, согласованные Playwright/Chromium,
существующие PostgreSQL/Telegram модули; без новых production-пакетов.

**Spec:** [Браузер DE согласован](../specs/2026-10-15-job-search-without-api-options.md),
[исходный пользовательский контракт](../specs/2026-10-15-job-search-design.md).

## Global Constraints

- Никакого публичного RPC/CDP и передачи сессии HH основному серверу.
- Строгий owner scope, закрытый набор операций/аргументов, bounded HTTP bodies.
- Read-only исследование блокирует все не-GET/HEAD/OPTIONS запросы и не нажимает
  «Откликнуться» на реальном сайте до установления семантики формы.
- Единственное резюме выбирает владелец; при нескольких не подменять выбор.
- Любой live submit требует точной версии письма и отдельного подтверждения.
- Unknown после клика не повторяется; original operation ID и durable ledger.
- CAPTCHA/сессия/анкеты возвращают закрытый needs-attention/manual статус.
- Publication/release и реальный отклик отдельно; текущая работа локальная.

### Task 1: Фактический DOM и адаптер чтения

**Files:** `job-browser/src/hhPageReader.js`, `src/hhBrowser.js`,
`test/hhPageReader.test.js`, `test/hhBrowserAcceptance.cjs`.

**Interfaces:** `readSearchPage(page)` → `{ items:[{id}],found,pages }`;
`readVacancyPage(page,externalId)` → нормализованный snapshot домена;
`readResumes(page)` → приватные `{id,title}` без текста резюме.
`HhBrowser.search({query,publishedFrom,publishedTo,page})`,
`getVacancy({externalId})`, `listResumes()`; один сериализованный browser context.

- [x] Провести read-only исследование настоящих DOM search/vacancy/resume
  и ссылки на форму. Сохранять публичные fixtures отдельно от приватной сессии;
  в отчёт только наличие полей, количества и закрытые состояния.
- [x] Зафиксировать селекторы и реальную семантику страниц/дат/пагинации.
  Не выдумывать дату публикации и зарплату при отсутствии поля.
- [x] Написать проверку на локальном HTML-стенде реальным Chromium (route fixtures, сеть отключена):
  даты, pagination, URL validation, absent fields, CAPTCHA, login и изменённый DOM.
- [x] Реализовать минимальное чтение и прогнать тест. Прямую HTML-дату без
  timezone не считать ISO; выбрать наблюдаемый детерминированный формат.
- [x] Проверить одну публичную вакансию HH без печати текстов/ID профиля.

### Task 2: Приватный RPC и существующий сборщик

**Files:** `job-browser/src/rpcServer.js`, `src/protocol.js`,
`server/src/jobs/jobBrowserClient.js`, `jobConfig.js`, `collectorMain.js`,
`jobCollector.js`, `deploy/docker-compose.yml`, `deploy/env.example`.

**Interfaces:** RPC `search`, `vacancy`, `resumes`, `inspect`, `submit`, `reconcile`.
Пока операция не реализована, она недоступна; не возвращать фиктивный успех.
`JobBrowserClient.forUser(userId)` → HH-compatible read client с привязкой owner.

- [x] Проверить bad auth/foreign actor/extra keys/oversized payload/unknown
  operations через настоящий HTTP server, без доступа к HH.
- [x] Реализовать constant-time auth, strict protocol и последовательную очередь,
  bounded response и закрытые ошибки. Health не раскрывает данные аккаунта.
- [x] Переключить opt-in collector на browser driver; различать возможности
  web pagination/date windows и старого API. Не объявлять весь период собранным
  при недоступной последней странице.
- [x] PG + browser fixture E2E: поиск → нормализация → фильтры → одна очередь
  карточек, рестарт/checkpoint/dedup. Все старые тесты остаются.
- [x] Compose отдельного browser профиля: собственная сеть, приватный volume,
  non-root sandbox, bounded CPU/memory, отдельный RPC secret и owner ID.

### Task 3: Резюме и форма с подтверждённой отправкой

**Files:** `job-browser/src/hhApplication.js`, `src/applicationLedger.js`,
`server/src/jobs/jobRuntime.js`, `jobApplicationService.js`,
`test/jobApplicationsAcceptance.cjs`, browser fixture acceptance.

- [x] По наблюдаемому DOM установить безопасный способ открытия формы.
  Нажатие кнопки, способной отправить отклик сразу, не является read-only probe.
- [ ] Сопоставить выбранное resume ID, вакансию и точный текст письма;
  анкета или неизвестная форма → manual_required. Одобрение привязано к
  сохранённой PostgreSQL operation, повторному inspect и текущим revision.
- [ ] До клика записать browser ledger mode 0600 с operation ID и hash пары;
  дубль с другим ID не отправлять, неподтверждённый результат оставить unknown.
- [ ] Reconcile только читает исходный результат в HH; отсутствие результата
  одной пробы не разрешает повторный submit.
- [ ] Реальный Chromium fixture + PG: потеря ответа после клика, рестарт,
  foreign scope, изменившаяся форма, duplicate clicks, removed resume и CAPTCHA.
- [ ] Подключить runtime без изменений уже одобренных Telegram labels/grammar;
  любые расширения меню сначала отдельно описать и согласовать.

### Task 4: Контрольная точка перед выпуском

- [ ] Focused Telegram gate, полный server test, PostgreSQL acceptance и
  browser fixture E2E. Live чтение отмечать отдельно от fixture отправки.
- [ ] Обновить документы по фактической готовности, сохранить локальные коммиты.
- [ ] Предложить выпуск конкретных компонентов после доступных проверок.
  До поручения не push/deploy. Реальная отправка только на выбранную
  владельцем вакансию после просмотра и подтверждения письма.

## Контрольная точка 15 октября

Task 1–2 выполнены. Единый Chromium + RPC + PG E2E прошёл на Windows
с установленным Edge в headless; pinned Chromium DE отдельно прошёл fixtures
и живое чтение HH. Task 3: read-only
`inspect` уже проверяет единственное основное резюме, форму, скрытую видимость,
неизвестные вопросы и признаки существующего отклика. Письмо не заполняет
и submit не предоставляет. Реальная форма сообщает `JOB_HH_RESUME_HIDDEN`;
решение о видимости запрошено у владельца. Это не разрешает менять приватность.
