# Картинка капчи при входе HH / HH sign-in CAPTCHA picture

[Русский](#русский) | [English](#english)

## Русский

Исправление дополняет [предыдущий выпуск входа HH](2026-10-21-hh-login-touch-release.md).
Он разрешил получение кода и вход, но пропустил автоматический POST `/captcha`.
Поэтому окно дополнительной проверки открывалось без картинки и показывало
ошибки подключения. Это ограничение браузера Jarvis, а не подтверждённый сбой VPN.

В активной личной сессии входа разрешено создание картинки: только основной
frame HH, точный путь, единственный язык RU/EN и пустое тело формы. Запрос не
требует нажатия: HH запускает его при открытии модального окна. Ответ остаётся
ограниченным JSON; редиректы и повтор запроса запрещены. Обновление картинки
и смена языка используют тот же путь. Ответ пользователя HH добавляет к
исходному запросу входа, который по-прежнему требует свежего действия пользователя.
Отдельный `/account/captcha` не добавлен в общий список разрешённых действий.
Истёкшая сессия не разрешает новые запросы записи.

В отдельном Chromium на DE, без телефона, SMS и личного профиля, проверены оба
языка: создание ключа — 200 JSON, картинки — 200 PNG (56 858 и 52 427 байт).
До передачи XSRF заголовка ручная проба получила отказ; с заголовком текущей
публичной сессии запросы прошли. Значения cookie, ключей и ответа капчи не
попадают в отчёт. Проверка не подтверждает настоящий вход участника по SMS.

Добавлены проверки настоящего обработчика `startLogin`: автоматическая загрузка,
обновление, жест при повторе входа, неверные параметры, чужой frame/origin,
истёкшая сессия и редирект. Edge fixture проверяет отказ до внешнего запроса.
В Windows полный набор browser: 76 passed, 9 Linux-only skipped, без ошибок.
Независимая ревизия безопасности блокирующих замечаний не нашла.

Изменения опубликованы в GitHub `main` и установлены на DE по поручению владельца.
Код и immutable release: `19609044f0dab9986c646f51357180b71482ac58`,
`/home/deploy/releases/jarvis-1960904-hh-login-captcha`.
Образ browser: `sha256:62ad6875b3ae2e4b78a076a35a25eb59989fc3bd888cf6f249f2e924d4692666`.
Сам образ с тестовыми fixtures и без сети прошёл 85/85 Linux-тестов.
После установки рабочий `HhBrowser.startLogin` в отдельном профиле снова получил
RU/EN картинки: 200 PNG, 61 131 и 63 873 байта. Сверены все 42 runtime-файла
browser, расхождений нет; контейнер healthy, перезапусков 0.

Сборщик штатно остановлен на время замены browser и запущен в прежнем контейнере.
Остальные container IDs, окружение и mounts сохранены. Server не пересобирался:
его 330 файлов совпадают с `main`, health healthy. HTTPS через curl: live/ready,
окно входа и JS — 200, анонимный `/mini/api/me` — ожидаемый 401. Проба urllib
без браузерного User-Agent получала 403 на внешнем маршруте; curl прошёл.

Исходники DE/NL чистые и синхронизированы с GitHub; source guards прошли.
По 17 модулей Host Agent на узел совпадают, VPN-службы активны и не менялись.
Desktop 1.0.2: 146 файлов, native Electron и bundled Node совпадают; EXE не менялся.
Windows-исходники обновлены с сохранением незавершённой Operations UI и исходного
diff её документов. Общая проверка предупреждает только об этой активной работе.
Закройте старое временное окно и получите новую ссылку через «Подключить HH».
Реальное решение капчи и завершение входа участником остаются пользовательской проверкой.
Проверки сохранены приватно в `/home/deploy/maintenance/hh-login-captcha-20261021`.

## English

This repair follows the [previous HH sign-in release](2026-10-21-hh-login-touch-release.md).
That release allowed code requests and sign-in, but missed the automatic
`/captcha` POST. The challenge modal therefore appeared without a picture and
showed connection errors. This is a Jarvis browser restriction, rather than
evidence of a VPN outage.

An active personal sign-in session now permits picture creation only from the
main HH frame, using the exact path, a single RU/EN language and an empty form
body. No click is required because HH starts it when opening the modal. The
response remains bounded JSON; redirects and request retries are disabled.
Refresh and language changes use the same path. HH adds the human answer to
the original sign-in request, which still requires a fresh user action.
The separate `/account/captcha` endpoint is not added to the general write
allowlist. Expired sessions cannot authorize new writes.

In isolated Chromium on DE, without a phone number, SMS or personal profile,
both languages passed: key creation returned 200 JSON and pictures returned
200 PNG (56,858 and 52,427 bytes). The initial hand-written probe was rejected
without an XSRF header; both requests passed with the current public session's
header. Cookie values, picture keys and CAPTCHA answers are excluded from
reports. This does not verify a member's real SMS sign-in.

New tests exercise the actual `startLogin` handler: automatic initialization,
refresh, the sign-in retry gesture, malformed parameters, foreign frames and
origins, expired sessions and redirects. An Edge fixture checks rejection
before any external request. The full Windows browser suite passed 76 tests,
with 9 Linux-only skips and no failures. Independent security review found no
blockers.

With owner authorization, changes were published to GitHub `main` and installed
on DE. Code and immutable release: `19609044f0dab9986c646f51357180b71482ac58`,
`/home/deploy/releases/jarvis-1960904-hh-login-captcha`.
Browser image: `sha256:62ad6875b3ae2e4b78a076a35a25eb59989fc3bd888cf6f249f2e924d4692666`.
The image passed 85/85 Linux tests with mounted fixtures and no network.
After installation, the production `HhBrowser.startLogin` handler in an isolated
profile again loaded RU/EN pictures: 200 PNG, 61,131 and 63,873 bytes. All 42
browser runtime files match; the container is healthy with zero restarts.

The collector was stopped gracefully while replacing browser, then started in
its original container. All other container IDs, environment and mounts were
preserved. Server was not rebuilt: its 330 files match `main` and health is
healthy. Public HTTPS via curl returned 200 for live/ready, sign-in and JS;
anonymous `/mini/api/me` returned the expected 401. An urllib probe without a
browser User-Agent received 403 on the public route; curl passed.

DE/NL sources are clean and synchronized with GitHub; source guards passed.
All 17 Host Agent modules on each node match; VPN services remain active and
unchanged. Desktop 1.0.2 matches all 146 files, native Electron and bundled Node;
the EXE was not changed. Windows sources were updated while preserving unfinished
Operations UI work and its original documentation diff. The general inventory
warns only about that active work. Close the old temporary window and request a
fresh link using “Connect HH”. A member solving the real challenge and completing
sign-in remains a user acceptance check. Private verification records are stored
at `/home/deploy/maintenance/hh-login-captcha-20261021`.
