# Автоматическое движение Mini App / Automatic Mini App motion

[Русский](#русский) | [English](#english)

## Русский

По новому указанию владельца кнопка «Пауза / Продолжить» удалена. Орбиты и фон
включены по умолчанию, в том числе при системном reduced motion. Ручного
выключателя, скорости и сброса вида больше нет. Перезагрузка сохраняет это
поведение без дополнительного нажатия. Это заменяет правило ручного запуска из
[предыдущего исправления](2026-10-23-mini-app-motion-fix.md).

Технические остановки сохранены: скрытая страница, невидимая сцена, открытый
раздел, потерянный WebGL-контекст. Возврат возобновляет движение автоматически.
Пауза при наведении мыши или клавиатурном фокусе помогает выбрать планету;
касание не удерживает hover. Изменения выпущены на DE; исходники обоих VPS и Windows main в рабочей папке Mini App синхронизированы с GitHub.

Mini App build, client suite и orbital browser suite прошли. Проверены автозапуск
при reduced motion, смена системной настройки, перезагрузка, возврат, touch,
WebGL fallback, отсутствие кнопки и ошибок JavaScript/CSP.


Код выпуска: `c360e88beeed3333be0c02c8933f3a4649faf4be`.
DE release: `/home/deploy/releases/jarvis-c360e88-mini-auto-motion`, образ
`jarvis-mini-auto-motion:c360e88`. Preflight, source/release guard, 792/792 server
tests в новом Linux-образе, health и внешние live/ready smoke прошли. Десять
публичных Mini App assets совпадают с образом; отсутствие кнопки и автозапуск
подтверждены в отдаваемом коде. Заменён только server; окружение, секреты
и ID других контейнеров сохранены. Оба VPS без расхождений. Установленный
Desktop, native Electron, bundled Node и Host Agent совпадают; установка не нужна.

В `F:/test/jarvis` идёт отдельная работа `codex/hh-captcha-recovery` с уникальным
планом и незакоммиченными файлами job-browser. Она сохранена и не включена в
выпуск. Поэтому общая release-status отмечает SOURCE/BRANCHES/WORKTREES_NEED_REVIEW
для этой активной работы; Windows main в отдельной рабочей папке чистая.
Последующая фиксация результата меняет только MD. Живая проверка на телефоне остаётся.

## English

Following the owner's new instruction, the Pause / Resume button was removed.
Orbits and sky are enabled by default, including under system reduced motion.
There is no manual toggle, speed setting or view reset. Reload keeps this
behavior without another click. This supersedes the manual-start rule from the
[previous repair](2026-10-23-mini-app-motion-fix.md).

Technical suspension remains for hidden pages, offscreen scenes, open sections
and lost WebGL contexts. Returning resumes motion automatically. Mouse hover
or keyboard focus pauses movement to help select a planet; touch does not retain
hover. These changes are deployed to DE; both VPS sources and Windows main in the Mini App worktree match GitHub.

Mini App build, client suite and orbital browser suite passed. Checks cover
autostart under reduced motion, system preference changes, reload, return,
touch, WebGL fallback, absent controls and no JavaScript/CSP errors.

Release code: `c360e88beeed3333be0c02c8933f3a4649faf4be`.
DE release: `/home/deploy/releases/jarvis-c360e88-mini-auto-motion`, image
`jarvis-mini-auto-motion:c360e88`. Preflight, source/release guard, all 792 server
tests in the new Linux image, health and external live/ready smoke passed. Ten
public Mini App assets match the image; absent controls and autostart are
verified in the served code. Only server was replaced; environment, secrets and
other container IDs were preserved. Both VPS comparisons pass. Installed Desktop,
native Electron, bundled Node and Host Agent match; no installation was needed.

Separate work on `codex/hh-captcha-recovery` is active in `F:/test/jarvis`, with a
unique plan and uncommitted job-browser files. It is preserved and excluded from
this release. The combined release-status therefore reports source/branch/worktree
review flags for that active work; Windows main in the separate worktree is clean.
The subsequent result record changes MD only. Live phone acceptance remains.
