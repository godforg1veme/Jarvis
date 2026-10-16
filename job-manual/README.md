# HH manual gateway

Небольшой отдельный gateway для подтверждённого owner-only сценария
[ручной капчи с телефона](../docs/superpowers/specs/2026-10-16-hh-mobile-manual-design.md).
Один адрес `/hh/`, без таймера ручной проверки. GET открывает UI, но не начинает
ручное управление. «Готово» закрывает ввод до проверки browser broker.
«Обновить проверку» — отдельный явный start с текущей revision, если нужна
новая картинка. Автоматических refresh и повторения answer POST нет.

Настройки: `JARVIS_JOB_MANUAL_ORIGIN` (точный HTTPS origin `*.ts.net`),
`JARVIS_JOB_MANUAL_OWNER_LOGIN`, `JARVIS_JOB_MANUAL_OWNER_ID` и отдельный
`JARVIS_JOB_MANUAL_TOKEN`. Значения задаются приватно. Broker закреплён как
`http://job-browser:8082`; runtime не принимает upstream из запроса или env.
Credential и owner ID не уходят клиенту. Gateway не использует БД или HH profile.

Слушает контейнерный порт 8080. Обязательные deployment-границы: публикация
только на loopback хоста, отдельная сеть с browser, доверенный Tailscale Serve
с identity headers, выключенный Funnel. Не выставлять контейнерный HTTP
в tailnet напрямую: заголовки являются доверенными только после Serve.

Session cookie Secure/HttpOnly/Strict/Path=/hh; CSRF для control POST, точные
Host/Origin/owner для управления и WS. Не более 8 auth sessions, без TTL:
новая сессия вытесняет самую старую cookie-сессию и её transport, если он открыт.
Это не подтверждает капчу и не меняет durable manual state или паузу сборщика;
владелец подключается заново. Выдача сессий ограничена 32 в минуту. Один WS transport на весь
gateway, сообщения ≤64KiB, буфер ≤256KiB. Никаких tokens в URL. Assets noVNC
локальные; remote clipboard и file transfer не включены. Текстовое поле под
экраном передаёт символы Unicode как RFB key events, поддерживая кириллицу
и мобильный IME без clipboard.
Ping/pong каждые 10 секунд освобождает зависший transport при потере сети.
Это закрывает только сетевое соединение: ручная проверка остаётся active,
сбор приостановлен, владелец возвращается по прежней ссылке без нового TTL.
Control start/finish ждут broker до 60 секунд; status — до 5 секунд. Таймаут
возвращает закрытую ошибку и не повторяет POST. Это сетевые ограничения,
а не таймер длительности ручной проверки.

`npm ci --prefix job-manual`, затем `npm test --prefix job-manual`.
`testAllowLoopback` существует только как явная опция тестового конструктора,
не из env; нужен изолированным HTTP/WS fixtures. Зависимости закреплены lock:
noVNC 1.7.0 и ws 8.22.0. Ошибки содержат закрытые коды; headers, URL запросов,
экран, ввод, broker ответы и exception text не журналируются.
