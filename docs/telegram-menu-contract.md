# Telegram bot menu contract

Status: current production navigation contract, checked 2026-09-23. This file
owns shipped labels, layout, callback families, and visible confirmations.
Read the stable architecture and agent workflow in
[`telegram-button-architecture.md`](telegram-button-architecture.md) before
changing a path. The isolated Telegram branch may lag concurrent Supervisor
source changes; verify the deployed revision before a server rollout.

## Change control

18 октября 2026, согласовано владельцем в текущей задаче, выпущено на DE:
[Telegram Mini App и роли](updates/2026-10-18-telegram-mini-app-release.md).
При включении серверных прав нижняя клавиатура фильтруется ролью и личными
allow/deny. Главная/помощь сохраняются; jobs показывается участнику с этим правом,
но до его собственного HH подключения объясняет необходимость настройки.
Старые команды/callbacks и активный guided input проверяют текущие права,
отозванный ввод не потребляется и не меняет данные. Контекст модели и итоговый
ответ проверяют права на использованные источники. Callback grammar, guided
kinds, private scope и подтверждения прежние. Общие VPN/Operations/Supervisor
остаются за отдельными owner-bound границами. Даже при отключённом UI ранее
заведённые ограничения продолжают действовать. Кнопка «Открыть Jarvis» настроена;
настоящие нажатия owner/admin/member остаются для приёмки.

Owner-approved on October 18, 2026 and deployed on DE:
[Mini App and access roles](updates/2026-10-18-telegram-mini-app-release.md).
With server access control enabled, the bottom keyboard filters role and personal
allow/deny. Home/help remain; jobs appears for permitted members but explains
personal HH setup until their own connection exists. Old commands/callbacks and
active guided input check current rights; revoked input is not consumed or
applied. Model context and output recheck rights to consumed sources. Callback
grammar, guided kinds, private scope and confirmations remain. Shared
VPN/Operations/Supervisor keeps separate owner-bound limits. Turning off the UI
does not remove established restrictions. The “Открыть Jarvis” menu button is configured; actual
owner/admin/member taps remain for acceptance.

18 октября: [исследование 403](updates/2026-10-18-hh-captcha-403-investigation.md)
добавляет закрытую категорию ответа HH, тип запроса, возраст картинки и исход
сопоставления CSRF/cookie в private receipt. Значения секретов/headers и тело сайта
не сохраняются. Telegram-путь, подпись, подтверждение и unknown/retry прежние.

18 октября: [квитанция ручной и автоматической отправки](updates/2026-10-18-hh-captcha-receipt-diagnosis.md)
содержит только закрытые status/stage/category, без текста ответа и данных HH.
Она дополняет owner-bound manual state и локальный экспорт; Telegram-путь,
кнопки, подписи, исходная operation и подтверждение прежние. Unknown не повторяется.

18 октября 2026 владелец согласовал приватный архив картинок и ответов только
автоматических попыток. [Изменение](updates/2026-10-18-hh-captcha-evidence.md)
внутреннее: browser → OCR → прежний native POST/verifier → прежнее фото владельцу.
Архив не входит в Telegram diagnostics или историю; ручные ответы не сохраняются.
Кнопки, подписи, owner scope и подтверждения прежние; unknown не повторяется.

18 октября 2026 владелец запросил три автоматические попытки вместо двух.
[Установленный на DE выпуск](updates/2026-10-18-hh-captcha-three-attempts-development.md)
сохраняет прежний Telegram-путь, подпись, подтверждение и раннюю остановку при
unknown. Уже переданное человеку состояние не открывается повторно.

Согласовано владельцем и установлено на DE 18 октября 2026:
[дообученный OCR перед ответом человека](superpowers/specs/2026-10-18-hh-trained-ocr-design.md).
При отдельном opt-in `JARVIS_HH_CAPTCHA_AUTOMATIC=1` browser/server выполняют
до трёх автоматических попыток на разных картинках. `preparing` — закрытый
внутренний исход без фото и Telegram-уведомления; раннее collector attention
подавляется только в этом режиме. После трёх неудач приходит прежнее фото с
добавлением «Автоматическая проверка не подтвердила доступ. Нужна твоя помощь.»
к существующей подписи. Unknown или прерванная отправка передают управление
человеку раньше, без второй автоматической отправки. Автоуспех проверяется
чтением точного target; без явного запроса успех не создаёт сообщения.

Кнопки, callback grammar, guided kinds, owner/private scope, reply confirmation,
expiry и deduplication прежние. Ответ владельца по-прежнему разрешает только
однократную отправку текущей привязанной картинки; refresh не пополняет бюджет.
Флаг по умолчанию выключен. Старый общий OCR не используется новым режимом.
Зависимости и выпуск согласованы. Offline Chromium, broker, worker, CPU-модель
и изолированный Linux socket проверены. Первая живая автоматическая попытка
получила unknown: дальнейшая автоматика остановилась, фото отправлено владельцу.
Принятие настоящей капчи OCR не подтверждено; [результат выпуска](updates/2026-10-18-hh-trained-ocr-release.md).

Approved by the owner and deployed on DE on 18 October 2026.
The separate browser/server opt-in runs at most two persisted attempts on
distinct images before the existing human photo flow. The internal `preparing`
outcome sends no image or notification; early collector attention is suppressed
only in this mode. The photo retains its confirmation caption and adds the fixed
Russian sentence above asking for help. Unknown or interrupted submission stops
automation early. Success requires the existing exact-target reader. Buttons,
callbacks, guided kinds, owner/private binding, reply confirmation, expiry and
deduplication remain unchanged. Refresh cannot replenish the incident budget;
defaults stay disabled and the generic OCR cannot serve the new endpoint.
Dependencies and rollout are approved. Offline browser/broker/worker, actual CPU
model and isolated Linux socket checks passed. The first live automatic attempt
returned unknown, stopped automation and sent the owner a photo. Actual OCR-based
HH acceptance is unconfirmed; see the linked release result.

Согласовано владельцем и установлено на DE 16 октября 2026:
[панель настроек поиска](superpowers/specs/2026-10-16-job-settings-panel-design.md).
`job:settings` показывает компактные кнопки дохода, города, удалённых вакансий,
интервала, глубины истории, модели AI, порога уведомления, запросов и исключений.
Открытие панели не начинает ввод. Скалярные поля предлагают предустановки или
обычное значение; модель — текущую/настроенные OpenRouter модели, наследование
и ввод ID. Каталог доступности провайдера не запрашивается; вызовов AI нет.
Запросы/исключения показываются по восемь: добавление, полный текст, удаление,
навигация. После сохранения новой фразы показана страница с ней.

Закрытые callbacks: `job:cfg:<field>:<revision>:<page>`, `cfg_input` с той же
формой, `job:cfg_pick:<field>:<revision>:<index>`, `cfg_item`/`cfg_remove` только
для списков, `job:cfg_ok:<confirmation-uuid>`. Field — закрытый код параметра,
не значение. Все callbacks ≤64 байт. Перед записью — краткая разница и отдельное
«Сохранить / Отмена»; сохранение возвращает панель или список. Старая revision,
просроченное/потреблённое подтверждение, чужие user/chat/conversation отклоняются.
Навигация отменяет ожидание ввода; неверное значение позволяет повторить ввод.
Migration 036 добавляет `job_setting_value`, закрытый context
`{targetId,revision,field,returnPage}`; остальные job context shapes прежние.
Старый уже выданный `job_settings_edit` работает до истечения, новая панель его
не создаёт. Изменения не затрагивают HH-подтверждения, профиль и письма.

Owner-approved and deployed on DE on 16 October 2026. Settings
now opens a compact button panel with separate field screens, presets/custom
values, configured/current model choices and paginated query/exclusion lists.
Opening the panel starts no input or AI request. Each change has an explicit
save/cancel preview and returns to the panel or relevant list page. Callbacks
above remain closed and bounded to 64 bytes; revisions, expiry, owner/private
scope and single consumption remain enforced. Migration 036 adds one closed
guided kind/context. Legacy pending editors remain compatible, and HH submission
confirmations, profiles and letters are unchanged. See the
[release result](updates/2026-10-16-job-settings-panel-release.md).

Согласовано владельцем и установлено на DE 16 октября 2026:
[учёт откликов](superpowers/specs/2026-10-16-job-application-tracking-design.md).
«Поиск работы → Отклики» (`job:applications:<page>`) объединяет журнал Jarvis
и обнаруженные на HH записи. Первый вход ставит импорт в очередь;
`job:applications_sync` запускает или продолжает обновление active + archived.
Карточки `job:application:<uuid>` показывают источник, резюме, известную дату,
отдельные статусы отправки/работодателя и сохранённое собственное письмо.
`job:application_refresh:<uuid>` использует ту же очередь;
«Показать текущие данные» перечитывает сохранённую карточку.
Подтверждённый существующий отклик даёт ответ «На эту вакансию уже есть отклик.
Повторный не отправлен.» и кнопку «Отклики». Чужие IDs и неприватный scope отклоняются.
Новых guided kinds нет; callbacks ограничены 64 байтами. Отправка и её подтверждения
не меняются. CAPTCHA допускает дополнительную read-only проверку точных targets
`/applicant/resumes` и `/applicant/negotiations?filter=active|archived&page=<0..999>`;
подтверждение native answer сохраняется. Нет периодических проверок и уведомлений.

Owner-approved and deployed on DE on 16 October 2026. The Applications
menu merges Jarvis operations and observed HH history. First opening queues an import;
explicit refresh reads active and archived sections. Detail cards distinguish source,
resume, reliable dates, submission and employer states, and known own approved text.
The callback forms above retain owner/private scope and the 64-byte limit; there are
no new guided kinds. CAPTCHA verification adds only the exact read targets above.
Submission confirmations remain unchanged. No scheduled account checks or notifications.
See the [release result](updates/2026-10-16-job-application-tracking-release.md).

Установлено на DE 16 октября 2026 после поручения владельца:
[четыре варианта сопроводительного](superpowers/specs/2026-10-16-job-letter-modes-design.md).
Owner/private меню поиска добавляет «Редактировать базовое сопроводительное»
(`job:base_letter`). Обычный многострочный текст заменяет базовое письмо только
после показа полного текста и `job:approve:<uuid>` в исходном чате.
Факты и примеры необязательны для подготовки и отправки отклика.

`job:prepare:<vacancy-uuid>` теперь показывает выбор, не вызывает модель:
«Базовое» (`job:base:<uuid>`) и «Кастомное (без AI)» (`job:custom:<uuid>`)
готовят авторский текст без AI. «Улучшенное» (`job:improved:<uuid>`) адаптирует
сохранённое базовое, «Кастомное (с AI)» (`job:custom_ai:<uuid>`) — введённый для
вакансии текст. Оба AI-режима получают вакансию, исходное письмо, факты и примеры.
Кастомное письмо не заменяет общее базовое. Без базового первые два варианта
предлагают редактор или выбор кастомного. Есть возврат к текущему черновику.
Явные действия над черновиком называются «Перегенерировать с AI», «Изменить с AI»
и «Перевести с AI»; смена варианта не переносит посторонний прежний текст в AI.

Новые guided kinds: `job_base_letter_edit`, `job_custom_letter`,
`job_custom_letter_ai`; migration 034 расширяет PostgreSQL CHECK вместе с
repository allowlist. Context закрыт: `{targetId, revision}`; для редактора это
профиль, для кастомного ввода — вакансия. Срок, исходные owner/user/conversation/chat,
invalid retry и atomic consumption сохраняются. Письма ограничены 10 000 символов;
внешние пробелы удаляются по прежнему правилу Telegram, абзацы и внутренний текст
сохраняются. Ручные варианты не требуют модели и не создают usage/model tasks.

Каждый вариант сначала показывает черновик; `job:send:<draft-uuid>` и отдельное
`job:confirm:<confirmation-uuid>` сохраняют подтверждение точного текста, вакансии
и резюме. Смена варианта отменяет pending send, замена базового увеличивает
profile revision и делает прежние подтверждения неактуальными. Unknown остаётся
на исходном operation ID. Новые scopes/права не добавляются; callback ≤64 байта,
тексты не попадают в callbacks, diagnostics и общую историю.

Deployed on DE, 16 October 2026, after owner authorization. The job menu
adds a confirmed base-letter editor. Prepare now opens four explicit modes:
saved base without AI, saved base adapted with AI, custom input without AI,
and custom input adapted with AI. Facts/examples are optional and included in
both AI modes. Custom text never overwrites the shared base. Manual modes need
no model configuration or billable tasks. AI draft controls are labelled explicitly.
Migration 034 adds the three guided kinds above with closed ID/revision contexts.
Every mode retains the final exact-text HH confirmation, owner/private-chat scope,
expiry, revision checks, atomic consumption, original-operation reconciliation
and private history. New source selection excludes unrelated previous-draft text.
Outer whitespace is normalized by the existing Telegram rule; internal text and
paragraphs are preserved. See the linked specification and development result
for automated checks. The [release result](updates/2026-10-16-job-letter-modes-release.md)
confirms server rendering; real Telegram taps and an HH application remain unverified.

Выпуск от 15 октября 2026: согласованный owner-only путь
«Главное → Поиск работы» с inline-карточками и подтверждениями установлен
на DE; в первом выпуске нижняя клавиатура не менялась. Последующее
обновление кнопок установлено на DE и описано в таблице ниже. Контракт новой
функции описан в [спецификации](superpowers/specs/2026-10-15-job-search-design.md),
фактическая приёмка — в [записи разработки](updates/2026-10-15-job-search-development.md).
Реализация добавляет закрытое семейство `job:*` и четыре `job_*` guided-input
kind через migration 030. [Результат выпуска](updates/2026-10-15-job-search-release.md)
отделяет автоматические проверки и live HH чтение от ещё не выполненных
реальных нажатий владельца/member и отправки нового отклика.

Браузерное подключение сохраняет этот путь: «Подключить HH» проверяет уже
выполненный владельцем вход и выбранное им основное резюме, записывает только
метаданные в PostgreSQL. Повторное нажатие не меняет revision; другое резюме
не подставляется. Авторизация/смена резюме не выполняются через модель.
Отправка использует прежнее подтверждение точного текста и исходную operation;
проверка неизвестного результата передаёт тот же одобренный текст браузеру.
Collector располагает только read credential; отдельный apply credential
доступен bot server и browser при явном opt-in. Метки и callback grammar прежние.

По поручению владельца 15 октября подготовлено отключение предпросмотра ссылок
в сообщениях поиска работы. Как автоматическая доставка, так и ответы на
кнопки передают `link_preview_options.is_disabled=true`; длинные ответы
сохраняют это для каждой части. Текст, URL, кнопки и полномочия не меняются.
Обновление установлено на DE после разрешения владельца. По последующему
явному поручению владельца ранее доставленные карточки обрабатываются
одноразовой операцией: владелец/private chat проверяются по БД, редактируется
тот же message ID с отключённым preview, текстом карточки и прежней клавиатурой.
Состояние операции сохраняется приватно; сообщения не удаляются и не пересылаются.

Do not alter a label, row, availability, callback grammar, route, or
confirmation boundary without explicit owner approval in the current task, a
focused test of the route and authorization, and an update here and in
`AGENTS.md` if an invariant changes. First send the change notice required by
the architecture guide. Refactoring internals must preserve this observable
contract. Labels are presentation, never authority.

Локальная разработка 15 октября: после поручения владельца подготовлено
уведомление о неподтверждённой автоматической попытке капчи HH. Путь:
collector → owner-scoped PostgreSQL attention outbox → прежний Bot send.
Уведомление содержит фиксированное объяснение и просьбу пройти проверку
вручную; кнопок, OCR, токенов и исключений нет. Одна операция не создаёт
повторных уведомлений. Claim заново проверяет owner и привязку личного чата
к conversation; member/чужой chat не получают сообщение. Новых callback или
guided-input kind нет. Это ещё не подтверждение production-выпуска.

Согласованное изменение 16 октября: ручная CAPTCHA HH переносится в Telegram.
Владелец явно подтвердил, что текстовый reply на фото означает ввод и одну
отправку ответа в HH без второй кнопки подтверждения. Старый HH web/Tailscale
путь и кнопка «Открыть HH» удалены; прочие применения Tailscale не меняются.
[Спецификация](superpowers/specs/2026-10-16-hh-telegram-captcha-design.md).

Owner/private меню поиска получает «Проверить HH» (`job:captcha`). Фото содержит
только изображение CAPTCHA и фиксированную подпись `HH CAPTCHA · Ответь на это фото…`.
«Обновить картинку» (`job:captcha_refresh`) явно запрашивает новую картинку.
Callbacks не содержат ID, ответа, URL или скрытых параметров HH. Подпись служит
лишь подсказкой маршрутизации, а полномочия определяет привязка message ID в БД.
Reply должен совпасть с owner/user, conversation/private chat, challenge и сроком.
Старое, чужое и уже использованное фото отклоняется; обычный текст не является
подтверждением CAPTCHA. Невалидный ответ не расходует фото.

Путь: collector/manual coordinator → CAPTCHA worker → photo outbox → Bot sendPhoto
→ update claim → owner/chat/conversation → reply binding → atomic consumption
→ CAPTCHA-only browser credential → native answer POST → read-only target reader.
Текст не сохраняется в истории и не передаётся в AI, память или diagnostics.
Новый guided-input kind не добавляется. Неизвестный результат отправки фото или
ответа не разрешает повтор под новым ID. Сбор и отклики стоят на паузе до
проверенного чтения HH; фильтры/progress/checkpoint сохраняются. Выключенный
владельцем поиск не включается. Новые фотокарточки не рассылаются на каждом tick.
Установлено на DE; 16 октября 2026 владелец прошёл CAPTCHA ответом на фото.
Сервер подтвердил `solved`, снятие паузы и продолжение сбора.
[Результат](updates/2026-10-16-hh-telegram-captcha.md).
История прежнего пути: [выпуск web-доступа](updates/2026-10-16-hh-mobile-manual-release.md).

Согласовано владельцем 16 октября, установлено на DE:
[восстановление проверки HH](superpowers/specs/2026-10-16-hh-captcha-resilience-design.md).
Кнопки, callback grammar и подтверждение ответом на фото прежние. При повторных
ошибках подготовки бот сообщает о задержке и автоматическом повторе с паузой.
Просроченная, использованная или потерянная при сбое картинка требует явного
«Обновить картинку». Отказ Telegram и неизвестная доставка/отправка ответа
получают отдельные фиксированные сообщения с этой же кнопкой; unknown сам
не повторяется. Явный запрос при idle получает сообщение об отсутствии активной
CAPTCHA, без утверждения об успешном доступе к HH. Уведомления дедуплицируются
в outbox и перепроверяют owner, Telegram identity, исходные conversation/chat.
Неактуальное сообщение о задержке снимается после подготовки результата.
Migration 033 сохраняет request UUID и бюджет повторов фото; новых guided kinds нет.
[Выпуск и реальная проверка](updates/2026-10-16-hh-captcha-resilience-release.md)
подтвердили доставку новой картинки, принятый ответ и продолжение сбора.

## Persistent bottom keyboard

The keyboard is persistent, resizeable, and exact-text matched. Other text is
ordinary assistant input unless a valid scoped guided interaction owns it.

| Row | Owner | Family member | Route |
| --- | --- | --- | --- |
| 1 | `🏠 Главное`, `🎯 Life OS` | `🏠 Главное`, `🎯 Life OS` | Home, Life OS |
| 2 | `🧠 Память`, `📄 Документы` | `🧠 Память`, `📄 Документы` | Memory, documents |
| 3 | `🖥 Устройства`, `🔐 VPN` | `🖥 Устройства`, `❓ Помощь` | Devices; owner VPN; help |
| 4 | `📊 Панель`, `❓ Помощь` | absent | Owner Operations, help |
| 5 | `💼 Поиск работы` | absent | Owner job search, feature enabled and private chat only |

Row 5 is emitted only when job search is configured and the server role is
owner in a private chat. Other rows retain their labels and order. The exact
text routes through the existing scoped `job:menu`; it cancels active guided
input before opening the job menu. Ordinary text without the exact label is dialogue.
The job home shows `Включить поиск` (`job:resume`) while disabled and
`Выключить поиск` (`job:pause`) while enabled. Each click sets that explicit state;
replays do not toggle it back. Turning off preserves filters, checkpoint and
partial collection progress, revokes the previous collection lease and stops
card delivery. Turning on makes collection due immediately. Application
confirmation, existing callback grammar and guided-input kinds are unchanged.
This UI update was explicitly requested by the owner on 2026-10-15 and deployed
after separate release authorization. The server rendering matches the actual
enabled search; real owner tap-through of the new buttons remains unverified.

Strings and mappings live in `server/src/telegram/telegramMenu.js`. `/start`
and `/help` remain Home and Help aliases. Owner-only handlers recheck server
authorization even if a user types a label or submits callback data directly.

## Inline controls

Callback data uses a closed grammar and at most 64 UTF-8 bytes. No bodies,
paths, storage keys, tokens, credentials, or unchecked user text may appear.

- `life:*`: Life OS hierarchy and proposals; mutable values use scoped guided input.
- `vpn:*`: country/protocol menus, subscriptions, and origin-bound confirmation.
  Bound subscription profiles offer «🔧 Восстановить подключения» through
  the existing `vpn:sub:repair:<uuid>` callback. In the owner's private chat,
  only explicit `VPN_CLIENT_NOT_FOUND` export results qualify for replacement.
  A fresh origin-bound confirmation freezes those targets. Execution rechecks
  targets, durably records per-endpoint operation IDs before issue, and updates
  only missing bindings with compare-and-swap. Existing tokens remain unchanged.
  Unknown outcomes block another repair until original-ID reconciliation.
  `/vpn_health` shows the local Host Agent diagnosis and separate cross-node
  VLESS/Hysteria2 probe results. External timer failures do not currently send
  their own proactive Telegram incident message. Its «Автоматический ремонт»
  label refers to autonomous action without owner approval: only a restricted
  Xray/Hysteria2 service-restart proposal can be executed after a fresh owner
  confirmation in the private chat.
  The owner-only external-checks menu adds `Проверить ключ` only for fixed
  DE/NL and VLESS/Hysteria2 bindings with a completed installation/rotation
  attempt (including uncertain outcomes that require reconciliation), using
  `vpn:probe:recheck:<de|nl>:<v|h>`. It is available only in a private Telegram
  chat; the callback route forwards the normalized Telegram chat type to that
  guard and requires separate confirmation in the same conversation. It runs
  at most one existing read-only external probe after the Host Agent checks
  private credential-file metadata. Missing requested credentials fail closed
  without starting systemd. It stores only closed proof metadata; it never installs, rotates,
  exports, or reveals a key. Callback bytes contain only the fixed source node
  and protocol code.
- `mem:*`, `doc:*`, `dev:*`, `gallery:*`, `flow:*`: scoped controls, lookup, and expiry.
- `cmd:*`, `vpsup:*`: changing remote/VPN actions with originating-client confirmation.

`vpsup:allow|reject|details:<uuid>` is closed and bounded. Synthetic
acceptance is a confirmed no-op. The separate Supervisor rollout deployed
real-restart handling on 2026-09-23: a restart proposal is actionable only
from the owner's private Telegram chat after the current incident and closed
policy are rechecked, and may invoke only the matching `vpn.restart` or
`vpn.hysteria2.restart` operation. A post-action snapshot verifies both VPN
stacks. Stale diagnosis cancels; uncertain outcome is reconciled by the
original request ID without retry. A genuine owner-confirmed NL Xray restart
passed live postchecks on 2026-09-24 after the host-bound callback fix; the
synthetic no-op acceptance passed earlier on 2026-09-16.
For every button action, the server resolves the run's persisted `host_id`
to exactly one configured Supervisor service, and that service independently
checks host ownership before handling the callback. This is an internal route
fix; labels, row layout, callback bytes, and confirmation scope are unchanged.

`server/src/telegram/bot.js` validates outbound inline buttons. New callback
forms require parser, handler, authorization, and test before allowlisting.

## Route and failure invariants

1. Poll → strict dispatch → allowlist → update claim → scoped conversation →
   menu/guided input/dialogue → validated text or media delivery.
2. Model, menu, callback, and voice errors return safe classified outcomes;
   diagnostics retain only closed kind/status/failure code, never input text.
3. Duplicate update IDs never rerun a mutation or one-time artifact delivery.
4. VPN credentials and subscription URLs are delivery-only, not history,
   telemetry, prompts, logs, or callback data.
5. A keyboard row never grants authority; every owner-only action rechecks it.
   VPN confirmation also rechecks the originating conversation, channel, and
   device so a copied confirmation cannot execute from another chat.
6. `telegram_updates.status` describes service processing, not Bot API delivery.
   Delivery and fallback-send failures have distinct closed diagnostic codes;
   neither authorizes automatic replay of a changing action.

## Required regression gate

```powershell
cd server
node --test test/telegramArchitectureContract.test.js test/telegramBot.test.js test/telegramMessageService.test.js test/telegramMenu.test.js test/telegramMenuService.test.js test/telegramLifeOsService.test.js test/operationsLogs.test.js
```

Then run `npm test` before deployment. Production changes also need deployment
preflight, Compose health, public smoke, and real owner/member tap-throughs of
the affected path. Keep those manual outcomes separate from fixture results.
