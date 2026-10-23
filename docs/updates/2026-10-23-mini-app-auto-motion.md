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
касание не удерживает hover. Изменения пока локальные и не выпущены на VPS.

Mini App build, client suite и orbital browser suite прошли. Проверены автозапуск
при reduced motion, смена системной настройки, перезагрузка, возврат, touch,
WebGL fallback, отсутствие кнопки и ошибок JavaScript/CSP.

## English

Following the owner's new instruction, the Pause / Resume button was removed.
Orbits and sky are enabled by default, including under system reduced motion.
There is no manual toggle, speed setting or view reset. Reload keeps this
behavior without another click. This supersedes the manual-start rule from the
[previous repair](2026-10-23-mini-app-motion-fix.md).

Technical suspension remains for hidden pages, offscreen scenes, open sections
and lost WebGL contexts. Returning resumes motion automatically. Mouse hover
or keyboard focus pauses movement to help select a planet; touch does not retain
hover. These changes remain local and have not been deployed to the VPS.

Mini App build, client suite and orbital browser suite passed. Checks cover
autostart under reduced motion, system preference changes, reload, return,
touch, WebGL fallback, absent controls and no JavaScript/CSP errors.
