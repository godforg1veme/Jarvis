# Панель настроек установлена / Settings panel deployed

[Русский](#русский) | [English](#english)

## Русский

16 октября 2026. По поручению владельца панель настроек опубликована в GitHub
main и установлена на DE. Принятый release SHA:
`f004de8270bbd143636a39ac9b22468dae2392b4`, каталог
`/home/deploy/releases/jarvis-f004de8-job-settings`. Windows и оба VPS получили
исходники; последующая запись результатов меняет только документацию.

Открой заново «Поиск работы → Настройки»: девять параметров представлены
отдельными кнопками. Для чисел есть готовые значения и ввод своего, для удалёнки —
«Да/Нет», для моделей — текущие/настроенные модели, наследование и ввод ID.
Запросы и исключения открываются отдельными списками с добавлением и удалением.
Перед записью показано изменение и «Сохранить / Отмена». Порог уведомления
по-прежнему не останавливает расходы AI. Подробности:
[сценарий](../superpowers/specs/2026-10-16-job-settings-panel-design.md),
[контракт меню](../telegram-menu-contract.md).

Проверено:

- Git/worktrees/PR, source/release guards и preflight прошли. Task branches
  объединены fast-forward и удалены после проверки включения и отсутствия PR/worktrees.
- В Linux server image прошли 652/652 unit tests. На отдельной временной
  PostgreSQL с pgvector: 28/28 job acceptance, 1/1 HTTP/Bot/PG E2E и 1/1 full-runtime.
  Последняя проверка применила все 38 файлов миграций и повторила migrations.
  E2E обновлён на настоящую навигацию кнопками вместо прежних текстовых команд.
  Тесты не использовали production credentials и не отправляли запросы в живые HH,
  модель или Telegram. Ранее локально Telegram gate: 65/65.
- На рабочем server migration 036 применена, PostgreSQL CHECK допускает новый
  `job_setting_value`. Проверены owner-scoped чтение и rendering десяти экранов:
  главная панель и девять параметров; все callbacks валидны. Нажатия владельца
  не имитировались, подтверждения или guided input для проверки не создавались.
- Сверка 307 файлов server/shared, package и входных файлов сборки прошла.
  Server healthy, readiness/public smoke прошли; restart count — 0.
- Действующее окружение сохранено без вывода значений; secret bind mounts
  сохранили inode и права. Настройки, профиль, подключение HH и количества
  черновиков/отправок совпали с состоянием до переключения.
- Обновлён только server. Browser, collector, PostgreSQL, OCR, ASR и ingress
  сохранили container IDs. NL получил исходники; Host Agent/VPN на обоих VPS
  активны и совпадают с исходниками. Desktop 1.0.2 совпадает с принятым кодом,
  включая 140 файлов и native/bundled runtime; пересборка не требовалась.

Остаётся проверить реальные нажатия в Telegram: выбрать параметр, ввести своё
значение, подтвердить/отменить и добавить/удалить фразу. Выпуск сам не менял
настройки поиска и не отправлял HH-откликов, сообщений Telegram или запросов AI.

## English

16 October 2026. At the owner's request, the settings panel was published to
GitHub main and installed on DE. Accepted release SHA:
`f004de8270bbd143636a39ac9b22468dae2392b4`, directory
`/home/deploy/releases/jarvis-f004de8-job-settings`. Windows and both VPS source
checkouts received it; this subsequent results record changes documentation only.

Reopen Job search → Settings to see nine separate parameter buttons. Numeric
fields offer presets and custom values; remote vacancies use Yes/No; models
offer current/configured choices, inheritance and a custom ID. Queries and
exclusions have separate lists with addition/removal. Each write shows a change
preview and Save/Cancel. The notification threshold still does not stop AI
spending. See the design and menu contract linked above.

Checks:

- Git/worktree/PR inventory, source/release guards and preflight passed. Task
  branches were fast-forwarded and removed after checking inclusion and the
  absence of associated PRs or separate worktrees.
- Linux server image: 652/652 unit tests. Separate temporary pgvector PostgreSQL:
  28/28 job acceptance, 1/1 HTTP/Bot/PG E2E and 1/1 full-runtime, applying all 38
  migration files and rerunning migrations. E2E now follows actual button navigation
  rather than legacy text commands. Tests used no production credentials and sent
  no live HH, model or Telegram requests. Earlier local Telegram gate: 65/65.
- Production migration 036 is applied and the CHECK allows `job_setting_value`.
  Owner-scoped reads and ten rendered screens passed: the main panel and nine
  parameters, all with valid callbacks. No owner interaction was impersonated;
  verification created no confirmations or guided input.
- Comparison covered 307 server/shared and package files plus build inputs,
  matching accepted code. Server health, readiness and public smoke passed;
  restart count was 0.
- Active environment values were retained without disclosure. Secret bind mounts
  kept their inode and permissions. Settings, profile, HH connection and
  draft/application counts matched the pre-switch snapshot.
- Only server was replaced. Browser, collector, PostgreSQL, OCR, ASR and ingress
  retained container IDs. NL received source changes. Host Agent/VPN services on
  both nodes are active and match source. Desktop 1.0.2 matches accepted code,
  including 140 files and native/bundled runtimes; no rebuild was needed.

Remaining acceptance: real Telegram taps, a custom value, save/cancel and phrase
addition/removal. The rollout itself changed no search settings and sent no HH
applications, Telegram messages or AI requests.
