# Исправления аудита: локальная разработка, 17 октября 2026

[Русский](#русский) | [English](#english)

## Русский

Более новый результат: [выпуск и установка 17 октября](2026-10-17-audit-remediation-release.md).
Ниже сохранён локальный статус до поручения на публикацию.

Исправлены 13 подтверждённых проблем F01–F13 из аудита 16 октября.
Для каждой задачи работал отдельный субагент; координатор проверил изменения
и взаимодействие компонентов. Пользователь ограничил работу этими находками:
предложения A01–A07 и D01 остаются за её пределами.

Рабочая ветка `codex/audit-remediation`, база
`63c6392c2a2aa4720a915e0c64b3589a69bea50e`.
Изменения находятся в локальной рабочей копии. Коммита, push, PR, обновления VPS,
сборки и установки EXE в этой работе не было. Установленный Desktop 1.0.2
соответствует прежней `origin/main`; изменённые файлы клиента и новые preloads
в нём отсутствуют. GitHub и работающие VPS эти исправления ещё не получили.

### Что изменилось

| Находка | Исправление |
| --- | --- |
| F01 | Удалены универсальные IPC для инструментов и подтверждения. Вспомогательные окна получили минимальные preloads; защищённые main-window handlers проверяют точный webContents и main frame. |
| F02 | Кнопки подтверждения привязаны к конкретному command ID. Повторное нажатие блокируется; при неизвестном ответе предлагается проверка исходного ID. |
| F03 | Subscription access/error logs скрывают полный секретный path и query, включая malformed paths. Остальные request metadata сохраняются. |
| F04 | Host Agent удаляет старые ответы только для явно read-only операций. Claims всех изменяющих и неизвестных операций сохраняются. |
| F05 | Telegram-вложение проверяется по числу байтов во время чтения. Общий deadline 30 секунд покрывает metadata, fetch и body; отказ отменяет поток и выдаёт безопасную ошибку. |
| F06 | Повреждённый, недоступный или неожиданно изменённый журнал блокирует команды. Сохраняются original IDs; потеря истории передаётся серверу как unknown. |
| F07 | Shutdown останавливает admission/timers, ждёт начатые задачи и пытается закрыть каждый ресурс. Общий бюджет 8 секунд; pool закрывается после drain либо истечения бюджета. |
| F08 | Rate-limit и Vision-хранилища постепенно удаляют истёкшие записи и имеют пределы. Живые counters и replay guards не вытесняются; заполнение даёт безопасный отказ. |
| F09 | Карточка памяти показывает успех только после явного acknowledgement. При отказе остаются карточка, сообщение и рабочие кнопки. |
| F10 | «Отмена» и крестик форм проекта/человека обходят required validation. Проверены Escape и возврат фокуса. |
| F11 | Сохранённое исправленное описание используется в заголовке снимка и следующем редактировании. |
| F12 | Drawer сервиса и вложенное подтверждение используют именованные native dialogs, ограничивают фокус, закрываются Escape и возвращают фокус. Старые async ответы не меняют новую карточку. |
| F13 | Operations показывает вход только после 401. При 503/network и иных отказах подключения доступна безопасная повторная проверка; новый запрос Telegram-доступа не создаётся. |

### Проверки и ограничения

Каждая исходная проблема воспроизведена регрессией до исправления.
Полный server suite: 723/723; cloud/voice/TTS: 73/73.
Host Agent: 149 тестов, 146 прошли и 3 Linux filesystem/metadata проверки
пропущены на Windows. Desktop IPC/Gateway, Vision IPC/media permissions,
overlay и packaging assets прошли профильные проверки.

Headless Edge проверил реальный DOM клиента с синтетическим IPC: две команды
и подтверждение первой, отказ удаления, исправленное описание и prompt.
Отмена Life OS прошла 13 browser tests. Operations browser fixtures проверяют
клавиатуру, nested dialogs, запоздалые ответы, сбои подключения и повторную
проверку; Operations test 1/1 и TypeScript/Vite build прошли.
Команды находятся в [verification.md](../verification.md).

Произвольную внешнюю операцию нельзя отменить истечением shutdown deadline:
её результат остаётся unknown и проверяется по исходному ID. Журнал Desktop
ограничивает полные результаты последними 100, сохраняя компактные claims
старых IDs; согласованного срока replay пока нет. Переполненное хранилище
может временно отказывать до достижения истёкшей записи курсором очистки.

Реальные пользовательские данные, Telegram-нажатия, изменяющие Host Agent/VPN
операции и production shutdown не использовались. Проверка с настоящей
PostgreSQL и работающим Electron не заменяется этими fixtures. После принятия
изменений нужны согласованный выпуск server/Host Agent/Operations UI на оба VPS,
сборка `npm run dist:win`, разрешённая установка Desktop и живые smoke checks.

## English

Newer result: [publication and installation on 17 October](2026-10-17-audit-remediation-release.md).
The local status before publication was authorized is preserved below.

All 13 confirmed findings F01–F13 from the 16 October audit were fixed.
Each task had a separate subagent; the coordinator reviewed the changes and
component interactions. The user limited this work to those findings:
proposals A01–A07 and D01 remain outside its scope.

The working branch is `codex/audit-remediation`, based on
`63c6392c2a2aa4720a915e0c64b3589a69bea50e`.
Changes remain in the local working copy. This work made no commit, push, PR,
VPS update, EXE build or installation. Installed Desktop 1.0.2 matches the
previous `origin/main`; it lacks the changed client code and new preloads.
GitHub and the running VPS nodes have not received these fixes.

### Changes

| Finding | Fix |
| --- | --- |
| F01 | Removed generic tool and confirmation IPC. Auxiliary windows use minimal preloads; protected main-window handlers require the exact webContents and main frame. |
| F02 | Confirmation buttons bind to a specific command ID. Repeated clicks are blocked; unknown responses direct the user to check the original ID. |
| F03 | Subscription access/error logs mask the complete secret path and query, including malformed paths. Other request metadata remains available. |
| F04 | Host Agent expires old responses only for explicitly read-only operations. Claims for every changing or unclassified operation remain durable. |
| F05 | Telegram attachment bytes are checked while streaming. One 30-second deadline covers metadata, fetch and body; failure cancels the stream and returns a safe error. |
| F06 | A corrupt, inaccessible or unexpectedly changed journal blocks commands. Original IDs remain claimed; missing history reaches the server as unknown. |
| F07 | Shutdown stops admission/timers, drains admitted tasks and attempts every resource close. It has one eight-second budget; the pool closes after draining or budget expiry. |
| F08 | Rate-limit and Vision stores reclaim expired records incrementally and enforce caps. Live counters and replay guards are not evicted; full stores reject admission safely. |
| F09 | Memory cards show success only after explicit acknowledgement. Failures retain the card, feedback and usable controls. |
| F10 | Cancel and close buttons in project/person forms bypass required-field validation. Escape and return focus were verified. |
| F11 | The saved corrected summary appears in the snapshot heading and the next edit prompt. |
| F12 | The service drawer and nested confirmation use named native dialogs, contain focus, close with Escape and restore focus. Stale asynchronous results cannot overwrite a new card. |
| F13 | Operations shows login only after 401. Connection failures such as 503/network expose a safe retry without creating a new Telegram approval request. |

### Verification and limits

Each original issue was reproduced by a regression before its fix.
The full server suite passed 723/723; cloud/voice/TTS passed 73/73.
Host Agent ran 149 tests: 146 passed and three Linux filesystem/metadata checks
were skipped on Windows. Focused Desktop IPC/Gateway, Vision IPC/media permission,
overlay and packaging asset checks passed.

Headless Edge exercised the actual client DOM with synthetic IPC: two commands
and confirmation of the first, rejected deletion, saved summary and edit prompt.
Life OS cancellation passed 13 browser tests. Operations browser fixtures cover
keyboard use, nested dialogs, delayed responses, connection failures and retry.
The Operations test passed 1/1 and the TypeScript/Vite build passed.
Commands are listed in [verification.md](../verification.md).

A shutdown deadline cannot cancel an arbitrary external mutation: its outcome
remains unknown and must be reconciled using the original ID. Desktop retains
the latest 100 complete result bodies and compact claims for older IDs; no
replay expiry has been agreed. A full store may temporarily reject admission
until its cleanup cursor reaches an expired record.

No real user data, Telegram taps, changing Host Agent/VPN operations or production
shutdown were used. These fixtures do not replace real PostgreSQL and running
Electron acceptance. After acceptance, the remaining steps are an authorized
server/Host Agent/Operations UI release to both VPS nodes, `npm run dist:win`,
an authorized Desktop installation and live smoke checks.
