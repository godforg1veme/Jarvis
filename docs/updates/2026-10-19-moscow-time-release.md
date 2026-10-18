# Московское время: выпуск / Moscow time release

[Русский](#русский) | [English](#english)

## Русский

19 октября 2026 исправлены отображение времени и ввод напоминаний. Поручены
публикация в GitHub, обновление обоих VPS и, отдельным ответом, установка Desktop.
Server release `e166132bc35632b0a08d09528da1db18dc704a6d` установлен на DE из
`/home/deploy/releases/jarvis-e166132-moscow-time`, image
`sha256:2d61c01f67dccacfd6de33803fc4d425a35bb3d047eeb02d47393066305e60d3`.
Последующие изменения этого выпуска касаются проверки и документации.

В примере со скриншота дата без пояса разбиралась как UTC на сервере, а карточка
показывала её в Москве. Поэтому 23:46 превращалось в 02:46 следующего дня.
Теперь ввод без пояса означает МСК UTC+3. Например, `2030-10-18 23:46`
сохраняется как `2030-10-18T20:46:00.000Z`, а показывается как 23:46 МСК.
Явные ISO Z/offset сохраняют исходный момент. Неверная дата оставляет пошаговый
ввод активным для повторной попытки.

Общий `shared/time.js` задаёт фиксированный `Etc/GMT-3`, включая исторические
даты. Его используют серверные карточки Telegram, jobs, Operations, список
файлов и доверенные часы модели. Desktop Life OS/Vision и Operations UI
форматируют даты с явной зоной; Mini App показывает срок своей договорённости.
UTC в PostgreSQL, wire timestamps, expiry и дедупликация сохраняются.

Проверено:

- Полный server suite: 760/760 локально и в Linux image с `TZ=UTC`, без пропусков.
  Старая проверка CommitmentDetector зависела от локального `getHours()`;
  заменена сравнением ISO. Финальный Linux suite использовал эту проверку
  через отдельный read-only mount, без изменения immutable release.
- Настоящий PostgreSQL: 1/1 acceptance, все 40 migrations в отдельной БД.
  Настоящие message/menu handlers проверили создание и перенос через полночь,
  неверную дату, чужие user/chat, повторное потребление и expiry.
  Тестовая БД удалена; рабочие напоминания не затрагивались.
- Форматтеры и browser Life OS проверены в UTC, Los Angeles и Tokyo.
  Operations UI: 3/3 tests и build; cloud tests: 73/73; Life OS renderer,
  Mini App build и browser fixtures прошли.
- Desktop 1.0.2 пересобран и установлен через NSIS `/S`, exit 0.
  Сверены 144 установленных файла, Electron native и bundled wake runtime:
  совпадают с исходниками и входами сборки.
- На DE заменён только server container; остальные container IDs сохранены.
  Все прежние значения Compose env сохранены, free-first включён.
  Server healthy, restart count 0. Публичные запросы из Windows:
  live/ready и Mini App 200, анонимный `/mini/api/me` 401.
  Прямые публичные пробы с DE получили 403 от внешнего маршрута;
  локальный health и публичная проверка из Windows прошли.

[Очередь моделей](2026-10-19-free-first-routing-release.md) продолжает работать:
сначала семь согласованных free, затем самый дешёвый из двух DeepSeek по оценке
стоимости. Цены/доступность обновляются при использовании после 15 минут;
новые ID автоматически не добавляются. Ранее живой запрос и отдельная квитанция
подтвердили $0. В этом выпуске новых платных проб не делали.

Ранее созданные напоминания массово не сдвигаются: из сохранённого UTC нельзя
надёжно восстановить намерение пользователя. Ошибочное старое напоминание нужно
явно перенести на нужное московское время. Уже отправленные сообщения Telegram
не переписываются. Реальный ввод на телефоне, доставка по расписанию и визуальная
проверка открытого установленного Desktop остаются клиентской приёмкой.

## English

On October 19, 2026, time displays and reminder input were fixed. The owner
authorized GitHub publication, both VPS updates and, in a separate reply,
Desktop installation. DE runs server release
`e166132bc35632b0a08d09528da1db18dc704a6d` from
`/home/deploy/releases/jarvis-e166132-moscow-time`, image
`sha256:2d61c01f67dccacfd6de33803fc4d425a35bb3d047eeb02d47393066305e60d3`.
Subsequent changes in this release concern verification and documentation.

The screenshot exposed timezone-less input parsed as UTC on the server, then
displayed in Moscow. This turned 23:46 into 02:46 the following day. Input
without a zone now means Moscow UTC+3: `2030-10-18 23:46` is stored as
`2030-10-18T20:46:00.000Z` and displayed as 23:46 MSK. Explicit ISO Z/offset
values preserve their instant. Invalid dates keep guided input active for retry.

Shared `shared/time.js` defines fixed `Etc/GMT-3`, including historical dates.
Server Telegram cards, jobs, Operations, file listings and the trusted model
clock use it. Desktop Life OS/Vision and Operations UI specify the display
zone explicitly; the Mini App shows the user's commitment due date. PostgreSQL
UTC, wire timestamps, expiry and deduplication remain canonical.

Verified:

- Full server suite: 760/760 locally and in the Linux image with `TZ=UTC`,
  no skips. An older CommitmentDetector assertion used local `getHours()`;
  it now compares ISO instants. The final Linux suite mounted that assertion
  read-only without modifying the immutable release.
- Real PostgreSQL: 1/1 acceptance, all 40 migrations in an isolated database.
  Real message/menu handlers exercised creation, rescheduling across midnight,
  invalid retry, foreign user/chat, single consumption and expiry. The test
  database was removed; production reminders were untouched.
- Formatters and Life OS browser fixtures ran in UTC, Los Angeles and Tokyo.
  Operations UI: 3/3 tests and build; cloud tests: 73/73; Life OS renderer,
  Mini App build and browser fixtures passed.
- Desktop 1.0.2 was rebuilt and installed using NSIS `/S`, exit 0. All 144
  installed files, native Electron and bundled wake runtime match the source
  and build inputs.
- Only the DE server container changed. Other container IDs and all prior
  Compose environment values were preserved; free-first remains enabled.
  Server is healthy with restart count 0. Public Windows probes returned
  200 for live/ready and Mini App, and 401 for anonymous `/mini/api/me`.
  Direct public probes from DE received external-route 403 responses;
  local health and public Windows probes passed.

[Model routing](2026-10-19-free-first-routing-release.md) remains active:
seven approved free candidates, then the cheapest of two DeepSeek candidates
by estimated cost. Prices/availability refresh on use after 15 minutes;
new IDs are never automatically added. The earlier live request and separate
receipt confirmed $0. This release performed no new paid probes.

Existing reminders were not bulk shifted: stored UTC cannot reliably reveal
the user's original intent. An incorrect old reminder needs explicit
rescheduling to the desired Moscow time. Previously sent Telegram messages
are not rewritten. Actual phone input, scheduled delivery and visual review
of the installed Desktop remain client acceptance checks.
