# Общие инструкции, Tavily MCP и редактирование сопроводительных: выпуск

[Русский](#русский) | [English](#english)

## Русский

24 октября 2026 года по поручению владельца изменения опубликованы в GitHub
`main`, исходники Windows и обоих VPS обновлены. На DE установлены server
и job-browser из immutable release
`f65dac53ce45514ee34bfef834f191900b92c7fe`.
Образы: `jarvis-shared:f65dac5` и `jarvis-hh-browser:f65dac5`.
Последующая запись результата и ремонт проверочного скрипта не меняют runtime
или входные файлы сборки и не требуют пересборки этих образов.

### Что доступно

Общий чат и подготовка сопроводительных получают единое ядро инструкций
из `server/src/prompts/instructions/`, дополненное правилами конкретной задачи.
Изменение этих файлов требует перезапуска сервера. Для письма инструкции
требуют использовать подтверждённые сильные стороны кандидата, свободно
перерабатывать исходник под вакансию и избегать выдуманных достижений,
оправданий нехваткой опыта и необоснованного грамматического рода.
Текущие явные сведения пользователя применяются к запросу без автоматической
записи в постоянный профиль. AI-проверяющий качества не добавлен.

При подключённом HH сервер запрашивает ограниченный snapshot выбранного
личного резюме. Проверки владельца, выбранного ID и revision сохраняются
до транзакции записи черновика; контакты исключены. Кнопка «Редактировать текст»
принимает исправленное письмо целиком и сохраняет его дословно без AI-вызова.
Прежнее подтверждение отправки становится неактуальным. Работодателю письмо
отправляется только после отдельного подтверждения точного текста.
Основной источник поведения: [Telegram-контракт](../telegram-menu-contract.md#job-search-letter-modes-and-send-confirmation).

Tavily MCP включён в приватном окружении DE server. Поиск выполняется сервером
и не требует поддержки tool calling от каждой модели OpenRouter. Разрешён
только basic-поиск с пятью результатами и общим сроком 15 секунд. История,
память, документы и резюме не передаются планировщику поиска. Источники
поступают как недоверенные данные; права проверяются до и после поиска.
Резюме не отправляется в Tavily. Настройки:
[deploy](../../deploy/README.md#tavily-mcp-search),
[runtime](../runtime-context.md#shared-instructions-and-tavily-mcp).

### Установка и проверки

| Проверка | Фактический результат |
| --- | --- |
| GitHub / Windows / DE / NL source | Чистая принятая `main`; оба VPS синхронизированы |
| DE server | `healthy`, без рестартов после запуска; 353 исходных файла и package-файла совпадают |
| DE job-browser | `healthy`, без рестартов после запуска; 50 исходных и package-файлов совпадают, профиль HH сохранён |
| Остальные службы DE | Пять контейнеров сохранили ID; collector, PostgreSQL, OCR, ASR и tunnel не пересоздавались |
| Окружение | Server меняет только три настройки Tavily; окружение браузера сохранено; значения секретов не выводились |
| Данные и секреты | Volumes сохранены; копия подключаемого секрета совпадает, права 0600; исходный файл и его inode сохранены |
| Миграция | `046_job_manual_draft_edit.sql` применена при старте; CHECK разрешает новый kind; всего 48 записей миграций |
| Server в новом образе | 844 прошли, ошибок нет; два PostgreSQL-сценария отдельно проверены с БД |
| Browser в новом Linux-образе | 103/103, без пропусков |
| Изолированная PostgreSQL | 16/16: контекст резюме, настоящие message/menu handlers, ручная правка, scoped input, stale confirmation и регрессии отправки |
| Проверочный скрипт выпуска | 17/17 на Linux, включая выход через symlink; на Windows 16 прошли и один symlink-тест пропущен из-за прав ОС |
| Живой Tavily в установленном server | `ok`, пять источников, 1 148 мс; стандартный срок 15 секунд |
| HTTPS | `/health/live` и `/health/ready`: smoke прошёл |
| NL / Host Agent | Исходники обновлены; установленные модули Host Agent совпадают на обоих VPS, службы активны |
| Desktop | Установленная 1.0.2 совпадает: 146 файлов, native Electron и bundled runtime; EXE не менялся |

Тестовые контейнеры не получали production environment или volumes. Для
PostgreSQL использовался отдельный контейнер без сети хоста, с временными
данными; он остановлен и удалён. При итоговой сверке выявлен и исправлен
учёт вложенных приватных Compose overlays: каждый существующий файл должен
оставаться внутри каталога deploy своего релиза; выход через пути или symlinks
отклоняется. Все overlays продолжают участвовать в сравнении входных файлов.

### Что ещё не подтверждено

Аккаунт Tavily имеет план Researcher с лимитом 1 000 кредитов. Общая квота
используется всеми пользователями без личных лимитов. Jarvis не включает
платный резерв поиска. Usage API возвращает `paygo_limit: null`, поэтому
отключение PAYGO и автоплатежей этим выпуском не подтверждено; их настройки
остаются в аккаунте Tavily. Прямой Windows-доступ возвращал HTTP 403,
но поиск из установленного server на DE прошёл.

Реальное выбранное резюме на HH, новое письмо от реальных моделей,
owner/member нажатия в Telegram и ручное редактирование на телефоне остаются
для пользовательской приёмки. Локальные browser fixtures не доказывают
поддержку всех вариантов HH-разметки. Настоящий отклик работодателю при
проверках этого выпуска не отправлялся.

История решений и локальных проверок:
[этап разработки](2026-10-24-shared-instructions-and-search-development.md).

## English

On October 24, 2026, the owner authorized publishing the changes to GitHub
`main` and updating the Windows and both VPS source checkouts. DE server
and job-browser were installed from immutable release
`f65dac53ce45514ee34bfef834f191900b92c7fe`.
Images: `jarvis-shared:f65dac5` and `jarvis-hh-browser:f65dac5`.
The subsequent result record and verification-script repair do not change
runtime or build inputs and do not require rebuilding these images.

### Available behavior

General chat and cover-letter generation share core instructions from
`server/src/prompts/instructions/`, combined with task-specific rules.
Editing these files requires a server restart. Letter instructions require
supported applicant strengths, allow rewriting the source around the vacancy,
and forbid invented achievements, apologies for missing experience and
unsupported grammatical gender. Current explicit user facts apply to the
request without automatically updating a permanent profile. No AI quality
judge was added.

For connected HH accounts, the server requests a bounded snapshot of the
selected personal resume. Owner, selected ID and revision checks continue
through the draft-save transaction; contact data is excluded. Direct text
editing accepts an entire replacement and preserves it exactly without an
AI call. Previous send confirmation becomes stale. Sending to an employer
requires separate approval of the exact text. The
[Telegram contract](../telegram-menu-contract.md#job-search-letter-modes-and-send-confirmation)
owns the behavior.

Tavily MCP is enabled in the private DE server environment. Server-side search
does not depend on tool-calling support in every OpenRouter model. Only basic
search with five results and a total 15-second deadline is enabled. Stored
history, memory, documents and resumes are not sent to the search planner.
Sources are untrusted data; access is checked before and after search.
Resumes are not sent to Tavily. Configuration:
[deploy](../../deploy/README.md#tavily-mcp-search),
[runtime](../runtime-context.md#shared-instructions-and-tavily-mcp).

### Installation and verification

| Check | Actual result |
| --- | --- |
| GitHub / Windows / DE / NL source | Clean accepted `main`; both VPS checkouts synchronized |
| DE server | Healthy, no restarts after startup; 353 source and package files match |
| DE job-browser | Healthy, no restarts after startup; 50 source and package files match, HH profile preserved |
| Other DE services | Five containers retained their IDs; collector, PostgreSQL, OCR, ASR and tunnel were not recreated |
| Environment | Server changes only three Tavily settings; browser environment preserved; secret values were not displayed |
| Data and secrets | Volumes preserved; copied mounted secret matches with mode 0600; original file and inode preserved |
| Migration | `046_job_manual_draft_edit.sql` applied at startup; CHECK allows the new kind; 48 migration records in total |
| Server in the new image | 844 passed, no failures; both PostgreSQL scenarios were verified separately with a database |
| Browser in the new Linux image | 103/103, no skips |
| Isolated PostgreSQL | 16/16: resume context, actual message/menu handlers, manual edits, scoped input, stale confirmation and submission regressions |
| Release-verification script | 17/17 on Linux, including symlink escapes; Windows passed 16 with one symlink test skipped due to OS permissions |
| Live Tavily in installed server | `ok`, five sources, 1,148 ms; standard 15-second deadline |
| HTTPS | `/health/live` and `/health/ready` smoke passed |
| NL / Host Agent | Sources updated; installed Host Agent modules match on both VPS nodes, services active |
| Desktop | Installed 1.0.2 matches: 146 files, native Electron and bundled runtime; EXE unchanged |

Test containers received no production environment or volumes. PostgreSQL
used a separate container without host networking and with temporary data;
it was stopped and removed. Final inventory exposed and fixed handling of
nested private Compose overlays: every existing file must stay within its
release's deploy directory; path or symlink escapes are rejected. All overlays
remain included in build-input comparison.

### Remaining checks

The Tavily account is on the Researcher plan with a 1,000-credit limit. All
users share its quota without personal limits. Jarvis enables no paid search
fallback. The usage API returns `paygo_limit: null`, so this release does not
confirm disabled PAYGO or automatic payments; these remain Tavily account
settings. Direct Windows access returned HTTP 403, while search from the
installed DE server succeeded.

The actual selected HH resume, new letters from real models, owner/member
Telegram taps and manual editing on a phone remain for user acceptance.
Local browser fixtures do not prove support for every HH markup variant.
No real employer application was submitted during these release checks.

Decision and local-verification history:
[development stage](2026-10-24-shared-instructions-and-search-development.md).
