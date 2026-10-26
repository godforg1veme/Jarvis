# Mini App button reliability implementation plan

> Выполнять по задачам с проверкой результата каждого этапа; следовать AGENTS.md.

**Goal:** Поэтапно устранить все проблемы аудита Mini App, начиная с тупиков и гонок.

**Architecture:** Сохраняем существующий интерфейс, серверные сервисы, scopes и
исходные ID операций. Устойчивые квитанции отделяют подтверждённую ошибку от
неизвестного результата; поколения запросов предотвращают устаревшие UI updates.

**Tech Stack:** Node.js CommonJS, Fastify, PostgreSQL; ES modules, Playwright/Edge.

**Spec:** `docs/superpowers/specs/2026-10-26-mini-app-button-reliability-design.md`.

## Ограничения

- Новых production dependencies нет; секреты не выводить и не сохранять.
- Не повторять неизвестные операции с новым ID и не снимать подтверждения.
- Исходники локально, без push/deploy; Desktop runtime не меняется.
- Сохранить весь объём задачи: последующие этапы не считать выполненными заранее.

## Этап 1: диалог и HH

- [x] Сервер: добавить конечный статус ошибки и ограничение зависших запросов
  через новую миграцию и небольшой сервис квитанций; изменить только Mini App
  assistant handlers и acceptance fixtures. Проверить единственный вызов модели,
  сверку UUID, отсутствие позднего ответа после завершения и текущие права.
- [x] Клиент: обрабатывать подтверждённую ошибку квитанции, сохранять unknown и
  исходный UUID после reload; освобождать ввод только по конечному результату.
  Проверено отдельным `scripts/testMiniAppReliability.cjs` на production assets.
- [x] HH: в `mini-app/src/jobConnection.js` добавить поколение сессии и защиту
  результатов после await; добавить fixture cancel + delayed authenticated,
  dispose + late response и новую сессию после старой ошибки.

## Этап 2: списки и права

- [x] В `mini-app/src/admin.js` применять только последнюю загрузку, включая
  обработку ошибок и индикаторы; проверить обратный порядок success/error.
- [x] В чтении сохранённого результата и duplicate POST повторить authorize
  перед ответом; проверить отзыв права внутри задержанного чтения.

## Приёмка этапов 1–2

- [x] Build Mini App; client/interiors/orbital/HH touch browser fixtures.
- [x] Focused server tests и полный `npm test --prefix server`.
- [x] Проверить наличие отдельной тестовой PostgreSQL, выполнить acceptance,
  либо зафиксировать конкретное ограничение без production database.
- [x] Независимая ревизия diff, исправление замечаний, русская/английская запись
  локального результата и ссылки в текущих документах.

26 октября: 866/866 server tests без пропусков с отдельной PostgreSQL 16;
12/12 Mini App PostgreSQL acceptance; шесть браузерных наборов прошли.
Источники проверок и ограничения:
[результат этапов 1–2](../../updates/2026-10-26-mini-app-button-reliability-development.md).

## Следующие этапы

Этап 3 выполняется через `sectionNavigation.js`, проверенный серверный `actions`
в ответе раздела, обработку закрытого start-параметра существующим Telegram menu
service и ссылки в `sectionViews.js`/HH. Проверки: focused server handoff tests,
новый browser handoff fixture, прежние client/interiors/orbital/HH suites и полный
server suite. Не включать токены, пользовательский текст или ID в переходы.

- [x] Этап 3: сервером заданные безопасные переходы к Telegram/Operations;
  сообщения о возможностях, проверка URL и отсутствие секретов в ссылках.
  Проверено 26 октября: server 874/874 без пропусков, PostgreSQL 13/13,
  focused navigation/menu 48/48, семь браузерных наборов и независимая ревизия.
  [Результат этапа](../../updates/2026-10-26-mini-app-handoffs-development.md).
- [x] Этап 4: API постраничных личных списков, refresh, доступные карточки,
  объяснение области поиска и отдельной истории; интеграционные тесты.
  Реализованы SectionReader и migration050, UI refresh/load-more/details,
  старая история без потери черновика. Проверено 874 server, 7 новых PG tests,
  восемь browser suites. Независимая ревизия недоступна из-за лимита помощников.
  [Результат](../../updates/2026-10-26-mini-app-lists-development.md).
- [ ] Этап 5: согласованные пользовательские операции через общие domain services
  и исходные подтверждения; по одному разделу с отдельным контрактом и приёмкой.
  Включить понятный процесс ручной сверки HH unknown по исходному ID; не снимать
  блокировку неопределённого выбора резюме без подтверждённого результата.
  - [x] 27 октября: память add/correct/forget, подтверждение в Mini App,
    атомарные receipt+изменение, owner/rights/session/digest, tombstone отмены
    исходного UUID и recovery после reload/нового входа. Migration051;
    server877/877, PG22/22, восемь production browser suites и независимая
    security-ревизия. [Результат и ограничения](../../updates/2026-10-27-mini-app-memory-development.md).
- [ ] Этап 6: живые Telegram owner/member проверки, два аккаунта, WebView/cookies,
  узкий экран и клавиатура. Публикацию предлагать после готовности локального этапа.
