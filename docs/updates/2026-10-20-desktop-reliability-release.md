# Выпуск надёжности Desktop / Desktop reliability release

## Русский

20 октября 2026 владелец поручил публикацию, обновление обоих VPS, сборку и
установку Desktop. Код A03/A06/A07 опубликован коммитом
`051bb671ea15bb3f981ff9c0fda060773ceb621c`. Последующие изменения этого выпуска
касаются документации. [Локальный результат](2026-10-20-desktop-reliability-development.md)
сохранён как история реализации.

На DE работает server release `/home/deploy/releases/jarvis-051bb67-desktop-reliability`,
image `sha256:7ab527e0e85c22ad5c5744d2578a556f2e0f12fc5376bad9e6ce20cba0b49c32`.
Сверены 328 файлов server/shared и все Compose-входы release. Перед заменой
сравнили 87 параметров окружения без вывода значений; расхождений нет. Старый
release с bind mounts сохранён. Заменён только server-контейнер; ID остальных
контейнеров не изменились. Server healthy, restart count 0.

NL получил исходники из GitHub. Host Agent и VPN-код не менялись и не
переустанавливались. На DE/NL совпали все 17 модулей Host Agent, службы
Host Agent/Xray/Hysteria2 и существующие probe timers активны. Новые таймеры,
backup/restore, ротация ключей и ремонт VPN не запускались.

Desktop 1.0.2 пересобран и установлен NSIS `/S`, exit 0 после подтверждения UAC.
Установщик: SHA-256
`da6532cacf4e73a6caccd0e50d3f8531189a9ec3c530d79cba984238264d59a7`.
Все 146 проверяемых файлов resources/app, native Electron 42.11.9 и bundled
Node/Vosk совпадают с принятым кодом и входами сборки. Новых production-зависимостей
нет; `npmRebuild: false` сохранён.

| Проверка | Фактический результат |
| --- | --- |
| Локальный test:core | Runner 5/5, cloud/Desktop 102/102, server unit 778/778; без пропусков |
| Новый Linux server image, TZ=UTC | 778/778; без пропусков |
| Реальный PostgreSQL в отдельной БД | 41 миграция; completed/processing/failed, изоляция user/device, отзыв прав и отсутствие повторной мутации прошли |
| Браузер | 1440×900 и 760×560; все assertions прошли, процесс завершился exit 0 после задержки закрытия Edge |
| Установленный bundled Node v24.14.1 | Настоящий TCP-обрыв в изолированном fixture; исходный ID пережил перезапуск, ответ восстановлен, POST ровно один, ack очистил запись |
| Установленный Electron | Cloud Chat загрузился; trusted IPC getState/listPendingRequests и доступное имя поля проверены |
| Внутренний server smoke | Live/ready 200, новый status route без авторизации 401 |
| Публичный HTTPS через проверенный SSH-маршрут | Live/ready и Mini App 200; анонимные Mini App API и Desktop status 401 |
| Полная сверка исходников и установленных компонентов | Windows/GitHub/DE/NL согласованы; release-status issues пуст |

Первый Linux-запуск не имел соседних исходников, нужных тестам. Подключены
только read-only fixture-каталоги; server/src нового образа не подменялся.
Повторный полный набор прошёл. Отдельная PostgreSQL-БД после приёмки удалена;
рабочие диалоги, устройства и данные не использовались в fixture.

Прямые подключения Windows к GitHub, публичному HTTPS Jarvis и WSS во время
выпуска не проходили. Для Git, загрузок сборщика и SSH использован уже
настроенный Tailscale-маршрут с проверкой прежних host keys, без изменения
глобальных proxy/VPN-настроек. Выпуск и удалённые проверки доведены до результата.
Установленный Desktop остаётся paired, но его обычное прямое подключение к
облаку offline; это наблюдение подтверждено отдельными HTTPS/WSS-пробами из
Windows. Работу чата через обычный пользовательский маршрут нельзя считать
подтверждённой. Требуется восстановить этот сетевой доступ и проверить online.

Реальные микрофон/TTS и пользовательские изменяющие команды не запускались.
Одноразовый VPN-файл после потери ответа не восстанавливается; интерфейс
объясняет это. Ограничения standalone command creation и происхождения старой
истории перечислены в записи разработки. Независимое ревью и фикстуры не
заменяют эти живые проверки.

## English

On October 20, 2026, the owner authorized publication, both VPS updates and
Desktop build/installation. A03/A06/A07 code was published as
`051bb671ea15bb3f981ff9c0fda060773ceb621c`; later release commits change documentation.

DE runs `/home/deploy/releases/jarvis-051bb67-desktop-reliability`, image
`sha256:7ab527e0e85c22ad5c5744d2578a556f2e0f12fc5376bad9e6ce20cba0b49c32`.
All 328 server/shared files and Compose inputs match. All 87 prior environment
values were preserved without being printed. Existing bind-mount sources remain
intact. Only the server container changed; all other container IDs stayed the
same. Server is healthy, restart count zero. NL source is synchronized. All 17
Host Agent modules match on both nodes; Host Agent, Xray, Hysteria2 and existing
probe timers are active. No VPN repair, key rotation or backup/restore was run.

Desktop 1.0.2 was rebuilt and installed through NSIS `/S`, exit 0 after UAC
confirmation. Installer SHA-256:
`da6532cacf4e73a6caccd0e50d3f8531189a9ec3c530d79cba984238264d59a7`.
All 146 installed source/resource files, native Electron 42.11.9 and bundled
Node/Vosk match. No production dependencies changed; npmRebuild remains false.

Local core passed 5 runner, 102 cloud/Desktop and 778 server unit tests. The new
Linux image passed 778/778 with TZ=UTC. Missing sibling fixtures in the initial
image test were added read-only; runtime source was not overridden. An isolated
real PostgreSQL database applied 41 migrations and passed recovery, scope,
revocation, status and no-repeat checks; it was then removed. Production data
was untouched. Browser fixtures passed at 1440×900 and 760×560; Edge closure was
delayed but the process exited zero. Installed bundled Node v24.14.1 recovered
from a real local TCP socket loss after restart, using the original ID and
exactly one POST. Installed Electron loaded Cloud Chat and passed trusted IPC
and composer-name checks. Full source/runtime inventory reported no issues.

Internal live/ready returned 200. Public probes through the verified SSH route
returned 200 for live/ready and Mini App, and 401 for anonymous APIs including
the new Desktop status route. Direct Windows HTTPS/WSS and GitHub connections
were failing. Existing Tailscale access with prior host-key verification was
used for release traffic without changing global proxy/VPN settings. The
installed Desktop is paired but offline on its ordinary direct network route.
Restore that access and verify online before considering live chat accepted.
Microphone/TTS and user mutations were not exercised. One-time VPN artifact,
standalone command creation and historical-provenance limits remain documented
in the development record.
