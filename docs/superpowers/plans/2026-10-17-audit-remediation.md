# Исправление подтверждённых находок аудита

**Goal:** исправить F01–F13 из аудита 16 октября, сохранить защитные границы и подтвердить результат регрессиями.

**Architecture:** небольшие независимые изменения; отдельный субагент на каждую находку. Одновременно не более трёх исполнителей. Один файл в каждый момент принадлежит одному исполнителю. Координатор проверяет diff, смежные контракты, общий результат и документацию. Общий рефакторинг и выпуск в эту работу не входят.

**Tech Stack:** CommonJS/Node.js, Electron IPC, Fastify, Python/SQLite, React/TypeScript, fixture browser tests.

**Spec:** `F:/test/jarvis-audit-2026-10-16/AUDIT.md`, разделы F01–F13 и предложенные там исправления; пользователь 17 октября поручил исправить задачи с субагентами по правилам проекта.

## Ограничения

- Исходная версия аудита `db2d7d5`; актуальная база работы `63c6392c2a2aa4720a915e0c64b3589a69bea50e`. Каждый исполнитель заново проверяет проблему на текущей базе.
- AGENTS.md и release-workflow обязательны. Ветки/worktrees/PR проверены: чистая main, без посторонней работы. Рабочая ветка `codex/audit-remediation`.
- Без push/PR, установки Desktop, изменения VPS, секретов и пользовательского состояния. Без новых production-зависимостей и отключения dependency scripts. `npmRebuild: false` сохраняется.
- Не менять Telegram menu/callback/guided-input/confirmation contract. Для внутреннего ремонта Telegram заранее прочитать оба контракта и дать notice. Изменение видимого контракта требует отдельного согласования.
- Сохранять owner, source channel/device, conversation/chat, revision, expiry, deduplication и unknown/original-ID reconciliation. Не проверять исправления настоящими изменяющими действиями.
- Пользователь подтвердил: сейчас только F01–F13. Архитектурные A01–A07 и dependency D01 исключены; транзакционный outbox, общая реструктуризация и новый dependency runtime в работу не входят.

## Правило работы каждой задачи

1. Перечитать находку и актуальные исходники/тесты; не полагаться на старые номера строк.
2. Добавить регрессию, действительно воспроизводящую нарушение. Запустить её до исправления и записать ожидаемый отказ.
3. Внести минимальное исправление без изменения чужих файлов и внешнего контракта.
4. Запустить регрессию и профильные существующие проверки.
5. Передать координатору файлы, команды/результаты, ограничения и риски. Не делать commit/push и не переключать ветку в общей рабочей копии.
6. Координатор независимо проверяет diff и результат; только затем снимает блокировку зависимых задач.

## Очередь и владение файлами

| ID | Результат | Основные файлы | Проверка и зависимости |
| --- | --- | --- | --- |
| F01 | Вспомогательные renderers не имеют универсального доступа к инструментам и подтверждению | main.js, preload.js, минимальный preload/IPC module при необходимости, отдельный script test | VM/IPC regression на чужое окно/frame, произвольный shell и forged confirmation; Gateway и media permission tests. Не менять cloud-chat renderer |
| F02 | Каждая кнопка подтверждает/отклоняет конкретный command ID | renderer/cloud-chat/renderer.js, cloud/cloudChatRenderer.test.js | Две карточки с разными IDs, stale/replay, отказ API; после освобождения renderer.js |
| F03 | Подписочный секрет не попадает в Fastify access/error logs | server/src/app.js и tests health/subscription logging | Искусственный маркер в /sub и /happ-sub отсутствует при успехе/404/error; остальные request metadata сохраняются |
| F04 | Все changing Host Agent claims переживают housekeeping | host-agent/jarvis_host_agent/idempotency.py, server.py или общий operation catalog, tests | Состарить каждый changing operation и проверить original-ID после read housekeeping; read-only записи очищаются |
| F05 | Telegram download ограничивается до буферизации и имеет deadline | server/src/telegram/bot.js, профильные tests, bounded helper при необходимости | Missing/false length, chunked oversized/slow stream, cancellation, безопасная ошибка; внутренний ремонт без menu изменений |
| F06 | Повреждение command journal блокирует changing execution | cloud/desktopCloudClient.js, cloud/desktopCloudClient.test.js | Первый запуск разрешён; corrupt/read-failed fail closed; повтор ID не исполняется; после освобождения client.js |
| F07 | Shutdown пытается закрыть все ресурсы и дожидается работы workers | server/src/runtime.js, lifecycle helper, затронутые worker modules и tests | Ошибка каждого close, pending tick, повтор close, bounded drain; pool после drain |
| F08 | Истёкшие rate-limit/vision записи освобождаются без нарушения replay guard | server/src/http/rateLimiter.js, server/src/vision/visionLeaseStore.js, tests | Управляемое время, разнообразные keys, expiry и upper bounds, owner/device mismatch и replay |
| F09 | Ошибки visual-memory мутаций не показаны как успех | renderer/cloud-chat/renderer.js и профильные tests | Delete/pin/correct false/rejection, controls retained, success only after ack; последовательно с F02/F11 |
| F10 | Отмена форм проекта/человека обходит required validation | renderer/cloud-chat/index.html, профильный browser/static regression | Пустые и заполненные формы, cancel/cross/Escape, возврат фокуса |
| F11 | Пользовательская поправка описания имеет приоритет | renderer/cloud-chat/renderer.js и tests | corrected_summary, отсутствие поправки, повторное открытие и prompt; последовательно с F02/F09 |
| F12 | Service drawer/confirmation доступны с клавиатуры | ops-ui/src/pages/ServicesPage.tsx, scoped dialog component/CSS/tests | Имена/roles, initial/return focus, Tab/ShiftTab, Escape, второй modal, race safety; не трогать main.tsx |
| F13 | Operations отличает 401 от outage | ops-ui/src/main.tsx, отдельные tests | 401 login; 503/network unavailable+retry; retry success; session expiry сохраняет безопасность |

## Статус

- [x] F01 — raw IPC удалены, narrow preload и main-frame guard; regression/смежные проверки прошли
- [x] F02 — exact-ID /confirm и /reject, одноразовые карточки и unknown feedback; renderer/cloud/server tests прошли
- [x] F03 — реальные Fastify stdout regression для path/query/errors/malformed; 23 профильных проверки прошли
- [x] F04 — закрытый каталог 31 операции, retention всех 16 changing; 149 Host Agent tests, 3 Windows skips
- [x] F05 — bounded stream/deadline/cancellation; 12 регрессий и полный server suite
- [x] F06 — journal fail closed/retention, checksum и wire unknown; 19 client/boundary проверок
- [x] F07 — drain 17 worker classes, все close и единый deadline; 32 lifecycle/runtime проверки
- [x] F08 — incremental cleanup/caps без live eviction; 61 профильная и смежная проверка
- [x] F09 — явный ack мутаций, сохранение controls при отказе; VM и real-DOM regression
- [x] F10 — formnovalidate для четырёх cancel buttons; 13 browser tests и Life OS проверки
- [x] F11 — authoritative corrected summary в title/prompt; 7 регрессий и real-DOM проверка
- [x] F12 — native dialogs, focus/Escape/return, stale response guards; Edge desktop/mobile fixtures прошли
- [x] F13 — 401 отдельно от outage, retry и session expiry; 4 Edge сценария прошли
- [x] Независимая проверка всех diff и regression coverage
- [x] Полный server suite 723/723, cloud suite 73/73, Host Agent 146 pass/3 skip, Operations 1/1 + build и browser fixtures
- [x] RU/EN запись о локальном результате и текущем статусе; установленные версии отмечены отдельно
- [x] Финальная branch/worktree инвентаризация и Desktop comparison; выпуск предложен владельцу по завершении

## Приёмка

Нет статуса «исправлено» без теста на исходное нарушение и просмотра интеграции. Ограничения Windows/Linux, настоящей PostgreSQL и real-client acceptance записываются отдельно. Статус deployed не следует из локальных зелёных тестов. После готового результата выпуск server/Host Agent и новая сборка Desktop предлагаются владельцу; не выполняются без его поручения.
