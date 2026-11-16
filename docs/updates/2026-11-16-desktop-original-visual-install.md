# Desktop: оригинальный визуал панели / Original dashboard visual

## Русский

16 ноября по поручению владельца установлен локальный EXE
`1.0.3-dashboard.2`. Вместо упрощённой копии Desktop собирает оригинальные
OrbitalScene, SharedSky, материалы и движение из веб-панели. Осталось одно
ядро, общее небо и компактные элементы голоса/зрения. Планеты открывают
личные разделы Desktop; выделение следует выбранному разделу.

Сборка отдельным Vite IIFE использует локальные относительные пути. CSP и
IPC-границы сохранены, новых production-зависимостей нет. Setup устанавливает
существующие locked build-зависимости ops-ui. Исходники ops-ui не входят
в EXE; собранные ресурсы находятся в renderer/orbital.

Проверено: 19 браузерных сценариев, 17 тестов исходной сцены, TypeScript,
настоящий Electron с исходниками и повторно с собранным payload. Один
ресурсоёмкий тест геометрии превысил стандартные 5 секунд; с лимитом
20 секунд все 17 прошли. Нативный сценарий проверил вход, память с
подтверждением, журнал операции, запрет закрытого пути и сохранение настроек.

После установки: 172 файла совпали со сборкой, Electron 42.11.9 и bundled
Node 24.14.1 совпали, Vosk загрузился в bundled Node. Привязка сохранилась,
соединение online, оригинальная сцена ready и фон загружен через file://.
13 чтений через настоящий IPC и рабочий сервер успешны; все девять пунктов
меню, открытие/закрытие Life OS и возврат на главную проверены. Новых ошибок
renderer и горизонтального переполнения не обнаружено. Микрофон и камера
оставались выключены. Рабочие личные записи и HH-согласия не менялись.
Отладочный сеанс завершён, приложение запущено обычным способом.

SHA-256 установщика:
`cd0de6eaa990b3c5bd56ca99c3b0d95006388afc5797e12ca1d8e6ad09afb264`.
После локальной установки владелец поручил публикацию и обновление обоих VPS.
Выпуск завершён; результат публикации и проверки приведён ниже.
Перед выпуском исправлен старт с незавершёнными запросами: Assistant остаётся
видимым, а пользовательский переход во время загрузки не переопределяется.
Recovery-проверки прошли при 1440×900 и 760×560; inventory — 19 tests,
один Windows symlink skip. Каталог пяти ресурсов сцены включён в сверку EXE. [План](../plans/2026-11-16-desktop-original-visual.md).


### Публикация и VPS

Принятый код: `fa4c8a9d8e65f5b6e4ca8914616db0ac891aabdb`, объединён
в GitHub main. Windows и исходники DE/NL синхронизированы, рабочая ветка
объединена и удалена после проверки. Чужих незакоммиченных изменений нет.
Описание продукта, текущий статус, план и проверки обновлены на двух языках.

На DE установлен immutable server release `fa4c8a9`, image
`jarvis-desktop-server:fa4c8a9`. Перед заменой: preflight OK, 93 ключа
окружения совпали, исходный bind секрета сохранён. Собранный образ прошёл
7 route-тестов без ошибок и пропусков; Operations UI и Mini App собраны.
После замены: 391 серверный файл и входы сборки совпали. Публичные
live/ready, `/ops/` и `/mini/` вернули 200; закрытый Desktop route без токена
вернул 401. Сервер healthy; структурированные журналы после замены —
0 warning/error/fatal. Collector/browser сохранили container IDs;
Host Agent и VPN-сервисы активны на обоих VPS без переустановки.

Финальный EXE повторно установлен после ремонта стартового восстановления.
Сверка: 167 файлов кода и 5 ресурсов сцены совпали, native Electron и
bundled Node совпали. Повторная живая проверка: соединение online, сцена
ready, 13 чтений успешны, все 9 пунктов меню доступны, ошибок renderer — 0.
Приложение перезапущено обычным способом; отладочный порт закрыт.
Итоговая release-status проверка на принятой main завершилась с exit code 0.

[GitHub Release и EXE](https://github.com/godforg1veme/Jarvis/releases/tag/desktop-1.0.3-dashboard.2)
опубликованы как prerelease. Загружен установщик Windows x64 (197 038 970 bytes)
и SHA256SUMS.txt; digest GitHub совпал с локальным SHA-256, указанным выше.

## English

On November 16 the owner authorized installation of local EXE
`1.0.3-dashboard.2`. Desktop now builds the original web dashboard's
OrbitalScene, SharedSky, materials and motion instead of a simplified copy.
It has one core, one shared sky and compact voice/vision controls. Planets
open Desktop personal sections; selection follows the active section.

A dedicated Vite IIFE uses relative local assets. CSP and IPC boundaries
are preserved, with no new production dependencies. Setup installs the
existing locked ops-ui build dependencies. The EXE contains compiled assets
in renderer/orbital, without ops-ui sources.

Checks passed: 19 browser scenarios, 17 original scene tests, TypeScript,
and real Electron using both source and packaged payload. One CPU-heavy
geometry test exceeded the default five seconds; all 17 passed with a
20-second limit. Native acceptance covered pairing, confirmed memory writes,
operation journal settlement, denied private routes and saved settings.

After installation, all 172 checked files matched the build. Electron
42.11.9 and bundled Node 24.14.1 matched; Vosk loaded under bundled Node.
Existing pairing was preserved and the connection is online. The original
scene is ready and its sky loads via file://. All 13 reads through real IPC
and the live server succeeded. All nine menu entries, Life OS open/close
and return Home were checked without new renderer errors or horizontal
overflow. Microphone and camera remained off. Live personal records and
HH consent were not changed. The debug session was stopped and the app
restarted normally.

Installer SHA-256:
`cd0de6eaa990b3c5bd56ca99c3b0d95006388afc5797e12ca1d8e6ad09afb264`.
Following local installation, the owner authorized publication and both VPS
updates. Release completed; publication and acceptance results follow below.
Startup now keeps Assistant visible when unresolved requests exist and preserves
navigation chosen during startup. Recovery passed at 1440×900 and 760×560;
inventory passed 19 tests with one Windows symlink skip. Five compiled scene
assets are now included in installed EXE verification. [Plan](../plans/2026-11-16-desktop-original-visual.md).


### Publication and VPS

Accepted code `fa4c8a9d8e65f5b6e4ca8914616db0ac891aabdb` was merged into
GitHub main. Windows and DE/NL source checkouts are synchronized. The working
branch was removed after its merge was verified. No foreign uncommitted work
was present. Product description, status, plan and checks were updated in
both languages.

DE now runs immutable server release `fa4c8a9`, image
`jarvis-desktop-server:fa4c8a9`. Before replacement, preflight passed, all
93 environment keys matched and the original secret bind was preserved.
The built image passed 7 route tests with no failures or skips, and includes
compiled Operations UI and Mini App assets. After replacement, all 391 server
files and build inputs matched. Public live/ready, `/ops/` and `/mini/`
returned 200; the protected Desktop route returned 401 without a token.
The server is healthy; post-replacement structured logs contain zero warnings,
errors or fatal events. Collector/browser container IDs stayed unchanged.
Host Agent and VPN services remain active on both VPS hosts without reinstall.

The final EXE was reinstalled after the startup recovery fix. All 167 code
files and 5 compiled scene assets matched; native Electron and bundled Node
matched. Repeated live acceptance: online connection, ready scene, 13 successful
reads, all 9 menu entries available and zero renderer errors. The app was
restarted normally with the debugging port closed. Final release-status on
accepted main returned exit code 0.

The [GitHub Release and EXE](https://github.com/godforg1veme/Jarvis/releases/tag/desktop-1.0.3-dashboard.2)
are published as a prerelease. The Windows x64 installer (197,038,970 bytes)
and SHA256SUMS.txt are attached. GitHub's digest matches the local SHA-256 above.
