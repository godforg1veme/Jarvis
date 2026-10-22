# Живой космос Operations UI — выпуск 22 октября

[Русский](#русский) | [English](#english)

## Русский

Пользователь принял фон и поручил выпуск после финальной проверки анимаций.
Подготовлен единый движущийся фон под сценой и прозрачной панелью: Млечный Путь
NASA/Gaia 4K/8K, 1800 звёзд на широком экране и 900 на узком, разная скорость,
мерцание и редкие независимые вспышки. Скорость фона удвоена относительно
первого локального варианта. Пауза, скрытая вкладка и reduced motion останавливают
все слои. При ошибке 8K загружается 4K, при недоступной текстуре остаются звёзды.
Геометрия планет и существующие орбиты сохранены.

Подробности и атрибуция: [локальная приёмка](2026-10-22-living-sky-development.md),
`ops-ui/public/assets/SKY-CREDITS.md`.

Финальные проверки до публикации:

- Unit 46/46 и production build прошли.
- Независимая браузерная приёмка проверила 1800/900 звёзд, распределение,
  разреженные вспышки на 201 фиксированном времени, движение Canvas и текстуры,
  остановку кадров и продолжение, общий фон при смене разделов.
- Орбитальная проверка всех девяти разделов на 1440/662/390/320 px прошла:
  WebGL, планеты, орбиты, hover, поиск, открытие/закрытие панели, возврат ширины,
  пауза, hidden, reduced motion и fallback. Покрытие углов также проверено
  на 2560×1080 и 3840×1080; сохранён кадр 3840×2160.
- Production assets под действующей CSP, локальные 4K/8K ресурсы, сервисная
  панель и вложенное подтверждение прошли. Повторная ревизия не нашла
  подтверждённых дефектов после исправления responsive sizes, углов и fallback.

Статус: публикация и установка выполняются. Результат VPS и публичных проверок
будет записан после завершения. Установленный Desktop 1.0.2 совпадает с исходниками;
его сборка и установка не нужны. Физический телефон недоступен: FPS, расход
батареи и память с GPU-композицией не измерены.

## English

The user accepted the sky and authorized release after final animation checks.
The shared moving background continues beneath the scene and translucent panel:
NASA/Gaia Milky Way at 4K/8K, 1800 stars on wide screens and 900 on narrow screens,
different speeds, twinkling and sparse independent glints. Background speed is
twice the first local version. Pause, hidden tabs and reduced motion stop every
layer. An unavailable 8K image falls back to 4K; missing textures leave the stars.
Planet geometry and the existing orbits are preserved.

Details and attribution: [local acceptance](2026-10-22-living-sky-development.md),
`ops-ui/public/assets/SKY-CREDITS.md`.

Final checks before publication:

- All 46 unit tests and the production build passed.
- Independent browser acceptance verified 1800/900 stars, distribution,
  sparse glints at 201 fixed times, moving Canvas and texture, frozen frames
  and resume, and the shared sky across section changes.
- Orbital checks of all nine sections at 1440/662/390/320 px passed: WebGL,
  planets, orbits, hover, search, panel open/close, restored scene width,
  pause, hidden tabs, reduced motion and fallback. Corner coverage also passed
  at 2560×1080 and 3840×1080; a 3840×2160 frame was saved.
- Production assets under the existing CSP, local 4K/8K files, service panel
  and nested confirmation passed. Follow-up source review found no confirmed
  defects after responsive sizes, corner coverage and fallback fixes.

Status: publication and installation are in progress. VPS and public verification
results will be recorded after completion. Installed Desktop 1.0.2 matches the
source; no Desktop build or installation is needed. A physical phone is
unavailable: FPS, battery use and memory including GPU composition are unmeasured.
