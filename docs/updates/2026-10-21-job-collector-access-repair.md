# Доступ сборщика поиска работы / Job collector access

[Русский](#русский) | [English](#english)

## Русский

### Постоянное исправление выпущено

После согласования владельцем код опубликован в GitHub `main` коммитом
`1d20d4c7c307aab67e5e6f072274f31f93300bd7`. Оба VPS получили этот SHA и прошли
source guard. На DE установлен отдельный release
`/home/deploy/releases/jarvis-1d20d4c-job-collector-access`, server и сборщик
используют образ `sha256:b55adfdffdc9891269655a627f2a348ce3bb852497100601828874a4d5574ae7`.
Сверены все 328 файлов server/shared и параметры окружения обоих контейнеров;
расхождений нет. Основной Compose теперь передаёт owner ID без временного overlay.
Прежние releases и смонтированный inode секрета сохранены.

Сам образ прошёл 781/781 unit-тестов в Linux UTC и 3/3 доменных проверок с
изолированной PostgreSQL. Server healthy, restart count обоих контейнеров 0;
live/ready и Mini App через публичный HTTPS вернули 200. Python urllib получил
403 на внешнем маршруте, поэтому HTTP-проверка повторена curl и прошла.
Browser, OCR, PostgreSQL, ASR и cloudflared сохранили ID. NL получил исходники;
рабочие компоненты на нём не менялись. Desktop не требовал пересборки.

В 11:00:58 МСК зарегистрирована новая отправленная карточка вакансии.
При последующей замене контейнера сборщик сохранил прогресс и штатно записал
`JOB_COLLECTION_STOPPED`; ближайшая проверка владельца перенесена на текущий
момент, чтобы не ждать обычного интервала после выпуска. Настройки, lease другого
пользователя и отправленные отклики не менялись.

Итоговая сверка подтвердила совпадение принятой версии в Windows, GitHub и обоих
VPS. На обоих VPS issues пусты; совпали 17 модулей Host Agent на каждом узле.
Desktop 1.0.2: все 146 файлов, Electron 42.11.9 и bundled Node совпадают;
пересборка и установка не выполнялись. Проверка из чистого worktree сначала
не нашла локальные Electron build inputs; повторная проверка из канонического
Windows-каталога с имеющимися зависимостями прошла.

Незавершённая орбитальная Operations UI сохранена в своей ветке поверх свежей
`main`. Все 28 файлов вне общих документов восстановлены побайтно; в двух
MD-файлах сохранены её дополнения вместе с записью этого выпуска. Временный
stash удалён после сверки. Общий checker предупреждает только о сохранённой
активной ветке и её незакоммиченной работе. В публикацию они не вошли.

Ниже сохранена диагностика и локальная приёмка до согласования публикации.

21 октября владелец поручил восстановить поиск на VPS и проверить работу
нескольких пользователей с разными ролями и персональными разрешениями.

На DE `job-collector` не получал `JARVIS_OPERATIONS_OWNER_TELEGRAM_ID`.
Проверка прав отклоняла владельца с `JOB_SCOPE_DENIED`, после чего сборщик
молча пропускал его активный поиск. Сервисы оставались запущены и не писали
ошибку. Активной капчи не было; последнее фото успешно решено 19 октября.

В 10:56 МСК сборщик DE пересоздан на прежнем образе с настройкой владельца,
взятой из работающего server. Другие переменные сверены без вывода значений:
различалась только добавленная настройка. Использован приватный overlay
`/home/deploy/maintenance/job-collector-owner-20261021/compose.owner.yml`;
он зафиксирован в Compose labels нового контейнера. Исходные Compose-файлы,
окружение и образ сохранены. Server, browser, PostgreSQL и HH-профили не заменялись.
Право владельца подтверждено, поиск перешёл в `collecting`: сохранённый прогресс
продвинулся со страницы 19, элемента 13 до страницы 20, элемента 12.
Новая доставка карточки после ремонта этим наблюдением не подтверждена.

Многопользовательский режим уже реализован: роль и персональные разрешения
определяют право `jobs`, а внутренний UUID выбирает отдельный HH-профиль.
Подключение HH, настройки и активация поиска личные. Администрирование прав
не предоставляет доступ к чужим данным. Реальным пользователям права не менялись.

В локальной ветке `codex/jobs-collector-access` подготовлены:

- Передача owner ID сборщику в основном Compose и проверка настройки при запуске.
- Передача ошибок БД в существующий журнал worker вместо тихого пропуска.
- Обход всех страниц кандидатов до набора разрешённых пользователей. Раньше
  сто просроченных поисков без прав могли постоянно занимать первую страницу.
  Курсор сохраняет точность PostgreSQL и порядок по времени и UUID.
- Регрессионные проверки runtime и PostgreSQL для владельца, участников,
  администратора, ролей, allow/deny, блокировки, отзыва роли и уже выданного lease.

781/781 серверных unit-тестов, 5 Compose policy tests и 8/8 изолированных
Linux-проверок с настоящей PostgreSQL прошли. Последние включают 101 запрещённый
поиск перед разрешёнными и существующие проверки разделения HH-сессий.
Временная БД не имела доступа к production-сети и удалена после проверки.
Независимая ревизия после исправления очереди не нашла подтверждённых дефектов.

До согласования выпуска новый код ещё не был опубликован и установлен: ремонт DE ограничивался конфигурацией
прежнего контейнера. Для постоянного выпуска нужна публикация проверенной ветки
по release-workflow и обновление исходников обоих VPS; изменяется только сборщик
DE. Desktop не требует пересборки. NL не запускает поиск работы.

## English

### Permanent fix released

After owner approval, the code was published to GitHub `main` as
`1d20d4c7c307aab67e5e6f072274f31f93300bd7`. Both VPS nodes received this SHA and
passed the source guard. DE runs the separate release
`/home/deploy/releases/jarvis-1d20d4c-job-collector-access`; server and collector
use image `sha256:b55adfdffdc9891269655a627f2a348ce3bb852497100601828874a4d5574ae7`.
All 328 server/shared files and both containers' environment values match.
The main Compose file now forwards the owner ID without the temporary overlay.
Previous releases and the mounted secret inode were preserved.

The image itself passed 781/781 unit tests in Linux UTC and 3/3 domain checks
with isolated PostgreSQL. Server is healthy and both containers have zero
restarts; public HTTPS live/ready and Mini App returned 200. Python urllib
received 403 on the external route, so the HTTP checks were repeated with curl
and passed. Browser, OCR, PostgreSQL, ASR and cloudflared retained their IDs.
NL received source updates without changes to its running components.
Desktop did not require rebuilding.

A newly sent vacancy card was recorded at 11:00:58 Moscow time. During the
subsequent container replacement, the collector saved progress and recorded
`JOB_COLLECTION_STOPPED` during graceful shutdown; the owner's next check was
rescheduled immediately to avoid waiting for the regular interval after release.
Settings, other users' leases and submitted applications were not changed.

Final inventory confirmed the accepted version matches across Windows, GitHub
and both VPS nodes. Both VPS issue lists are empty; all 17 Host Agent modules
match on each node. Desktop 1.0.2 matches all 146 files, Electron 42.11.9 and
bundled Node; no rebuild or installation was performed. The clean worktree's
first check lacked local Electron build inputs; repeating from the canonical
Windows checkout with its existing dependencies passed.

Unfinished orbital Operations UI work is preserved in its branch atop current
`main`. All 28 files outside shared documents were restored byte for byte;
both shared Markdown files retain its additions alongside this release record.
The temporary stash was removed after verification. The overall checker warns
only about that preserved active branch and its uncommitted work. None of it
was included in this publication.

The diagnosis and local acceptance before publication approval are preserved below.

On October 21, the owner requested restoring VPS job search and checking support
for multiple users with different roles and personal permissions.

The DE `job-collector` did not receive `JARVIS_OPERATIONS_OWNER_TELEGRAM_ID`.
Authorization rejected the owner with `JOB_SCOPE_DENIED`, and the collector
silently skipped the active search. Services remained running without an error
log. No CAPTCHA was active; the last photo was successfully solved on October 19.

At 10:56 Moscow time, the DE collector was recreated using its previous image
and the owner setting from the running server. Other variables were compared
without displaying values; only the added setting differed. The private overlay
`/home/deploy/maintenance/job-collector-owner-20261021/compose.owner.yml` is
recorded in the new container's Compose labels. Original Compose files,
environment and image were preserved. Server, browser, PostgreSQL and HH profiles
were not replaced. Owner access passed and the search entered `collecting`:
saved progress advanced from page 19, item 13 to page 20, item 12.
This observation does not confirm a newly delivered vacancy card after the repair.

Multi-user support already exists: roles and personal permissions determine
`jobs` access, and the internal UUID selects a separate HH profile. HH connection,
settings and search activation are personal. Access administration does not grant
access to another person's data. No real user's permissions were changed.

The local `codex/jobs-collector-access` branch prepares:

- Owner ID forwarding in the main Compose file and startup validation.
- Propagation of database errors to the existing worker log instead of silent skipping.
- Candidate pagination until permitted users are selected. Previously, a hundred
  overdue searches without permission could permanently occupy the first page.
  The cursor preserves PostgreSQL precision and timestamp/UUID ordering.
- Runtime and PostgreSQL regression tests for owner, members, administrator,
  roles, allow/deny, blocking, role revocation and a previously issued lease.

781/781 server unit tests, five Compose policy tests and 8/8 isolated Linux checks
with real PostgreSQL passed. The latter include 101 denied searches ahead of
permitted users and existing HH session isolation checks. The temporary database
had no access to the production network and was removed afterwards. Independent
review found no confirmed defects after the queue fix.

Before release approval, the new code was neither published nor installed: DE repair changed only the
previous container's configuration. A permanent release requires publishing the
verified branch under release-workflow and synchronizing both VPS source trees;
only the DE collector component changes. Desktop does not require rebuilding.
NL does not run job search.
