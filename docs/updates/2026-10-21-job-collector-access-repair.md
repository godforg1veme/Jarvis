# Доступ сборщика поиска работы / Job collector access

[Русский](#русский) | [English](#english)

## Русский

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

Новый код ещё не опубликован и не установлен: ремонт DE ограничен конфигурацией
прежнего контейнера. Для постоянного выпуска нужна публикация проверенной ветки
по release-workflow и обновление исходников обоих VPS; изменяется только сборщик
DE. Desktop не требует пересборки. NL не запускает поиск работы.

## English

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

The new code is neither published nor installed: DE repair changes only the
previous container's configuration. A permanent release requires publishing the
verified branch under release-workflow and synchronizing both VPS source trees;
only the DE collector component changes. Desktop does not require rebuilding.
NL does not run job search.
