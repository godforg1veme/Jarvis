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

Установлено на [рабочую панель](https://jarvis.rilora.ru/ops/).
Код выпуска: `07edda299f0f226d081974c876e14b80604a15f5`, отдельный release
`/home/deploy/releases/jarvis-07edda2-living-sky`, образ
`jarvis-living-sky:07edda299f0f`, здоровый контейнер `312a0807530d`.
Оба VPS source checkout обновлены из GitHub `main`; последующие изменения
документации не требуют повторной сборки образа.

Образ прошёл 787/787 Linux-проверок без пропусков; 336 серверных/shared файлов
сверены с исходниками. Все 11 файлов Operations совпали с локальной принятой
сборкой (в HTML нормализованы окончания строк); ресурсы Mini App совпали с
прежним работающим образом. Публичные `/health/live`, `/health/ready`, `/ops/`
доступны, хеши всех 11 публичных файлов совпали с контейнером, API без входа
возвращает 401. Окружение, volumes и inode секретного bind mount сохранены;
другие контейнеры не заменялись. Шесть сервисов сообщают healthy, свежие метрики
поступают. В существующей сессии владельца загружены новый фон и сервисная панель;
проверены пауза, продолжение и возврат к системе.

Установленный Desktop 1.0.2 совпадает с исходниками; его сборка и установка
не нужны. Host Agent и VPN не менялись. Локальная задача остаётся на
`codex/orbital-monitoring`, поскольку `main` занят чужим чистым worktree;
чужие checkout и refs сохранены. Их сохранение отмечается предупреждением
общего source inventory и не влияет на чистые source/release guards VPS.
Физический телефон недоступен: FPS, расход батареи и память с GPU-композицией
не измерены.

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

Installed on the [live Operations panel](https://jarvis.rilora.ru/ops/).
Application revision: `07edda299f0f226d081974c876e14b80604a15f5`, dedicated release
`/home/deploy/releases/jarvis-07edda2-living-sky`, image
`jarvis-living-sky:07edda299f0f`, healthy container `312a0807530d`.
Both VPS source checkouts were updated from GitHub `main`; subsequent documentation
changes do not require another image build.

The image passed all 787 Linux checks without skips; 336 server/shared files
were compared with the source. All 11 Operations files matched the accepted local
build (HTML line endings normalized); Mini App assets matched the previous running
image. Public `/health/live`, `/health/ready` and `/ops/` are available; all 11 public
file hashes match the container, and the API returns 401 without sign-in.
Environment, volumes and the secret bind-mount inode are preserved; no other
containers were replaced. All six services report healthy and fresh metrics
arrive. The existing owner session loaded the new sky and service panel;
pause, resume and return to the system were checked.

Installed Desktop 1.0.2 matches the source; no Desktop build or installation is
needed. Host Agent and VPN were unchanged. The local task remains on
`codex/orbital-monitoring` because `main` is checked out in someone else's clean
worktree; other checkouts and refs are preserved. This produces a warning in the
shared source inventory without affecting clean VPS source/release guards.
A physical phone is unavailable: FPS, battery use and memory including GPU
composition are unmeasured.
