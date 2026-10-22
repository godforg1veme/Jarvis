# Выпуск орбитального мониторинга / Orbital monitoring release

[Русский](#русский) | [English](#english)

## Русский

22 октября выбранное оформление Operations UI опубликовано в GitHub `main`
и установлено на DE: [рабочая панель](https://jarvis.rilora.ru/ops/).
Исходники обоих VPS синхронизированы. Desktop и Host Agent не менялись.
Server release: `64f27bced804711fcdc27d9745d1d721acd534fa`, каталог
`/home/deploy/releases/jarvis-64f27bc-orbital`, контейнер `1a23ab0a9d97`.
Более поздние изменения документации не требуют пересборки этого образа.

Состав: орбитальная сцена, общий движущийся фон, прозрачная панель, девять
существующих разделов и мобильная компоновка. Основные метрики видны сразу,
остальные раскрываются. API, вход и серверные права остаются прежними.

Локальные проверки: 42 unit, TypeScript/build, native dialogs, bootstrap,
девять разделов на 1440/662/390/320 px, WebGL fallback и production CSP.
Предрелизная ревизия обнаружила повтор переназначения после потерянного ответа.
Он заблокирован сохранённым намерением в текущей сессии браузера; недоступность
хранилища запрещает отправку. Неопределённый результат требует отдельной проверки.
Автоматические повторные POST не добавлялись.

Проверка установки:

- Linux image: 786/786 server tests, без пропусков; 332 source/shared файла
  сверены до замены, итоговый inventory сверяет 334 файла с package inputs.
- Публичные live/ready и `/ops/`: HTTP 200; все 8 UI-файлов совпали по SHA-256
  с образом. API сервисов без входа вернул 401.
- После замены только server остальные контейнеры сохранили IDs, окружение
  приложения, named volumes и inode секретов сохранены.
- Реальный collector показывает шесть сервисов в healthy и свежие метрики:
  154 samples за пять минут в момент проверки. Это проверено чтением данных
  через repository внутри server, без запуска команд управления.
- DE и NL: Host Agent модули совпадают, службы активны. Desktop 1.0.2 совпадает
  по 146 файлам, package, Electron native и wake runtime; установка не выполнялась.
- Исправлена проверка release inputs: `git diff --` принимает локальный Compose
  overlay, отсутствующий в source. 15 release-status tests прошли.

Полный inventory возвращает ненулевой код из-за сохранённых локальных рабочих
веток и worktrees соседнего чата. VPS, server и Desktop совпадают; чужие checkout
не переключались ради чистого отчёта. Локальный source находится на рабочей ветке
с тем же принятым содержимым. Вход в новом браузере подтверждён штатным экраном и Telegram. Все девять
разделов открылись с реальными данными без ошибок загрузки. Журнал server
загрузился (содержимое в отчёт не выводилось); подтверждены живые значения
процессора, памяти, диска и нагрузки. Обхода авторизации нет. Реальные FPS
и удобство на физическом телефоне остаются для клиентской проверки.

Подробности разработки и принятые решения:
[локальный этап](2026-10-21-orbital-monitoring-development.md).

## English

On October 22 the selected Operations UI was published to GitHub `main`
and installed on DE: [live panel](https://jarvis.rilora.ru/ops/).
Both VPS source checkouts are synchronized. Desktop and Host Agent were unchanged.
Server release: `64f27bced804711fcdc27d9745d1d721acd534fa`, directory
`/home/deploy/releases/jarvis-64f27bc-orbital`, container `1a23ab0a9d97`.
Later documentation changes do not require rebuilding this image.

Scope: orbital scene, a shared moving sky, translucent workspace, nine existing
sections and mobile layout. Primary metrics are visible immediately; additional
metrics use disclosure. APIs, authentication and server permissions stay intact.

Local checks: 42 unit tests, TypeScript/build, native dialogs, bootstrap, nine
sections at 1440/662/390/320 px, WebGL fallback and production CSP. Pre-release
review found a reassignment retry after a lost response. A persisted intent now
blocks it within the current browser session; unavailable storage prevents sending.
An unconfirmed result requires separate verification. No automatic POST retries
were added.

Installation verification:

- Linux image: all 786 server tests passed without skips; 332 source/shared files
  matched before replacement, and final inventory checks 334 files with package inputs.
- Public live/ready and `/ops/`: HTTP 200; all 8 UI files matched the image SHA-256
  hashes. The services API returned 401 without authentication.
- Only server was replaced. Other container IDs, application environment,
  named volumes and secret inodes were preserved.
- The real collector reports six healthy services and fresh metrics: 154 samples
  over five minutes at verification time. This was a read through the repository
  inside server, without running operational commands.
- DE/NL Host Agent modules match and services are active. Desktop 1.0.2 matches
  across 146 files, package, native Electron and wake runtime; no installation ran.
- Release input verification now uses `git diff --` for local Compose overlays
  absent from source. All 15 release-status tests passed.

Full inventory returns nonzero because local working branches and worktrees from
another chat are preserved. VPSs, server and Desktop match; unrelated checkouts
were not switched to make the report clean. Local source remains on the task
branch with the accepted content. Sign-in in the new browser was approved through the normal screen and Telegram.
All nine sections opened with real data and no read errors. Server logs loaded
without printing their contents; live CPU, memory, disk and load values were
verified. Authentication was not bypassed. Actual FPS and usability on a physical
phone remain client checks.

Development details and accepted decisions:
[local work](2026-10-21-orbital-monitoring-development.md).
