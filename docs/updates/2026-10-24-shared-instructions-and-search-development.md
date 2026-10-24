# Общие инструкции моделей, Tavily MCP и сопроводительные

[Русский](#русский) | [English](#english)

## Русский

Реализовано локально 24 октября 2026 года в ветке `codex/shared-prompt-design`.
GitHub, оба VPS и установленный Desktop этой задачей не обновлялись.
Основа: [принятая спецификация](../superpowers/specs/2026-10-24-shared-model-instructions-design.md).

### Изменения

Общий чат и подготовка сопроводительных получают одинаковое ядро правил.
Тексты находятся в `server/src/prompts/instructions/`: `core.ru.md`,
`cover-letter.ru.md` и `web-search.ru.md`. Загрузчик читает ограниченные файлы
UTF-8 при запуске; после правки нужен перезапуск сервера. Язык письма и строгий
JSON имеют приоритет над обычным стилем общения. Служебные модели и действующие
границы доступа, инструментов и подтверждений сохранены.

Сопроводительное строится вокруг сильных сторон и конкретного опыта кандидата.
Промпт разрешает полную переработку исходника под задачи вакансии, запрещает
выдуманные достижения, оправдания нехваткой опыта, необоснованный род и пустые
подписи. Текущие явные сведения пользователя принимаются для запроса; они не
переносятся автоматически в постоянный профиль. Примеры стиля не становятся
свидетельством опыта. Нового AI-проверяющего и повторов по оценке качества нет.

При подключённом HH сервер читает ограниченные разделы выбранного личного
резюме через закрытый read-only RPC `resume_content`. Проверяются пользователь,
выбранный ID и revision; проверка выбора входит в транзакцию сохранения
черновика. Смена резюме во время чтения или генерации закрывает операцию.
Контакты не входят в snapshot. Без HH-подключения подготовка по исходному письму
и фактам остаётся доступной. Ошибка чтения уже выбранного резюме сохраняет
прежний черновик и не подменяется другим резюме.

У любого черновика появилась «Редактировать текст». Пользователь копирует
письмо и присылает исправленный вариант целиком. Текст сохраняется дословно,
включая внешние пробелы и переносы, без AI-вызова. Потребление guided input
и запись дочернего черновика выполняются в одной транзакции; прежние
подтверждения отправки становятся неактуальными. Миграция 046 добавляет
`job_draft_manual_edit` в PostgreSQL CHECK. Отправка работодателю по-прежнему
требует отдельного подтверждения. Основной UI-контракт:
[Telegram](../telegram-menu-contract.md#job-search-letter-modes-and-send-confirmation).

Подключён официальный SDK MCP 1.32.2 и клиент удалённого Tavily MCP. Разрешён
только basic-поиск с пятью результатами. Ключ передаётся заголовком, endpoint
фиксирован, ответ ограничен 256 KiB до разбора, MCP-операция имеет общий срок
15 секунд и закрывает фоновые потоки SDK. Поиск выполняется сервером один раз
перед ответом и не требует tool calling от каждой модели OpenRouter. Источники
поступают как недоверенные данные; текущие права проверяются до и после поиска.

Планировщик поиска видит только текущий запрос. История, память, документы
и резюме ему не передаются. Короткая поисковая строка ограничена словами
исходного запроса и закрытым набором нейтральных дополнений. Очевидные ключи,
контакты и известные маркеры личных материалов блокируются; ссылки с параметрами
токенов/сессий отбрасываются. Это ограничение выхода данных, а не универсальное
определение всех личных сведений в свободном тексте.

Все пользователи расходуют общую бесплатную квоту Tavily без личных лимитов.
Код не включает платный поиск или резервного поискового провайдера. PAYGO
и автоплатежи должны оставаться выключенными в аккаунте Tavily: программа
не может отменить настройки оплаты, включённые вне Jarvis. Ошибка или квота
дают безопасное сообщение о неподтверждённой актуальности. Настройки и способ
проверки: [deploy](../../deploy/README.md#tavily-mcp-search),
[runtime](../runtime-context.md#shared-instructions-and-tavily-mcp),
[verification](../verification.md#shared-instructions-and-tavily-mcp).

### Проверки и ограничения

- Полный server suite: 846/846, без ошибок и пропусков, с изолированной PostgreSQL.
- Контекст резюме и PostgreSQL acceptance через настоящие message/menu handlers:
  12/12, без пропусков. Проверены scoped input, неверный ввод, expiry, повтор,
  дословное сохранение, отсутствие AI-вызова, выбор резюме и stale confirmation.
- Регрессионные сценарии отправки на PostgreSQL: 6/6. Исправлен только setup
  прежней тестовой фикстуры: identity и актуальная access policy передаются
  во все сервисы; проверки результата и production-права не ослаблялись.
- Полный Windows browser suite: 93 прошли, 10 прежних платформенных пропусков,
  ошибок нет. В него входят 2/2 новых теста резюме с настоящим локальным Edge.
- Реальный MCP SDK проверен с локальными сетевыми ответами: успешный ответ,
  ограничение потока, отмена, закрытие SSE, отсутствие повтора tools/call.
  Независимая проверка также проверила отказ 401/redirect и срок зависшего запроса.
- `git diff --check` прошёл. Установка SDK сохранила три прежних high findings
  npm audit из исходного набора зависимостей; автоматическое обновление
  посторонних пакетов не выполнялось.

Ключ Tavily сохранён в игнорируемом локальном файле; сервис подтвердил план
Researcher с лимитом 1 000 кредитов. Прямой запрос из Windows получает HTTP 403
до MCP-ответа. Через сеть DE VPS клиент `TavilyMcpClient` с настоящим SDK
прошёл initialize, tools/list и tools/call: `ok`, пять источников, 7 033 мс.
Только диагностический fetch был направлен через SSH; для его дополнительных
соединений использовался срок 45 секунд, рабочий срок 15 секунд не менялся.
Ключ передавался через stdin без записи на VPS; production-файлы и настройки
не менялись. Причина различия сетевых ответов не установлена.

Прочитаны [официальная инструкция настройки Tavily](https://tavily.com/agent-setup/SKILL.md)
и `tavily-best-practices`. Применён путь интеграции в существующее приложение
через выбранный MCP; установка отдельного CLI или глобальных навыков не нужна.
Без ключа smoke-скрипт по-прежнему возвращает `key_required` без сети.
Живая проверка не подтверждает установку в работающий Jarvis. Значение
`paygo_limit` в usage API равно null, поэтому отключение PAYGO не подтверждено.
Выбранное резюме на настоящей HH, новый черновик на реальных моделях
и нажатия owner/member в Telegram пока не подтверждены.
Локальный reader fail-closed не доказывает поддержку всех
вариантов разметки HH. Подготовка релиза потребует обновить server и job-browser
на DE и применить миграцию; исходники обоих VPS синхронизируются в рамках
порученного выпуска. Desktop не менялся и пересборки не требует.

## English

Implemented locally on October 24, 2026, on `codex/shared-prompt-design`.
This task has not updated GitHub, either VPS or the installed Desktop.
The [accepted specification](../superpowers/specs/2026-10-24-shared-model-instructions-design.md)
records the decisions.

### Changes

General chat and cover-letter generation receive the same core rules.
The text files live in `server/src/prompts/instructions/`: `core.ru.md`,
`cover-letter.ru.md` and `web-search.ru.md`. The loader reads bounded UTF-8 files
at startup; edits require a server restart. Letter language and strict JSON
take precedence over conversational style. Service models and existing access,
tool and confirmation boundaries remain in force.

Cover letters focus on the applicant's strengths and specific experience.
The prompt allows rewriting the source around the vacancy's tasks while
forbidding invented achievements, apologies for missing experience, unsupported
grammatical gender and empty signatures. Current explicit user facts apply to
the request only and do not automatically update a permanent profile. Style
examples are not evidence of experience. No new AI quality judge or
quality-triggered retry is enabled.

For connected HH accounts, a closed read-only `resume_content` RPC reads
bounded sections of the selected personal resume. User, selected ID and
revision are checked, including selection validation inside the draft-save
transaction. Selection changes during reading or generation stop the operation.
Contact data is excluded from the snapshot. Without an HH connection, supplied
letters and facts can still be used. Failure to read a selected connected
resume preserves the previous draft rather than substituting another resume.

Every draft has a direct text-edit control. The user copies the letter and
sends the entire replacement. Saving preserves every character, including
outer whitespace and newlines, without calling AI. Guided-input consumption
and child-draft insertion share a transaction; previous send confirmations
become stale. Migration 046 adds `job_draft_manual_edit` to the PostgreSQL
CHECK. Sending still requires a separate confirmation. The
[Telegram contract](../telegram-menu-contract.md#job-search-letter-modes-and-send-confirmation)
owns the visible behavior.

The official MCP SDK 1.32.2 and a remote Tavily MCP client are integrated.
Only basic search with five results is callable. The key is sent in a header,
the endpoint is fixed, responses are capped at 256 KiB before parsing, and a
15-second deadline covers the MCP operation and closes SDK background streams.
Server-side search runs once before answering and does not require tool calling
from every OpenRouter model. Sources are untrusted context data; current access
is checked before and after search.

The search planner sees only the current request, never stored history,
memory, documents or resume. Short search queries are restricted to request
words and a closed set of neutral additions. Obvious credentials, contact data
and known private-material markers are blocked; source URLs carrying token or
session parameters are discarded. This controls outbound data but does not
universally identify personal information in arbitrary prose.

All users share the free Tavily quota without personal limits. The code does
not enable paid search or an alternate search provider. PAYGO and automatic
payments must remain disabled in the Tavily account; Jarvis cannot override
billing settings changed elsewhere. Errors or quota exhaustion produce a safe
unverified-freshness notice. Configuration and verification are documented in
[deploy](../../deploy/README.md#tavily-mcp-search),
[runtime](../runtime-context.md#shared-instructions-and-tavily-mcp) and
[verification](../verification.md#shared-instructions-and-tavily-mcp).

### Verification and limits

- Full server suite: 846/846, no failures or skips, using isolated PostgreSQL.
- Resume context and PostgreSQL acceptance through actual message/menu handlers:
  12/12, no skips. Coverage includes scoped input, invalid retry, expiry, replay,
  exact text preservation, no AI call, selected resume and stale confirmation.
- PostgreSQL submission regressions: 6/6. Only the existing test fixture setup
  changed to supply identity and current access policy to all services;
  assertions and production authorization were not weakened.
- Full Windows browser suite: 93 passed, 10 existing platform skips, no failures.
  It includes both new resume tests with a real local Edge instance.
- The real MCP SDK was tested with local network fixtures for success, streaming
  limits, cancellation, SSE cleanup and a single tools/call. Independent review
  also checked 401/redirect rejection and a stalled request deadline.
- `git diff --check` passed. SDK installation retained three pre-existing high
  npm audit findings; unrelated packages were not automatically upgraded.

The Tavily key is stored in an ignored local file; the service confirmed the
Researcher plan with a 1,000-credit limit. Direct Windows requests receive
HTTP 403 before an MCP response. Through the DE VPS network, `TavilyMcpClient`
and the real SDK completed initialize, tools/list and tools/call: `ok`, five
sources, 7,033 ms. Only the diagnostic fetch was routed through SSH; its extra
connections used a 45-second deadline, leaving the production 15-second
deadline unchanged. The key traveled over stdin without being written on
the VPS; production files and settings were not changed. The reason for the
different network responses has not been established.

The [official Tavily setup instructions](https://tavily.com/agent-setup/SKILL.md)
and `tavily-best-practices` were read. The existing-application path was applied
through the selected MCP integration; a separate CLI or global skills install
is unnecessary. Without a key, the smoke script still returns `key_required`
without network access. The live check does not verify deployment in the
running Jarvis. The usage API reports null for `paygo_limit`, so disabled
PAYGO has not been confirmed. The selected resume on actual HH, new letters
from real models and owner/member Telegram taps remain unverified.
A fail-closed local reader does not prove support for every HH
markup variant. A future approved release needs updated server and job-browser
components on DE and the migration; both VPS source checkouts are synchronized
as part of that release. Desktop is unchanged and needs no rebuild.
