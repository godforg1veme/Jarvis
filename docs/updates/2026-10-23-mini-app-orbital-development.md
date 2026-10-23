# Орбитальный Mini App / Orbital Mini App

[Русский](#русский) | [English](#english)

## Русский

Более новый результат: [выпуск 23 октября](2026-10-23-mini-app-orbital-release.md). Локальный статус ниже сохранён как история этапа.

Следующий локальный этап: [единый дизайн всех внутренних экранов](2026-10-23-mini-app-interiors-development.md).
Ниже сохранён результат орбитальной оболочки и её проверок.

23 октября локально реализован выбранный владельцем орбитальный Mini App после
[исправления UX](2026-10-23-mini-app-ux-development.md). Изменения находятся
в ветке `codex/mini-app-ux`, в отдельном worktree. В GitHub и на VPS не публиковались.

Материалы, свет, сетка и типы планет перенесены из Operations UI: графитовые
сферы, серебристые края, тонкие кольца и спутники. Планеты обращаются по
эллиптическим траекториям и отдельно вращаются вокруг осей. Портретный экран
использует более узкие орбиты; тип планеты закреплён за разделом и сохраняется
при разном наборе прав.

Раздел открывается в тёмной стеклянной панели снизу на телефоне и справа
на широком экране. Есть разворот панели, закрытие, Escape и мобильный свайп
по её шапке: вверх развернуть, вниз закрыть. Свайп проверен браузерными
touch-событиями через CDP; физический жест требует клиентской приёмки.
Поиск раскрывает и фильтрует обычный список разделов. Док содержит только
работающие переходы; администрирование видно по существующей роли.

Шесть планет создаются только для доступных диалога, памяти, документов,
устройств, Life OS и поиска работы. VPN и Operations остаются в списке
с теми же серверными ограничениями. Открытие панели, наведение или фокус
приостанавливают движение. Сохраняются явная пауза, reduced motion, остановка
скрытой сцены, fallback и восстановление WebGL. В статичном режиме доступен
обычный список. Контекстная потеря WebGL останавливает также фон.

Фон использует ту же локальную 4K-текстуру NASA/Gaia и настройки grayscale,
яркости и контраста, что дашборд. Авторство переносится в `assets/SKY-CREDITS.md`.
Внешних API, CDN для сцены и новых зависимостей нет. Сборка копирует только
явные файлы; серверная allowlist добавляет лишь необходимые модули, CSS и фон.
Отдельный Docker mini-build получает текстуру из существующего ui-build.

Проверки: Mini App build; server 792/792 без пропусков; расширенный
`testMiniAppClient.cjs`; `testHhLoginTouch.cjs` на 390/1280; прежний
`testMiniAppPreview.cjs` с WebGL, reduced motion и fallback; новый
`testMiniAppOrbital.cjs` для production assets и орбитальной оболочки, включая
восстановление потерянного WebGL-контекста, сенсорный свайп и canvas при DPR 2.
Браузерные fixtures используют Edge и вымышленные данные. Независимая ревизия
проверила навигацию, lifecycle, права и упаковку; замечания исправлены.
Скриншоты находятся в игнорируемой `.superpowers/mini-app-orbital/`.

Настоящие Telegram cookies/BackButton, клавиатура и FPS физического телефона
не подтверждены. Linux Docker image не собирался в этой среде. Desktop не
менялся, пересборка EXE не нужна. Для приёмки в Telegram потребуется согласованный
выпуск Mini App в составе серверного образа; исходники обоих VPS синхронизируются
по обычному порядку выпуска.

## English

Superseded by the [October 23 release](2026-10-23-mini-app-orbital-release.md). The local status below is retained as stage history.

Next local stage: [the shared design across all interiors](2026-10-23-mini-app-interiors-development.md).
The orbital-shell implementation and its checks are retained below.

On October 23 the owner's selected orbital Mini App was implemented locally
after the UX repair, on `codex/mini-app-ux` in a separate worktree. It has not
been published to GitHub or deployed to either VPS.

Dark body materials, surface networks, silver rims, rings, moons and lighting
come from Operations UI. Each planet follows an elliptical orbit and spins
around its own axis. Portrait layouts compress the horizontal orbit extent;
planet types remain tied to section keys regardless of a user's permission set.

Sections open in a bottom sheet on phones and a right-hand workspace on wider
screens. The panel supports expansion, close/Escape and mobile header swipes.
Search reveals and filters the stable section list; the dock exposes working
routes and retains role-based administration visibility. Only permitted personal
sections get planets. VPN and Operations retain their existing list access and
server restrictions.

The local NASA/Gaia sky texture, credits and grayscale/brightness/contrast match
the dashboard. Motion pauses for workspace interaction, hover/focus, explicit
pause, reduced motion and hidden scenes. WebGL loss stops both scene and sky,
with list navigation available as fallback. No new production dependencies or
external scene services were added. Explicit build inputs, server asset routes
and Docker mini-build packaging include the shared texture and new modules.

Validation includes build, 792/792 server tests without skips, the extended
client browser suite, HH touch at 390/1280, existing preview WebGL/fallback tests
and the new orbital production-assets browser suite, including WebGL context
loss/recovery, browser touch swipes and canvas alignment at DPR 2. Fixtures use Edge and
fictional data; independent review findings were addressed. Screenshots remain
under ignored `.superpowers/mini-app-orbital/`.

Real Telegram cookies/BackButton, physical phone keyboard/FPS and gestures remain
unverified. The Linux Docker image was not built in this environment. Desktop
did not change and needs no EXE rebuild. Telegram acceptance requires an authorized
Mini App/server-image release and the usual synchronization of both VPS sources.
