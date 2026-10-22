# Living sky implementation plan

**Goal:** Оживить общий фон, сохранив утверждённый внешний вид и управление движением.
**Architecture:** SharedSky содержит одну прежнюю текстуру, мягкую световую вуаль
и один Canvas 2D. Рендерер звёзд не знает о React и API; компонент управляет
активным временем, ResizeObserver и requestAnimationFrame.
**Tech Stack:** существующие React/TypeScript, Canvas 2D, CSS animations.
**Spec:** [living-sky-design](../specs/2026-10-22-living-sky-design.md).

## Ограничения

Без новых зависимостей и внешних ресурсов. Общий фон для сцены и сайдбара.
Не менять API, орбиты и тела планет. До 30 fps, DPR <= 1.5. Все слои подчинены
паузе, скрытию вкладки, reduced motion и остановке при ошибке 3D.

## Задача 1: Общий фон

- [x] Создать `ops-ui/src/components/orbital/skyParticlePainter.ts`: детерминированные
  слои; `createSkyPainter(canvas)` возвращает `resize()` и `paint(seconds)`.
- [x] Создать `SkyParticles.tsx`: `animate: boolean`; сохранить активное время
  между паузами, отменять RAF, переиспользовать узор при resize.
- [x] Обновить `SharedSky.tsx` и отдельный `shared-sky.css`: более заметный
  параллакс картинки, мягкая вуаль; перенести прежние sky-правила из inspector.
- [x] Проверить unit-сценарии RAF: движение, pause/resume, скрытая вкладка,
  cleanup, отсутствие Canvas API и ошибка картинки.
- [x] Выполнить `npm test --prefix ops-ui` и `npm run build --prefix ops-ui`.

## Задача 2: Приёмка

- [x] Использовать локальные безопасные fixtures из существующего browser suite.
  Сравнить кадры t=0/6/12 на 1440px и 390px, общий фон под сайдбаром,
  полную остановку, reduced motion, resize и отсутствие горизонтального скролла.
- [x] Получить независимую ревизию diff, исправить подтверждённые замечания.
- [x] Сохранить локальное видео/скриншоты и результат проверок в RU/EN записи
  `docs/updates/2026-10-22-living-sky-development.md` и дать ссылку в статусе.
- [x] Показать результат пользователю; publication требует отдельного поручения.
