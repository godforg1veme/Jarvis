# Пустые фильтры и ввод списком / Empty job filters and multiline input

[Русский](#русский) | [English](#english)

## Русский

По поручению владельца новые профили поиска начинают с пустых запросов и
исключений, без зарплаты, города и ограничения формата работы. Удалены скрытые
правила, которые пропускали только AI-профессии и исключали продажи. Сохранённые
настройки остальных пользователей автоматически не сбрасываются.

В Telegram: «Поиск работы → Настройки → Поисковые запросы → Добавить».
Можно отправить несколько фраз одним сообщением, каждую с новой строки:

```text
Менеджер по закупкам
Снабжение
Логистика
```

Каждая строка — отдельный запрос HH. Пустые строки пропускаются, точные повторы
не добавляются. Запросы — до 100 фраз по 2–200 символов, исключения — до 50 фраз
по 1–100 символов. Если строка неверна или список переполнен, ничего не сохраняется,
ввод остаётся доступным для исправления. Бот показывает весь добавляемый список
перед одним подтверждением. Есть очистка списка и снятие отдельных ограничений.
Удаление последнего запроса выключает поиск. Без запросов включение и сбор
запрещены; новые запросы начинают свой период поиска с новым checkpoint.
Интервал, глубина первоначальной выдачи и уведомление о расходах остаются
рабочими настройками, а не подставленными предпочтениями профессии.

Сохраняются действующее право jobs, private chat, числовая Telegram-личность,
revision, expiry и однократное потребление ввода/подтверждения. Новых callback
форм и guided kinds нет. Адресная очистка Сени выполняется только после
проверки его UUID и Telegram ID; факты, сопроводительные, резюме и история откликов
не удаляются. Старые ожидающие карточки его поиска снимаются с доставки.

Локально прошли 785 server unit, 66 Telegram gate и 10 PostgreSQL acceptance.
ПК: Edge fixture с настоящими Telegram message/menu handlers и отдельной БД
прошёл ввод несколькими строками, предпросмотр, сохранение, удаление повторов
и очистку. Это локальная проверка, а не настоящее нажатие из клиента Telegram.
Независимая проверка прав не нашла блокирующих замечаний; найденная возможность
сохранить пустой активный поиск закрыта также в repository и старом редакторе.

Выпущено по поручению владельца в GitHub `main`; исходники Windows, DE и NL
синхронизированы. Код и runtime release: `87b6cf33fceea3c676ec5276888169a8a59c2247`,
`/home/deploy/releases/jarvis-87b6cf3-empty-job-filters`.
Server image: `sha256:e6d54401e9992173fe76dc8dd2713a7d5a38ac045c0c021994dd80c331b9070c`;
collector image: `sha256:9a2784a69b1f145778ae1922639e5237a81f202a2ff25bef1e138fb23bb125e8`.
Слои образов одинаковы; отличается Compose service label. Linux image прошёл
785/785 unit и 10/10 PostgreSQL acceptance в отдельной internal Docker-сети.
Тестовая БД и сеть удалены; локальная PostgreSQL остановлена.

Сеня найден по паре UUID/числовой Telegram ID. Операция очистки записана в
`job_tasks` под постоянным request ID; повтор этой операции не сбрасывает
более новые настройки. Revision поиска изменился с 3 на 4: запросы и исключения
пустые, зарплата null, город пустой, формат null, поиск выключен и на паузе.
Checkpoint, progress и lease очищены; старые подтверждения фильтров и ввод
аннулированы. Ожидающих карточек было 0. Сверка в той же транзакции подтвердила:
настройки и revisions остальных пользователей не менялись. После запуска новой
версии это состояние и отрисовка панели ещё раз проверены чтением из рабочей БД.

Обновлены только server и collector DE. Оба running, server healthy, restarts 0.
По 330 файлов server/shared в каждом контейнере совпадают с принятой версией.
Browser с исправленной капчей, PostgreSQL, OCR, ASR и tunnel сохранили container IDs.
Окружение и volumes сохранены, bind-secret сохранил inode. Source guards DE/NL
прошли. HTTPS live/ready, Mini App и вход HH — 200; анонимный me — ожидаемый 401.
Host Agent и VPN-службы DE/NL активны и не менялись. Desktop 1.0.2 совпадает по
146 файлам, native Electron и bundled Node; пересборка EXE не нужна.
Незавершённая Operations UI и исходный diff её документов сохранены. Общий
inventory предупреждает только об этой активной локальной работе.
Настоящий ввод новых фильтров человеком в Telegram остаётся для приёмки.
Приватные подтверждения: `/home/deploy/maintenance/empty-job-filters-20261021`.

## English

At the owner's request, new job-search profiles start with empty queries and
exclusions, no salary or city preference, and no work-format restriction.
Implicit AI-only and sales-exclusion rules were removed. Other users' saved
settings are not reset automatically.

In Telegram, open “Job search → Settings → Search queries → Add”. Send multiple
phrases in one message, with one phrase per line, as in the example above.
Each line is a separate HH search. Blank lines are skipped and exact duplicates
are omitted. Queries allow up to 100 phrases of 2–200 characters; exclusions
allow up to 50 phrases of 1–100 characters. An invalid line or an overfull list
saves nothing and leaves input available for correction. The bot previews the
entire addition before one confirmation. Lists can be cleared and individual
restrictions removed. Removing the last query disables search. Empty queries
cannot activate or run collection; changed queries reset their checkpoint.
Polling interval, initial lookback and spending notification remain operational
settings, rather than prefilled job preferences.

Current jobs permission, private chat, numeric Telegram identity, revision,
expiry and single consumption remain enforced. No new callback syntax or guided
kinds were added. The targeted Senya reset requires both his UUID and Telegram
ID; facts, cover letters, resume and application history are retained. His old
queued vacancy cards are removed from pending delivery.

Local verification passed 785 server unit tests, 66 Telegram gate checks and
10 PostgreSQL acceptance tests. On PC, an Edge fixture using real Telegram
message/menu handlers and an isolated database passed multiline input, preview,
save, deduplication and clear. This is local verification, not a real Telegram
client tap-through. Independent permission review found no blockers; the
reported ability to save an active empty search was also closed in the
repository and legacy editor.

Published to GitHub `main` with owner authorization; Windows, DE and NL sources
are synchronized. Code and runtime release: `87b6cf33fceea3c676ec5276888169a8a59c2247`,
`/home/deploy/releases/jarvis-87b6cf3-empty-job-filters`.
Server image: `sha256:e6d54401e9992173fe76dc8dd2713a7d5a38ac045c0c021994dd80c331b9070c`;
collector image: `sha256:9a2784a69b1f145778ae1922639e5237a81f202a2ff25bef1e138fb23bb125e8`.
Image layers are identical; their Compose service labels differ. The Linux
image passed 785/785 unit tests and 10/10 PostgreSQL acceptance tests on an
isolated internal Docker network. Test database and network were removed;
the local PostgreSQL instance was stopped.

Senya was identified by both internal UUID and numeric Telegram ID. The reset
is recorded in `job_tasks` under a stable request ID; repeating that operation
does not reset newer settings. Search revision changed from 3 to 4: queries and
exclusions are empty, salary and format are null, city is empty, search is
disabled and paused. Checkpoint, progress and lease were cleared; old filter
confirmations and input were invalidated. There were zero queued cards. The
same transaction verified that other users' settings and revisions did not
change. A read from the production database after startup confirmed this
state and successful settings-panel rendering again.

Only DE server and collector were replaced. Both run, server is healthy, and
both have zero restarts. All 330 server/shared files in each container match
the accepted version. Browser with its CAPTCHA repair, PostgreSQL, OCR, ASR
and tunnel retained their container IDs. Environment and volumes were
preserved; the bind-mounted secret retained its inode. DE/NL source guards
passed. Public HTTPS live/ready, Mini App and HH entry returned 200; anonymous
me returned the expected 401. Host Agent and VPN services on DE/NL remain
active and unchanged. Desktop 1.0.2 matches all 146 files, native Electron and
bundled Node; no EXE rebuild is required. Unfinished Operations UI work and
its original documentation diff were preserved. The general inventory warns
only about this active local work. Real user input in Telegram remains a
client acceptance check. Private evidence:
`/home/deploy/maintenance/empty-job-filters-20261021`.
