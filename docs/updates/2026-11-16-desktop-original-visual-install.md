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
Выпуск выполняется; окончательные SHA и проверки будут записаны ниже.
Перед выпуском исправлен старт с незавершёнными запросами: Assistant остаётся
видимым, а пользовательский переход во время загрузки не переопределяется.
Recovery-проверки прошли при 1440×900 и 760×560; inventory — 19 tests,
один Windows symlink skip. Каталог пяти ресурсов сцены включён в сверку EXE. [План](../plans/2026-11-16-desktop-original-visual.md).

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
updates. Release is in progress; final revisions and checks will be recorded below.
Startup now keeps Assistant visible when unresolved requests exist and preserves
navigation chosen during startup. Recovery passed at 1440×900 and 760×560;
inventory passed 19 tests with one Windows symlink skip. Five compiled scene
assets are now included in installed EXE verification. [Plan](../plans/2026-11-16-desktop-original-visual.md).
