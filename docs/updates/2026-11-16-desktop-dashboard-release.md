# Выпуск Desktop dashboard / Desktop dashboard release

## Русский

16 ноября владелец поручил опубликовать серверную часть и установить Desktop
`1.0.3-dashboard.1`. Основа — [локальный результат 12 ноября](2026-11-12-desktop-dashboard-local-test.md).
Выпуск выполняется; итог установки и живой проверки будет записан здесь.

Перед публикацией повторно сверены GitHub, Windows и оба VPS: исходники
совпадали с `496f78c`, чужих незакоммиченных изменений и открытых PR не было.
Рабочая ветка содержала только принятый Desktop и его проверки.

Проверки на отдельном PostgreSQL 16/pgvector прошли: 23 сценария Desktop,
Mini App, памяти и личных действий; ещё 7 сценариев пагинации на чистой базе.
Всего 30 passed, 0 failed, 0 skipped. Шесть новых сценариев используют настоящие
Fastify, AccessService, DeviceRepository, MemoryService и SQL: проверены bytea
токена устройства, общие записи двух клиентов, дедупликация, конфликт,
исправление/удаление памяти, изоляция пользователей/курсоров, отзыв устройства
и права. Рабочая база не использовалась. Исправлены только ожидание числа
версий в новом тесте и условия запуска изолированных старых fixtures.

Основной локальный набор повторно прошёл: runner 5/5, Desktop 116/116,
server subset 806/806. Ранее прошли полный server unit 960 tests,
19 UX-сценариев, Life OS и настоящий Electron с тестовым сетевым адаптером.
Проверенные файлы EXE совпадают с принятым кодом; SHA-256 установщика:
`eff1e9e6aa768cb3ea278df695d8a7050c03522ee3c3ee8117d21fb95d165988`.

Выпуск сохраняет личные данные, ключи, настройки и текущие HH-согласия.
Новые миграции и production-зависимости не добавлены. На DE требуется
обновить только server; collector/browser, Host Agent и VPN не меняются.
Оба VPS получают принятую `main`; неизменившиеся службы не перезапускаются.
Камера, микрофон и автоотклики для проверки не включаются.

## English

On November 16 the owner authorized publishing the server changes and installing
Desktop `1.0.3-dashboard.1`, based on the [November 12 local result](2026-11-12-desktop-dashboard-local-test.md).
Release is in progress; installation and live acceptance results will be recorded here.

Before publication, GitHub, Windows and both VPS source checkouts matched
`496f78c`. There were no foreign uncommitted changes or open PRs. The working
branch contained only the accepted Desktop work and its checks.

An isolated PostgreSQL 16/pgvector run passed 23 Desktop, Mini App, memory and
personal-action cases, plus 7 paging cases on a fresh database: 30 passed,
0 failed, 0 skipped. Six new cases use real Fastify, AccessService,
DeviceRepository, MemoryService and SQL to check the bytea device credential,
shared rows across both clients, deduplication, conflicts, correction/deletion,
user/cursor isolation and device/permission revocation. Production data was
not used. Only the new test's version-count expectation and the existing
fixtures' isolated execution environment needed correction.

The local core suite passed again: runner 5/5, Desktop 116/116 and server subset
806/806. Previous checks covered the full server unit suite (960 passed),
19 UX scenarios, Life OS and real Electron using a fixture network adapter.
The EXE payload matches the accepted code. Installer SHA-256:
`eff1e9e6aa768cb3ea278df695d8a7050c03522ee3c3ee8117d21fb95d165988`.

The release preserves personal data, credentials, settings and existing HH
consent. It adds no migrations or production dependencies. Only the DE server
needs replacing; collector/browser, Host Agent and VPN remain unchanged.
Both VPS source checkouts receive accepted `main`; unchanged services are not
restarted. Tests do not enable microphone, camera or live job applications.
