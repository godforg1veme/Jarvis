# HH: свежий поиск, накопленный сбор и ежедневная сверка / Three-lane HH release

[Русский](#русский) | [English](#english)

## Русский

25 октября 2026 года по поручению владельца все изменения опубликованы вместе
в GitHub `main` и установлены на DE. Windows и исходники обоих VPS синхронизированы.
Server и job-collector используют один образ `jarvis-hh-fresh:20b7a16` из immutable
release `20b7a163088a0f86a7247ac9b47e3e238663f82c`. Последующая запись результата
меняет только документацию и не требует пересборки этого образа.

### Как работает сбор

- Свежий поиск проверяет новые публикации каждые пять минут по прежним запросам
  и фильтрам. Первоначально читает последний час, затем использует часовое перекрытие.
- Обычный сбор продолжает накопленный период с сохранённого места, не ожидая
  завершения свежего поиска. Выбранная глубина истории по умолчанию — 14 дней.
- Ежедневная сверка заново читает всю выбранную глубину и находит пропуски,
  включая старые объявления, поздно появившиеся в выдаче. Первый цикл назначен
  через сутки после миграции, следующие — через сутки после завершения предыдущего.

Каждый проход хранит свой прогресс; общий lease и один браузер исключают
параллельные запросы одного пользователя. Фоновые порции чередуются, свежие
карточки получают приоритет доставки. Пауза и текущий доступ действуют для всех
проходов. Интерфейс, фильтры, кнопки, CAPTCHA и подтверждение отклика прежние.
Sent/sending/unknown не переотправляются. Неполный период хранит явные пробелы,
не продвигает успешный checkpoint и получает следующую полную попытку.

### Установка и проверки

| Узел / проверка | Фактический результат |
| --- | --- |
| GitHub / Windows / DE / NL source | Принятая `main`, чистые checkouts; исходники синхронизированы |
| DE server | `healthy`, новый образ, без рестартов после установки; 358 исходных/package-файлов совпадают |
| DE job-collector | `running`, тот же новый образ, без рестартов; 358 файлов совпадают |
| Миграции | `047_job_fresh_collection.sql` и `048_job_reconciliation.sql` применены при старте сервера |
| DE job-browser | Прежний контейнер `jarvis-hh-browser:f65dac5`, `healthy`; все 50 исходных/package-файлов совпадают |
| Остальные контейнеры DE | PostgreSQL, OCR, ASR и tunnel сохранили ID; тома и профили HH сохранены |
| Окружение / секреты | Окружение server/collector совпадает с прежним, значения не выводились; подключаемый секрет скопирован с проверкой содержимого и прав 0600, исходный inode сохранён |
| Локальные тесты | Server 862/862, PostgreSQL + четыре browser/RPC сценария 39/39, Telegram gate 75/75; без пропусков |
| Новый образ на Linux | 860 прошли, ошибок нет; два сценария требуют PostgreSQL и отдельно прошли в следующем прогоне |
| Изолированный Linux PostgreSQL / Chromium | 43/43 без пропусков, включая оба упомянутых DB-сценария и четыре browser/RPC сценария |
| HTTPS | `/health/live` и `/health/ready`: smoke прошёл |
| NL / Host Agent | Source обновлён; Host Agent и VPN активны и совпадают с принятым кодом на обоих узлах |
| Desktop | Установленная 1.0.2 совпадает: 146 файлов, native Electron и bundled runtime; пересборка и установка не требовались |

Оба исходных накопленных обхода сохранились и продолжаются. До установки было
7345 отправленных карточек; первый контрольный срез после установки подтвердил
ещё две отправленные карточки с приоритетом свежего поиска. Старые 7345 остались
в прежнем состоянии. Оба свежих обхода ещё выполнялись, закрытых кодов ошибок
поиска в этом срезе не было. Первая ежедневная сверка назначена на 26 октября
около 20:22 МСК; её реальный полный цикл ещё не проверен.

Тестовые контейнеры не получали production environment, secrets или volumes.
Для них использовались чистый Git-снимок и внутренняя Docker-сеть с отдельной
PostgreSQL без host ports и постоянного тома. После тестов контейнеры и сеть
удалены. Настоящий отклик работодателю при выпуске не отправлялся; backup timer
и restore не включались. Проверка release-status с обоими VPS и Desktop прошла
без замечаний.

### Нагрузка и пределы проверки

Один контрольный замер при активном сборе: server — около 58 МиБ и 0,12% CPU,
collector — 27 МиБ и 0,03%, существующий browser — 354 МиБ и 95% одного ядра.
Это моментальный срез, который не измеряет прибавку к прежнему потреблению.
Основная нагрузка остаётся у браузера; второго Chromium не запускали.

Пять минут — целевой интервал. Скорость HH, CAPTCHA и число запросов могут
увеличить задержку. Полный свежий обход, первый реальный суточный цикл и влияние
на нагрузку за длительный период ещё не подтверждены. Сверка уменьшает риск
пропусков, но не гарантирует получение удалённых объявлений, дат за выбранной
глубиной или результатов за лимитом 2000 в день по одному запросу. При глубине
30 дней переход полуночи во время запроса может сделать старейший день недоступным;
такое окно явно отмечается как неполное.

Подготовка и подробные сценарии: [локальный этап](2026-10-25-hh-fresh-vacancies-development.md).
Архитектура: [спецификация](../superpowers/specs/2026-10-25-hh-fresh-vacancies-design.md).

## English

On October 25, 2026, at the owner's request, all changes were published together
to GitHub `main` and deployed on DE. Windows and both VPS source checkouts are
synchronized. Server and job-collector share image `jarvis-hh-fresh:20b7a16` from
immutable release `20b7a163088a0f86a7247ac9b47e3e238663f82c`. Subsequent result
documentation does not change runtime inputs or require rebuilding this image.

### Collection behavior

- Fresh search checks new publications every five minutes using existing queries
  and filters, starting with one hour and then retaining a one-hour overlap.
- Historical collection resumes its saved backlog independently of fresh search.
  The selected history depth defaults to 14 days.
- Daily reconciliation rereads the whole selected range to find misses, including
  older listings indexed late. The first cycle is due one day after migration;
  subsequent cycles start one day after the preceding cycle finishes.

Each lane keeps its own progress. A shared user lease and one browser prevent
concurrent requests for a user. Background passes alternate, and fresh cards
receive delivery priority. Pause and current permissions apply to every lane.
UI, filters, buttons, CAPTCHA and application confirmation remain unchanged.
Sent/sending/unknown deliveries are not replayed. Incomplete ranges retain explicit
gaps without advancing the successful checkpoint and receive another full attempt.

### Deployment and verification

| Node / check | Actual result |
| --- | --- |
| GitHub / Windows / DE / NL source | Accepted `main`, clean synchronized checkouts |
| DE server | `healthy`, new image, no restarts after deployment; 358 source/package files match |
| DE job-collector | `running`, same new image, no restarts; 358 files match |
| Migrations | `047_job_fresh_collection.sql` and `048_job_reconciliation.sql` applied at server startup |
| DE job-browser | Existing `jarvis-hh-browser:f65dac5` container, `healthy`; all 50 source/package files match |
| Other DE containers | PostgreSQL, OCR, ASR and tunnel retained their IDs; data volumes and HH profiles preserved |
| Environment / secrets | Server/collector environments match prior values without disclosure; mounted secret content and 0600 permissions verified, original inode preserved |
| Local tests | Server 862/862, PostgreSQL plus four browser/RPC scenarios 39/39, Telegram gate 75/75; no skips |
| New Linux image | 860 passed, no failures; two PostgreSQL-dependent scenarios passed separately in the next run |
| Isolated Linux PostgreSQL / Chromium | 43/43 without skips, including both DB-dependent scenarios and four browser/RPC scenarios |
| HTTPS | `/health/live` and `/health/ready` smoke passed |
| NL / Host Agent | Source synchronized; Host Agent and VPN services active and matching accepted code on both hosts |
| Desktop | Installed 1.0.2 matches: 146 files, native Electron and bundled runtime; no rebuild or installation needed |

Both original historical runs retained progress and continued. Before deployment
there were 7345 sent cards; the first post-deployment snapshot confirmed two
additional sent cards with fresh priority, with the original 7345 unchanged.
Both fresh runs were still in progress and no closed search failure codes were
present in that snapshot. The first daily reconciliation is scheduled for
October 26 at approximately 20:22 Moscow time; its actual full cycle is unverified.

Test containers received no production environment, secrets or volumes. They used
a clean Git snapshot and an internal Docker network with separate PostgreSQL,
without host ports or persistent data volumes. Test containers and the network
were removed afterward. No real employer application was submitted; backup timers
and restore were not enabled. Release-status verification including both VPS
hosts and Desktop passed without issues.

### Resource use and limits

One snapshot during active collection showed about 58 MiB/0.12% CPU for server,
27 MiB/0.03% for collector and 354 MiB/95% of one CPU for the existing browser.
This instantaneous sample does not measure the increase over previous resource
use. Browser work remains the main cost; no second Chromium was launched.

Five minutes is a target. HH latency, CAPTCHA and query volume can extend delays.
The full fresh scan, first actual daily cycle and sustained resource impact remain
unverified. Reconciliation reduces misses but cannot guarantee deleted listings,
dates outside the selected depth or results beyond 2000 per query/day. At 30-day
depth a midnight crossing during a request can expire the oldest day; that window
is explicitly retained as incomplete.

Preparation and scenarios: [development record](2026-10-25-hh-fresh-vacancies-development.md).
Architecture: [specification](../superpowers/specs/2026-10-25-hh-fresh-vacancies-design.md).
