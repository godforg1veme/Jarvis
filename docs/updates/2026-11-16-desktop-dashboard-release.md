# Выпуск Desktop dashboard / Desktop dashboard release

## Русский

Более новый результат: [оригинальный визуал и EXE dashboard.2](2026-11-16-desktop-original-visual-install.md).

16 ноября владелец поручил опубликовать серверную часть и установить Desktop
`1.0.3-dashboard.1`. Основа — [локальный результат 12 ноября](2026-11-12-desktop-dashboard-local-test.md).
Выпуск завершён: сервер на DE обновлён, EXE установлен и проверен с рабочей
привязкой. Исходники Windows и обоих VPS синхронизированы с GitHub main.

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


Итог живой проверки 16 ноября, около 22:47 МСК:

- Server release `307986605be6a8c736de91ff0ea40dc368b7f5ae`, image
  `jarvis-desktop-server:3079866`; 391 файлов и входы сборки совпали с main.
  Перед заменой серверный образ прошёл ещё 23 PostgreSQL acceptance без ошибок
  и пропусков. Окружение (93 ключа Compose) сверено без вывода значений;
  исходный bind секрета сохранён. Collector/browser сохранили container IDs.
- Установлен Desktop `1.0.3-dashboard.1`: 168 файлов, 0 отсутствующих,
  0 изменённых. Electron 42.11.9 и bundled Node 24.14.1 совпадают со сборкой.
  Старая привязка сохранилась, соединение online. Все 13 проверенных чтений
  через настоящий IPC и сервер успешны: профиль, личные разделы, HH-настройки
  и обе отдельные истории диалога. Личные данные в отчёт не выводились.
- В установленном приложении проверены все пункты меню и пять экранов Life OS,
  закрытие Life OS и возврат на главную: без горизонтального переполнения
  и новых ошибок renderer. Life OS открывается поверх текущего раздела.
  Изменения/отмены/дедупликация проверены в изолированных сценариях;
  рабочие записи и HH-согласия для проверки не изменялись.
- Live/ready внутри сервера 200, публичные live и Mini App 200 при curl
  и браузерном User-Agent. Проба Python urllib получила 403 на внешнем входе;
  рабочий Desktop и обычные HTTP-пробы успешны. Сервер healthy;
  в структурированных журналах после замены 0 warning/error/fatal.
  Host Agent, Xray, Hysteria и таймеры проб активны на обоих VPS.
- Микрофон и камера оставались выключены; их физический захват и живые
  HH-отклики не проверялись. Изолированные тестовые контейнеры удалены.
  Отладочный запуск Desktop завершён; приложение запущено обычным способом.

## English

Newer result: [original visual and dashboard.2 EXE](2026-11-16-desktop-original-visual-install.md).

On November 16 the owner authorized publishing the server changes and installing
Desktop `1.0.3-dashboard.1`, based on the [November 12 local result](2026-11-12-desktop-dashboard-local-test.md).
Release completed: the DE server was updated and the EXE installed and checked
with the existing device pairing. Windows and both VPS source checkouts match
GitHub main.

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

Live acceptance on November 16, around 22:47 Moscow time:

- Server release `307986605be6a8c736de91ff0ea40dc368b7f5ae`, image
  `jarvis-desktop-server:3079866`; all 391 files and build inputs match main.
  Before replacement, this image passed another 23 PostgreSQL acceptance cases
  with no failures or skips. All 93 Compose environment keys were compared
  without exposing values; the original secret bind was preserved.
  Collector/browser container IDs stayed unchanged.
- Desktop `1.0.3-dashboard.1` is installed: 168 files checked, none missing
  or changed. Electron 42.11.9 and bundled Node 24.14.1 match the build.
  The existing pairing was preserved and the connection is online. All 13
  read requests through real IPC and the live server succeeded: profile,
  personal sections, HH settings and the two separate conversation histories.
  No personal content was printed in the report.
- Every menu entry and all five Life OS screens were checked in the installed
  app, including closing Life OS and returning Home, with no horizontal
  overflow or new renderer errors. Life OS opens over the current section.
  Mutations, cancellations and deduplication passed isolated scenarios;
  acceptance did not change live records or HH consent.
- Internal live/ready returned 200; public live and Mini App returned 200
  using curl and a browser User-Agent. Python urllib received an external
  403, while the working Desktop and ordinary HTTP probes succeeded.
  The server is healthy; post-replacement structured logs contain zero
  warnings, errors or fatal events. Host Agent, Xray, Hysteria and probe
  timers are active on both VPS hosts.
- Microphone and camera remained off; physical capture and live HH applications
  were not exercised. Isolated test containers were removed. The debugging
  Desktop session was stopped and the app restarted normally.
