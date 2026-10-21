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
Результаты установки и Linux-тестов добавляются после выпуска.

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
blockers. Installation and Linux-suite results will be recorded after deployment.
