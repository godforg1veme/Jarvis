# Free-first OpenRouter routing implementation plan

**Goal:** Основной текстовый ассистент выбирает семь согласованных бесплатных
моделей по порядку, затем самый дешёвый подходящий из двух DeepSeek.

**Architecture:** Отдельный CommonJS provider с каталогом `/models/user` и квотой
`/key`. Проверка обновляется при первом запросе и затем по TTL 15 минут при
использовании; отдельный фоновый scheduler не нужен. Новые модели автоматически
не добавляются. Нулевая цена обеспечивается также `provider.max_price`, а не
только кэшем. Общий источник правил — AGENTS.md; порядок согласован в чате.

**Tech stack:** существующие Node fetch, CommonJS, node:test, Zod; без зависимостей.

## Ограничения

- Opt-in `JARVIS_OPENROUTER_FREE_FIRST`; production остаётся прежним до выпуска.
- Семь free IDs фиксированы. Платные кандидаты — configured primary/fallback
  OpenRouter IDs, запросы режима используют основной OpenRouter key.
- Неизвестные цены и первая недоступность каталога закрывают маршрут. Не использовать
  устаревшую цену без ограничения стоимости на стороне OpenRouter.
- Повтор после 429/404/502/503/504 только для обычного текста; toolsAvailable
  запрещает повтор после любой отправки. Timeout/network/invalid response не повторять.
- HH и Vision с явной моделью не менять. Не публиковать без отдельного поручения.

## Task 1: Catalog and selection

Files: `server/src/providers/openRouterCatalog.js`,
`server/test/openRouterRouting.test.js`.

- [x] Написать fixtures `new Response(JSON.stringify({data: models}))` и `/key`
  с `free_model_daily_requests.remaining`; никаких реальных ключей.
- [x] Реализовать bounded fetch (8 MiB, 10 секунд, redirect:error), single-flight
  TTL 15 минут, безопасный отрицательный backoff после сбоя; хранить только
  разрешённые model metadata и квоту, без ответа key/account в состоянии.
- [x] Проверить исчезновение, изменение нулевой цены, новые посторонние IDs,
  malformed/oversized JSON, свежесть, concurrent refresh и неизвестную цену.

## Task 2: Provider queue and cost guards

Files: `server/src/providers/freeFirstProvider.js`,
`server/src/providers/openAiCompatibleProvider.js`, routing tests.

- [x] Очередь: Super, Ultra, Gemma 31B, Gemma 26B, Super VL, Dots3, Laguna S.
- [x] Сначала пригодность context/tools, затем порядок free или стоимость paid
  по размеру входа и лимиту выхода. При quota=0 не пробовать семь free по очереди.
- [x] Добавить provider routing payload и закрытые status/retryAfterMs к HTTP
  ошибке существующего adapter без raw response body/credential logging.
- [x] Передавать max_price=0 для free, проверенные ценовые потолки для paid;
  cooldown 429, повторный read квоты, ограничение полной цепочки по времени.
- [x] Проверить полный порядок, paid ranking, quota exhaustion, cooldown,
  ошибку входа, сетевой unknown, tool no-retry и отсутствие утечки key errors.

## Task 3: Integration and documentation

Files: `providerFactory.js`, `config/loadConfig.js`, `providerProfile.js`,
`deploy/env.example`, `docs/README.md`, `docs/verification.md`, новый bilingual
`docs/updates/2026-10-18-free-first-routing-development.md`.

- [x] Подключить opt-in; проверить, что ручной режим и его тесты сохраняются,
  модель профиля отражает автоматическую очередь без фиктивного выбранного ID.
- [x] `node --test server/test/openRouterRouting.test.js server/test/providers.test.js server/test/config.test.js`.
- [x] `npm test --prefix server`, `git diff --check`, проверка MD links.
- [x] Записать реальный результат и границы; предложить согласованный выпуск
  с opt-in на DE и обновлением исходников обоих VPS.

Implementation completed locally on October 19: 14 routing tests, 33 focused tests,
756 total server tests passed. Publication remains pending owner authorization.

Later outcome: [released and enabled on DE](../../updates/2026-10-19-free-first-routing-release.md);
Linux 756/756 and one live router request with a $0 generation receipt passed.
