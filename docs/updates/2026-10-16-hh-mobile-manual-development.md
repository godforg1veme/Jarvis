# Ручная капча HH с телефона: реализация до выпуска

Более новый результат: [функция установлена на DE](2026-10-16-hh-mobile-manual-release.md).
Ниже сохранено состояние проверок до публикации.

16 октября 2026. Подтверждён [проект](../superpowers/specs/2026-10-16-hh-mobile-manual-design.md).
Изменения подготовлены локально в `codex/hh-mobile-manual`. Production не
обновлялся, новый маршрут Tailscale Serve не создан, ссылка ещё не выдана.

## Что реализовано

Постоянная ссылка `/hh/` открывает owner-only страницу через Tailscale Serve.
В Telegram подготовлены URL-кнопки «Открыть HH» в меню поиска и уведомлении
о капче. Они появляются только при доверенной настройке адреса, без новых
callback/guided-input kinds. GET ссылки не включает ручное управление.

После явного начала владелец видит ту же HH-сессию через noVNC: touch,
масштабирование, русский ввод и Enter. Для новой картинки есть отдельная
кнопка «Обновить проверку». Нет таймера ручного режима; потеря сети или
закрытие Safari не подтверждают капчу и не возобновляют сбор.

«Готово» закрывает ввод, дожидается уже выполняющегося answer POST и делает
только GET исходного target. Успех требует точного адреса и штатного reader.
Ошибка сохраняет active, успешное чтение разрешает resolved и продолжение
с сохранённого места. Выключенный пользователем поиск не включается.

Coordinator хранит owner-bound состояние атомарно. Перезапуск сохраняет паузу;
даже выключенный feature flag не запускает автоматику поверх pending/active.
Automatic read/apply отвергаются до обращения к HH/журналу отклика. Collector
проверяет состояние через 10 секунд, не отправляя новых HH-запросов во время
ручной проверки и не создавая повторного уведомления.

## Границы доступа

Gateway отделён от HH profile, БД и read/apply credentials. Он доступен только
через loopback host binding и отдельную сеть с browser. Проверяются точные
Serve identity/Host/Origin, cookie и CSRF; отдельный manual token используется
только между gateway и broker. В URL и ответах клиенту этого token нет.
Raw VNC слушает только container loopback; X TCP, IPv6 VNC и CDP не публикуются.
Clipboard, file transfer, downloads и другие POST HH запрещены.

Один Chromium/profile обслуживает автоматический и ручной режимы последовательно.
Версии: Playwright 1.64.0, noVNC 1.7.0, ws 8.22.0, Xvfb
`2:21.1.12-1ubuntu1.8`, x11vnc `0.9.16-10`; base images закреплены digest.
Production defaults оставляют функцию выключенной. Gateway read-only/non-root;
browser сохраняет прежний non-root sandbox и seccomp.

Отпечаток автоматической попытки сохраняется до POST и переносится в manual
ledger. Тот же ключ картинки повторно не отправляется даже с другой form state.
Для старого unresolved журнала без отпечатка первая наблюдаемая картинка
консервативно запрещается: нужна явная «Обновить проверку» с новым ключом.
Неизвестный результат не превращается в автоматическую повторную отправку.

Cookie-сессии ограничены восемью; новая вытесняет старую cookie и её transport,
но не меняет manual state. WS heartbeat освобождает потерянное соединение,
сохраняя паузу; это не таймер длительности проверки. HTTP controls имеют
ограниченный сетевой deadline и не повторяются после timeout.

## Проверки

| Проверка | Результат |
| --- | --- |
| Полный server suite после интеграции | 633/633 passed |
| Telegram contract gate | 65/65 passed |
| Linux browser unit, включая state/broker/ledger/security | 38/38 passed, без skip |
| Gateway HTTP/WS/owner/CSRF/mobile UI | 13/13 passed, без skip |
| Изолированный PostgreSQL: scope/dedup/progress/message/menu | 4/4 passed |
| Настоящий noVNC/Xvfb/headed Chromium: touch, «Привет» через RFB, failed/successful finish | 1/1 passed |
| Native Chromium captcha: одна отправка, ожидание dispatch, legacy unknown, точный target | 1/1 passed |
| Headed browserMain: pending после рестарта, отказ read/apply, запрет выключения поверх pending | 1/1 passed |
| Прежний browserMain runtime: sandbox/owner/read/apply credentials | 1/1 passed |
| Прежние Chromium CAPTCHA: body/native XHR | 2/2 passed |
| Прежние HTTPS CAPTCHA: cookie, body/native XHR, POST redirects | 2/2 passed |
| Прежние application driver и browser reader | По 1/1 passed |
| Linux display: RFB loopback, no X TCP/IPv6, child-failure cleanup | 1/1 passed |
| Compose policy и настоящий normalized Compose с flag0/flag1 | 3/3 и оба варианта passed |
| Production dependency audit browser/gateway | 0 известных уязвимостей |

Linux-проверки используют изолированные временные контейнеры без сети,
production profile/env, настоящего HH или Telegram. Fixtures и сертификаты
временные. Тестовые контейнеры удалены; кандидатные образы сохранены.
Отдельные сценарии выполнялись раздельно, это не один общий запуск всех команд.

## Что осталось после разрешения выпуска

Опубликовать согласованные изменения в GitHub main, синхронизировать оба VPS,
установить server/collector/browser/gateway на DE, сохранив прежний profile,
secret inodes и mounts. Точечно добавить `/hh/` к существующему Serve без reset
и Funnel. На реальной версии Serve проверить сохранение prefix `/hh/`:
gateway ожидает его, команда установки выбирается по фактическому proxy path.
Привязку Tailscale identity к действующему Jarvis owner проверить перед настройкой.

Нужна настоящая приёмка в Safari через Tailscale: отображение, ввод, капча,
«Готово», пауза/продолжение и отказ другому tailnet identity. Это ещё не
проверялось на телефоне. Windows EXE и VPN runtime обновления не требуют.
