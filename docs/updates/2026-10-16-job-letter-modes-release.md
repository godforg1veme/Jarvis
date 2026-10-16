# Четыре варианта сопроводительного установлены / Four cover-letter modes deployed

[Русский](#русский) | [English](#english)

## Русский

16 октября 2026. По поручению владельца код опубликован в GitHub `main`:
`2e1da534e80366d6644a225f5b3f5ac0b526ec7e`. Windows и оба VPS получили эту версию.
На DE установлен отдельный server release
`/home/deploy/releases/jarvis-2e1da53-job-letter-modes` с тем же SHA.
Последующая запись результатов меняет только документы и не требует пересборки.

В меню «Поиск работы» доступен редактор базового сопроводительного. Подготовка
отклика предлагает базовое без AI, улучшенное из базового, кастомное без AI и
кастомное с AI. Факты и примеры необязательны, оба AI-варианта получают их при
наличии. Кастомное письмо не заменяет общее базовое. Перед отправкой в HH
сохраняется отдельное подтверждение итогового текста. Подробности:
[сценарий](../superpowers/specs/2026-10-16-job-letter-modes-design.md) и
[контракт меню](../telegram-menu-contract.md).

### Проверено

- Аудит GitHub, веток и worktrees: принятая работа объединена fast-forward,
  опубликована без force; завершённая task branch удалена после проверки включения,
  отсутствия PR и отдельного worktree. Windows, DE и NL source guards прошли.
- Release guard подтвердил полный SHA и достижимость из GitHub `main`.
  Preflight и CAPTCHA Compose policy прошли.
- Для нового релиза сохранено действующее окружение предыдущего server release:
  исходный `deploy/.env` отличается от используемого runtime. Секретные значения
  не выводились; окружение всех семи контейнеров после установки совпало с прежним.
  Secret bind mount сохранил inode и права, `.env` скопирован побайтно с mode0600.
- В собранном Linux server image: 646/646 unit tests, 17/17 job PostgreSQL
  acceptance, 1/1 bot/HTTP/PG E2E и 1/1 full-runtime acceptance с pgvector.
  Последняя проверка применила все 36 файлов миграций и повторный запуск migrations.
  Базы были временными, без публичных портов и production credentials; ответы
  модели, Telegram и HH подставные. Отдельный full-runtime запуск использовал
  localhost общей тестовой network namespace, как требует его защитная проверка.
- Ранее на Windows: 646/646 server, 65/65 Telegram gate, 17/17 PostgreSQL
  и 1/1 E2E. [Результат разработки](2026-10-16-job-letter-modes-development.md).
- На production migration 034 применена; PostgreSQL CHECK содержит три новых
  guided kind. Owner-scoped чтение и rendering работающего сервера подтвердили
  редактор и четыре варианта с валидными callbacks. Telegram-сообщения этой
  проверкой не отправлялись, взаимодействия владельца не имитировались.
- Server healthy, внутренний ready и публичные live/ready smoke прошли.
  Сверены 298 файлов server/shared и входные файлы release: совпадают с принятой версией.
- Настройки поиска и профиль владельца совпали с состоянием перед переключением;
  число черновиков и откликов не изменилось. Server restart count после установки — 0.
  PostgreSQL, browser, collector, OCR, ASR и ingress сохранили container IDs.
- Host Agent и VPN на обоих VPS активны, установленные модули совпадают с кодом.
  На NL обновлены исходники. Desktop 1.0.2 совпадает с принятой версией: 140 файлов,
  native Electron и bundled Node проверены; пересборка и установка не требовались.

### Остаётся проверить

Открыть заново «Поиск работы», сохранить базовое письмо и пройти реальные
нажатия четырёх вариантов. Один настоящий HH-отклик выполняется только на
выбранную владельцем вакансию после подтверждения точного текста в Telegram.
Этот выпуск не отправлял откликов и не вызывает модель для проверки на production.

## English

16 October 2026. At the owner's request, the code was published to GitHub `main`:
`2e1da534e80366d6644a225f5b3f5ac0b526ec7e`. Windows and both VPS source checkouts
received it. DE runs the separate server release
`/home/deploy/releases/jarvis-2e1da53-job-letter-modes` at the same SHA.
The subsequent results record changes documentation only and needs no rebuild.

The job menu includes a base-letter editor. Preparing an application offers
base without AI, AI-improved base, custom without AI and custom with AI.
Facts/examples are optional and included in both AI modes when available.
Custom letters never replace the shared base. Every HH submission still requires
a separate confirmation of the final text. See the specification and menu contract
linked above.

### Checks

- GitHub, branches and worktrees were audited. The work was fast-forwarded and
  pushed without force; the completed task branch was removed after checking
  inclusion and the absence of a PR or separate worktree. Windows, DE and NL source guards passed.
- The release guard confirmed the full SHA and reachability from GitHub `main`.
  Preflight and CAPTCHA Compose policy passed.
- The new release preserves the previous server release's active environment;
  the source checkout's `deploy/.env` differs from the runtime file. No secret values
  were displayed. All seven containers retained their environments after deployment.
  The secret bind mount retained its inode and permissions; `.env` was copied byte
  for byte with mode0600.
- The built Linux server image passed 646/646 unit tests, 17/17 job PostgreSQL
  acceptance tests, 1/1 bot/HTTP/PG E2E and 1/1 full-runtime acceptance with pgvector.
  The last test applied all 36 migration files and reran migration processing.
  Databases were temporary, without host ports or production credentials;
  model, Telegram and HH responses were fixtures. The separate full-runtime test
  used localhost in a shared test network namespace as its safety guard requires.
- Earlier Windows checks passed 646/646 server tests, 65/65 Telegram regression
  tests, 17/17 PostgreSQL tests and 1/1 E2E. See the development result linked above.
- Production migration 034 is applied and the database CHECK includes all three
  new guided kinds. Owner-scoped reads and rendering on the running server confirmed
  the editor and four modes with valid callbacks. This check sent no Telegram messages
  and did not impersonate owner interactions.
- Server health, internal readiness and public live/ready smoke passed.
  Comparison covered 298 server/shared files and release build inputs, matching the accepted code.
- Owner search settings and profile matched the pre-switch state; draft/application
  counts did not change. The new server's restart count was 0. PostgreSQL, browser,
  collector, OCR, ASR and ingress retained their container IDs.
- Host Agent and VPN services on both VPS nodes are active and installed modules
  match source. NL received source updates. Desktop 1.0.2 matches the accepted code:
  140 files, native Electron and bundled Node were checked; no rebuild or installation was needed.

### Remaining acceptance

Reopen job search, save a base letter and try the four modes in the actual
Telegram client. A real HH application must target an owner-selected vacancy
after exact-text confirmation in Telegram. This release sent no applications
and made no production model call for verification.
