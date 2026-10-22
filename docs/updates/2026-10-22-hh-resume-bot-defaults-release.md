# Резюме в боте и автоподнятие: выпуск / Bot resume selection and default raising

[Русский](#русский) | [English](#english)

## Русский

22 октября по поручению владельца опубликованы выбор основного резюме кнопками
Telegram и бесплатное автоподнятие по умолчанию. Путь после личного подключения:
«Поиск работы → Резюме HH → нужное резюме → Подтвердить». Галочка отмечает
основное; бот показывает полное название перед сохранением. Есть обновление
списка и выключатель автоподнятия. Бот и Mini App используют одну настройку.
Явный off и остановка после неизвестного результата сохраняются.

Код и runtime: `f98f530a362a90cf6e3953ffb76497d2f1aec377`.
DE server/collector установлены из `/home/deploy/releases/jarvis-f98f530-hh-resume-bot`.
Образы server: `sha256:1042239c1f7ab920339b9b4e8582275c0c92255f13b2b172678e19c2ecad735e`;
collector: `sha256:2e1c12c6ba9a6578b897ce0c67b86307b3bfd3538d24cb8171a3016cb55cdaaf`.
Применены migration 042 (предпочтение и однократная политика) и 043
(scoped confirmation kind `resume`, без новых guided-input kinds).

Перед миграциями server/collector остановлены с обычным ожиданием завершения,
чтобы прежний процесс не записал настройку между backfill и заменой.
Сохранены окружение, настройки поиска, профили HH, тома и inode bind-секрета.
Заменены только server и collector, оба работают без перезапусков; server healthy.
Browser, PostgreSQL, OCR, ASR, tunnel и прочие контейнеры сохранили ID.
Восемь файлов готового Operations UI совпали с предыдущим работающим образом.
Файлы server/shared сверены в обоих новых контейнерах с принятым исходным кодом.

Действующая политика применена к одному подключённому аккаунту через общий
repository с проверкой актуального jobs и access/owner lock. Это идемпотентная
локальная настройка, без ручного запуска HH POST. Первый обычный worker tick
сохранил завершённую операцию `not_due`; автоподнятие остаётся включённым.
Успешное поднятие не подтверждено. Оно выполняется только для основного резюме,
бесплатно, не чаще раза в четыре часа и при доступности кнопки HH.

Проверки Linux: server 787/787, PostgreSQL 32/32 на отдельной внутренней сети,
включая десять сценариев Telegram и гонку отзыва jobs. Тестовый PostgreSQL
и сеть удалены. Локальные проверки Mini App build, Edge 1280/390 и прежний
fixture 320/390/1280 прошли. Независимая ревизия выполнена, два подтверждённых
дефекта исправлены. Scope/revision/expiry, single consumption, original ID и
неповторение unknown сохранены. Выключение текущего расписания не требует HH.

Публичные live/ready, Mini App, Operations и JS/CSS вернули 200; анонимные
me/resumes — 401. Модуль панели точно совпал с принятой версией. DE/NL source
guards и runtime inventory прошли. Host Agent и VPN-службы активны и не менялись;
это проверка состояния служб, не новая проверка прохождения VPN-трафика.
Desktop 1.0.2 совпал по 146 файлам, Electron 42.11.9 и bundled Node.

В скрипте сверки исправлен Git path delimiter для нового Compose overlay;
15 проверок скрипта прошли. Этот коммит не требует перезапуска runtime.
Windows main-worktree и исходники обоих VPS синхронизированы. Незавершённые
правки Operations UI/сверки в основной Windows-папке сохранены; из-за этой
активной ветки общая проверка возвращает предупреждения. Она не перезаписывалась.

Реальные нажатия владельца/участника в Telegram, телефона и успешное поднятие
остаются клиентской приёмкой. Приватные результаты установки и наблюдения:
`/home/deploy/maintenance/hh-resume-bot-defaults-20261022`.
Детали реализации: [историческая разработка](2026-10-22-hh-resume-bot-defaults-development.md).

## English

On October 22, with owner authorization, the release added primary resume
selection through Telegram buttons and free raising by default. After personal
connection: “Job search → HH resumes → select resume → Confirm”. A check marks
the primary; the bot shows its full title before saving. Refresh and a separate
auto-raise switch are available. Bot and Mini App share settings. Explicit off
choices and unknown-result stops remain in effect.

Code and runtime: `f98f530a362a90cf6e3953ffb76497d2f1aec377`.
DE server/collector run from `/home/deploy/releases/jarvis-f98f530-hh-resume-bot`.
Server image: `sha256:1042239c1f7ab920339b9b4e8582275c0c92255f13b2b172678e19c2ecad735e`;
collector: `sha256:2e1c12c6ba9a6578b897ce0c67b86307b3bfd3538d24cb8171a3016cb55cdaaf`.
Applied migration 042 for preference/one-time policy and 043 for scoped `resume`
confirmations, without new guided-input kinds.

Server/collector were stopped with normal graceful waiting before migration,
preventing the previous process from saving between backfill and replacement.
Environment, search settings, HH profiles, volumes and mounted secret inode
were preserved. Only server and collector were replaced; both run with zero
restarts and server is healthy. Browser, PostgreSQL, OCR, ASR, tunnel and other
containers retained their IDs. All eight compiled Operations UI files match
the previous running image. Server/shared files in both new containers were
compared with the accepted source.

The policy was applied to one connected account through the shared repository,
checking current jobs access and the access/owner lock. This idempotent local
setting did not manually invoke an HH POST. The first ordinary worker tick
saved a complete `not_due` operation; automatic raising remains enabled.
A successful raise is unconfirmed. Raising targets only the primary, uses
the free action, runs at most once every four hours and requires HH readiness.

Linux checks passed: server 787/787 and PostgreSQL 32/32 on a separate internal
network, including ten Telegram scenarios and the jobs-revocation race. The
test database and network were removed. Local Mini App build, Edge panel
1280/390 and existing fixture 320/390/1280 passed. Independent review was
completed and both confirmed findings fixed. Scope, revision, expiry, single
consumption, original IDs and unknown non-replay remain. Disabling the current
schedule requires no HH access.

Public live/ready, Mini App, Operations and JS/CSS returned 200; anonymous
me/resumes returned 401. The panel module exactly matches accepted source.
DE/NL source guards and runtime inventories passed. Host Agent and VPN services
remain active and unchanged; this verifies service state, not a new end-to-end
VPN traffic probe. Desktop 1.0.2 matches all 146 files, Electron 42.11.9 and
bundled Node.

The inventory script's Git path delimiter was corrected for the new Compose
overlay; all 15 inventory tests passed. This commit needs no runtime restart.
The Windows main worktree and both VPS source checkouts are synchronized.
Unfinished Operations UI/inventory work in the canonical Windows folder was
preserved; that active branch explains the remaining inventory warnings.

Real owner/member Telegram taps, phone use and a successful raise remain
client acceptance checks. Private installation/observation evidence:
`/home/deploy/maintenance/hh-resume-bot-defaults-20261022`.
Implementation details: [historical development record](2026-10-22-hh-resume-bot-defaults-development.md).
