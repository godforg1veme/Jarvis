# HH: состояния и восстановление / HH states and recovery

[Русский](#русский) | [English](#english)

## Русский

### Статус

Более новый результат: [выпуск и десятиминутная проверка](2026-11-04-hh-autonomy-recovery-release.md).
Ниже сохранён результат разработки до выпуска.

Локальная разработка в `codex/hh-autonomy-recovery`, от `b5056d0`.
Новый код не опубликован и не установлен на VPS. Production-настройки,
личные переключатели и исходные операции при разработке не менялись;
новых реальных откликов не отправлялось.

### Что исправлено

- Обычный отклик проверяется через bounded GET
  `https://chatik.hh.ru/chatik/api/chat_data?chatId=...`.
  Читатель связывает topic/chat/vacancy, выбранное резюме, текущего участника
  и единственное сообщение отклика с точным письмом. Вне frame возвращается
  только boolean. Размер ограничен до буферизации JSON; WebSocket и POST
  остаются запрещены при чтении. Прежняя DOM-проверка сохранена как fallback.
- Ошибка подготовки до попытки durable claim получает известный отказ
  `JOB_HH_PREPARATION_FAILED`. Ошибка самого claim остаётся unknown:
  запись могла успеть сохраниться до исключения.
- Для квитанции сохранены закрытые причины timeout/HTTP/format/schema/read.
  Неизвестная квитанция не превращается в успех и не разрешает повтор.
- Миграция 058 сохраняет исходные conversation/chat/connection revision,
  этап отказа и метаданные читающей сверки. Сверка ограничена шестью попытками
  с паузами, эксклюзивным lease и token. Она не вызывает submit или модель,
  проверяет текущие права и подключение, может завершить исходный результат
  после личного off, не включая автоматику. Перед commit результата права
  и подключение повторно проверяются под транзакцией.
- Старый scope восстанавливается только из точной consent revision либо
  однозначной сохранённой private attention delivery с проверкой identity.
  Неоднозначные записи не получают вымышленный origin.
- Старый failed model task с закрытым validation marker без draft/application
  переводится в известный manual_required. Неизвестные отправки и неизвестные
  модельные вызовы не переименовываются и не повторяются.
- JSON-схема письма содержит те же ограничения text/factIds, что локальный
  парсер. Записываются закрытые reason/field. Для автописьма разрешена одна
  дополнительная генерация после полученного невалидного ответа: checkpoint
  сохраняется до вызова, usage имеет отдельный детерминированный ID. Оба
  запроса учитываются в расходах. Неизвестный ответ не повторяется; replay
  исходной задачи не запускает третий вызов.
- Два невалидных письма требуют проверки текста до HH. Личный off и смена
  revision до отправки не объявляются отказом HH. Уведомления различают
  модель и доставку; после шести неуспешных чтений требуется ручная проверка.
  Несуществующий автоматический `confirm:null` не генерируется.

### Реальная читающая проверка

На временной копии сессии владельца новый читатель подтвердил точный текст
уже существующего отклика на вакансию 138548473: один связанный кандидат,
точное совпадение письма, результат true. Все изменяющие запросы блокировались,
WebSocket не разрешались, временные профили удалены. Исходный ledger и
server application при пробе не менялись. Это доказывает чтение существующего
обычного отклика; не является новой отправкой или приёмкой каждого аккаунта.

### Проверки

Серверный unit suite: 938 passed, 2 DB-only skipped, без ошибок.
Linux browser/Chromium: 131/131 без пропусков. Изолированные PostgreSQL/RPC/
Chromium: 32/32 без пропусков. После собственной проверки неизменности
подтверждённого ledger результата дополнительно прошли 3/3 Linux ledger tests.
Проверены конкурирующие claims, lease/token/cap, off/revocation во время чтения,
legacy origin, модельная repair с расходами и replay, обычный и native пути.

Один объединённый прогон оборвался после остановки временной БД: 26 прошли,
6 не завершились; этот результат не считался успешным. В повторной отдельной
БД увеличены test-only tmpfs/RAM, ограничен WAL и сохранён контейнер до
диагностики: 32/32, БД running, OOMKilled=false, restart count 0. Контейнер и
закрытая сеть удалены. Production БД и конфигурация не затрагивались. Точная
причина остановки первого auto-remove контейнера не сохранена.

Независимая ревизия полного diff выполнена после восстановления лимита.
Найденные разрывы между подтверждённым application и очередью исправлены:
сверка сохраняет оба статуса в одной транзакции; уже сохранённый терминальный
результат восстанавливает очередь даже после off или смены подключения.
Проверка исходного scope и operation ID сохраняется. Курсор проходит denied
scope без изменения их данных. Повторная ревизия новых дефектов не выявила.
Дополнительно прошли 8/8 PG recovery (включая откат при сбое записи),
13/13 applications/model и 12/12 automation; server unit повторно 938/2 skip.

На установленном старом browser image DE при читающей проверке отмечены
healthy, restart count 2 и запуск 4 ноября в 18:18:18 МСК. Причина рестартов
не установлена; новый локальный код к ним не относится и их устранение
не подтверждено. Это остаётся отдельной проверкой выпуска.

### Ограничения и выпуск

После неопределённой отправки анкеты обычное письмо не доказывает точные
ответы, поэтому такая операция остаётся unknown и не переотправляется.
Если письмо не попало в доступную ограниченную историю GET, доказательство
недостаточно. HH может изменить недокументированный формат; закрытые
диагностические причины и отрицательные tests сохраняют fail-closed поведение.

Для живой приёмки нужен отдельный согласованный выпуск server и job-browser
с миграцией 058. Перед миграцией остановить producers; затем установить
согласованные server/browser и проверить health и исходные операции без повторов.
Исходники обоих VPS должны быть синхронизированы; Desktop
runtime не менялся и не использует изменённый shared-модуль. Новую реальную
отправку и owner/member следует проверить отдельно в их личных scope.

## English

### Status

Newer result: [rollout and ten-minute observation](2026-11-04-hh-autonomy-recovery-release.md).
The development result below is preserved as the pre-rollout record.

Local development on `codex/hh-autonomy-recovery`, based on `b5056d0`.
The new code is neither published nor installed on either VPS. Production
settings, personal switches and original operations were preserved; development
sent no new real applications.

### Changes

- Ordinary applications can be verified through a bounded GET to
  `https://chatik.hh.ru/chatik/api/chat_data?chatId=...`. Verification binds the
  topic/chat/vacancy, selected resume, current participant and one application
  message to the exact letter. Only a boolean leaves the frame. Size is bounded
  before JSON buffering; WebSocket and POST remain blocked during reading.
  The previous DOM check remains as a fallback.
- Preparation failure before attempting a durable claim receives known
  `JOB_HH_PREPARATION_FAILED`. A claim-write exception remains unknown because
  the write may have succeeded before throwing.
- Receipt diagnostics retain closed timeout/HTTP/format/schema/read codes.
  An uncertain receipt cannot establish success or authorize another send.
- Migration 058 persists original conversation/chat/connection revision,
  failure phase and read-reconciliation metadata. Verification has a six-read
  cap, backoff and an exclusive lease/token. It never submits or invokes a
  model, checks current access/connection and can resolve an original result
  after personal off without enabling automation. Access and connection are
  checked again transactionally before committing a result.
- Legacy origin is restored only from exact consent revision or an unambiguous
  saved private attention delivery with identity checks. Ambiguous origins
  are not fabricated.
- A legacy failed model task with a closed validation marker and no draft or
  application becomes known manual_required. Uncertain sends and model calls
  are neither relabelled as known results nor retried.
- The provider letter schema carries the local text/factIds limits. Closed
  reason/field diagnostics are retained. An automatic letter gets at most one
  additional generation after a conclusively received invalid reply, with a
  checkpoint before invocation and a distinct deterministic usage ID. Both
  calls are billed separately. Unknown calls are not retried; task replay
  cannot trigger a third invocation.
- Two invalid replies require text review before HH. Personal off or revision
  change before sending is not reported as an HH rejection. Notices distinguish
  model processing from delivery, and six unproven reads require manual review.
  An invalid automatic `confirm:null` callback is no longer generated.

### Live read-only check

On a temporary copy of the owner's session, the new reader verified the exact
letter of the existing application to vacancy 138548473: one bound candidate,
exact text match, result true. All mutating requests were blocked, WebSocket
was disabled and temporary profiles were removed. The original ledger and
server application were unchanged. This verifies reading an existing ordinary
application, not a new submission or every account's live acceptance.

### Verification

Server unit suite: 938 passed, 2 DB-only skipped, no failures. Linux browser/
Chromium passed 131/131 without skips; isolated PostgreSQL/RPC/Chromium passed
32/32 without skips. After the primary agent checked confirmed ledger result
immutability, an additional 3/3 Linux ledger tests passed. Coverage includes
competing claims, lease/token/cap, off/revocation during reading, legacy origins,
repair billing/replay and ordinary/native submission paths.

One combined run lost its disposable database: 26 passed and 6 did not finish;
it was not counted as successful. A separate rerun increased test-only tmpfs/RAM,
bounded WAL and retained the container for diagnostics: 32/32, database running,
OOMKilled=false, restart count 0. The container and internal network were
removed. Production database/configuration were untouched. The exact cause of
the first auto-removed container's termination was not retained.

Independent full-diff review completed after the usage limit reset. Reported
gaps between a confirmed application and its queue item were fixed: reconciliation
commits both statuses in one transaction; an existing terminal result heals the
queue even after personal off or a connection change. Original scope and operation
ID checks remain. A cursor passes denied scopes without modifying their data.
Follow-up review found no new confirmed defect. Additional PG checks passed:
8/8 recovery (including rollback on write failure), 13/13 applications/model and
12/12 automation. Server units reran with 938 passed and two DB-only skips.

Read-only inspection of the installed old DE browser image showed healthy,
restart count 2, started November 4 at 18:18:18 MSK. The restart cause is unknown;
the new local code did not cause it and has not been shown to fix it. This remains
a separate rollout check.

### Limits and rollout

An ordinary letter cannot prove exact questionnaire answers after an uncertain
submission, so that operation remains unknown and is not resent. A letter
outside the bounded available GET history cannot establish proof. HH can
change this undocumented format; closed diagnostics and negative tests retain
fail-closed behavior.

Live acceptance needs a separately authorized server/job-browser rollout with
migration 058. Stop producers before migration, then install matching server/
browser versions and verify health and original operations without resending.
Both VPS source checkouts must be synchronized. Desktop runtime is
unchanged and does not import the modified shared module. A new live send and
owner/member acceptance must be checked separately in their personal scopes.
