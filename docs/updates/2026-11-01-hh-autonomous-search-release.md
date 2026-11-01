# Автопоиск с LLM: выпуск / Autonomous job search release

1 ноября 2026 / November 1, 2026.

## Русский

По поручению владельца выпуск опубликован в GitHub main и установлен на DE.
Исходники Windows и обоих VPS синхронизированы. Основная реализация —
`2b5613f`, исправление выдачи нового JS-модуля Mini App — `83db2a2`.
Server работает из `jarvis-autonomous-server:83db2a2`, collector — из
`jarvis-autonomous-server:2b5613f`, browser — из `jarvis-autonomous-browser:2b5613f`.
На NL обновлены исходники; его работающие компоненты менять не требовалось.

В боте и Mini App установлен личный переключатель «Автопоиск с LLM».
Режим по умолчанию выключен; при выпуске активных разрешений — 0.
После личного включения он сравнивает полное резюме с вакансией, допускает
частичное соответствие и подчёркивает подтверждённый опыт без выдуманных фактов.
Обычные карточки, отказы и успешные отклики остаются без уведомлений.
Тесты, анкеты и требующие вмешательства проблемы передаются в личный Telegram.
Дневного лимита нет. Одно уведомление при $2 за календарный месяц по МСК
не останавливает поиск. Миграции 054/055 применены; порог всех профилей — $2.

Оценка и письма используют `z-ai/glm-5.3-flash` через существующий OpenRouter key.
Провайдер выбирается по цене с верхними границами $0.15/$0.50 за миллион
входных/выходных токенов, strict JSON и без автоматической замены модели.
Живая проверка выявила обязательный для GLM reasoning: используется `low`,
внутренний текст исключён из ответа. Лимиты ответа — 1024 токена для оценки
и 6000 для письма. Стоимость сохраняется из usage провайдера; отсутствие
стоимости означает unknown. Основной чат FreeFirst не изменён.

Проверено:

- Linux server: 904 теста, 902 прошли, 2 PostgreSQL-проверки пропущены;
  обе отдельно прошли на изолированной тестовой БД.
- 24 PostgreSQL-сценария автоматики и смежных путей прошли; Linux browser —
  109/109. Mini App build и fixtures на 320/390/1280 прошли.
- Независимые code/security-проверки выполнены. Исправлены безопасное
  возобновление чтения резюме до обращения к модели и текст неизвестного результата.
- Реальные синтетические запросы GLM вернули валидные ответы: оценка
  $0.00001997, письмо $0.00024442. Установленный адаптер отдельно вернул
  apply со стоимостью $0.00004159. Это отдельные пробы, не цена каждого отклика.
- Проверка установленной Mini App выявила отсутствующий JS в static allowlist;
  исправление установлено с regression-тестом. Публичная страница загружается
  без ошибок JavaScript и отсутствующих ресурсов; smoke, live/ready и assets — OK.
- Итоговый release-status: issues пуст, сервер healthy, runtime соответствует
  принятому коду. Переменные окружения, постоянные тома и inode secret mount
  сохранены; изменён только предусмотренный порог расходов. Desktop соответствует
  принятому коду и не требовал пересборки. VPN и Host Agent не обновлялись.

Живая HH-проба перед выпуском вернула `JOB_HH_ACCESS_DENIED`.
Полное чтение настоящего резюме, первый реальный автоотклик и нажатия нового
переключателя внутри Telegram ещё не подтверждены. Неполный SSR-снимок блокирует
автоматику. Режим пользователям не включали, откликов работодателям не отправляли.
Для приёмки нужен доступный личный HH-сеанс и личное включение режима.

[Контракт поведения](../telegram-menu-contract.md) ·
[История разработки](2026-11-01-hh-autonomous-search-development.md).

## English

The owner authorized publication and deployment. GitHub main, Windows and both
VPS source checkouts are synchronized. Feature commit: `2b5613f`; Mini App static
module fix: `83db2a2`. DE runs server image `jarvis-autonomous-server:83db2a2`,
collector `jarvis-autonomous-server:2b5613f` and browser
`jarvis-autonomous-browser:2b5613f`. NL needed source synchronization only.

Telegram and Mini App now provide a personal Autonomous job search switch.
It defaults to off; there were zero enabled consents at rollout. Once enabled
personally, automation compares the complete resume with each vacancy, accepts
partial matches and presents verified experience strongly without inventing facts.
Routine cards, rejections and successful applications remain quiet. Tests, forms
and actionable failures go to the user's private Telegram chat. There is no daily
quota. One notice at $2 per Moscow calendar month does not stop searching.
Migrations 054/055 are applied; all profiles have the $2 notice threshold.

Evaluation and letters use fixed `z-ai/glm-5.3-flash` with the existing OpenRouter
key, price-sorted providers, $0.15/$0.50 per million input/output token ceilings,
strict JSON and no automatic model substitution. Live probes established that
GLM requires reasoning: `low` is used and internal text is excluded from output.
Response limits are 1024 tokens for evaluation and 6000 for letters. Costs come
from provider usage; missing cost stays unknown. Main chat FreeFirst is unchanged.

Verification:

- Linux server: 904 tests, 902 passed, two PostgreSQL tests skipped; both passed
  separately against an isolated test database. Twenty-four PostgreSQL scenarios
  passed. Linux browser: 109/109. Mini App build and 320/390/1280 fixtures passed.
- Independent code/security reviews completed. Safe resume-read recovery before
  model invocation and accurate unknown-result messaging were corrected.
- Live synthetic GLM evaluation and letter calls returned valid output, costing
  $0.00001997 and $0.00024442. The installed adapter separately returned apply
  at $0.00004159. These are individual probes, not a fixed application price.
- Installed-page verification caught a missing static JS allowlist entry; the
  deployed fix includes a regression test. Public Mini App has no JavaScript
  errors or failed assets. Smoke, live/ready and asset checks passed.
- Final release-status reports no issues, a healthy server and matching runtime
  inputs. Environment, persistent volumes and secret mount inode were preserved,
  apart from the intended spending threshold change. Desktop matches accepted
  code and required no rebuild. VPN and Host Agent were not updated.

The live HH probe before rollout returned `JOB_HH_ACCESS_DENIED`. Complete real
resume reading, the first real autonomous application and the new switch inside
Telegram remain unverified. Partial SSR snapshots block automation. No user's
automation was enabled and no employer application was sent. Acceptance requires
an accessible personal HH session and personal activation.

[Behavior contract](../telegram-menu-contract.md) ·
[Development history](2026-11-01-hh-autonomous-search-development.md).
