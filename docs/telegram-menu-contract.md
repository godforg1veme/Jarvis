# Telegram bot menu contract

Current navigation contract, consolidated October 23, 2026. This file owns labels,
layout, callback families and visible confirmations. Read
[telegram-button-architecture.md](telegram-button-architecture.md) in full before
editing a path; it owns routing, diagnosis and the mandatory change notice.

## Change control

Do not alter a label, row, availability, callback grammar, route or confirmation
boundary without explicit owner approval in the current task, focused route and
authorization tests, and an update here (and in AGENTS if an invariant changes).
Internal repairs preserve observable behavior and security scope. Labels never
grant authority. Verify the deployed revision before rollout.

This consolidation changes documentation only. The
[pre-consolidation contract](history/2026-10-23-telegram-menu-contract.md) preserves
the complete release chronology; dated wording there can be superseded.
[Current deployment and open acceptance](README.md) are tracked separately.

<a id="persistent-bottom-keyboard"></a>

## Collapsible bottom keyboard

The keyboard is resizeable and exact-text matched. The October 24 release on DE,
requested by the owner, sets `is_persistent: false` and `one_time_keyboard: false`
for every layout and in outbound validation. Telegram is no longer asked to show
the menu whenever the regular keyboard is hidden. The user can hide and reopen
it with the keyboard icon near the input field; selecting an item does not request
automatic hiding. Telegram controls initial display, scroll behavior and remembered
visibility; the Bot API cannot guarantee a strictly manual-only appearance in every
client. Existing chats receive the new flags on the next Home or `/start` keyboard
delivery after installation. Real-client scroll and toggle acceptance is pending.
Other text is
ordinary assistant input unless a valid scoped guided interaction owns it.

| Row | Owner | Family member | Route |
| --- | --- | --- | --- |
| 1 | `🏠 Главное`, `🎯 Life OS` | `🏠 Главное`, `🎯 Life OS` | Home, Life OS |
| 2 | `🧠 Память`, `📄 Документы` | `🧠 Память`, `📄 Документы` | Memory, documents |
| 3 | `🖥 Устройства`, `🔐 VPN` | `🖥 Устройства` | Devices; owner VPN |
| 4 | `📊 Панель` | absent | Owner Operations |
| 5 | `💼 Поиск работы` when configured | `💼 Поиск работы` with `jobs` permission | Personal job search in a private chat; current server permissions apply |

Row 5 is emitted for the owner when job search is configured, and for a member
with current `jobs` permission. When a permissions list is supplied, it filters
all rows except Home; empty rows are omitted. Labels and relative order remain
unchanged. The job route requires private user/chat/conversation scope and
rechecks current access. Each user connects their own HH profile; permission
does not grant access to the owner's HH account. Rendering is implemented in
[`telegramMenu.js`](../server/src/telegram/telegramMenu.js). The exact
text routes through the existing scoped `job:menu`; it cancels active guided
input before opening the job menu. Ordinary text without the exact label is dialogue.
The job home shows `Включить поиск` (`job:resume`) while disabled and
`Выключить поиск` (`job:pause`) while enabled. Each click sets that explicit state;
replays do not toggle it back. Turning off preserves filters, checkpoint and
partial collection progress, revokes the previous collection lease and stops
card delivery. Turning on makes collection due immediately. Application
confirmation, existing callback grammar and guided-input kinds are unchanged.
Real owner/member tap-through outcomes are tracked in the release records.

Strings and mappings live in `server/src/telegram/telegramMenu.js`. `/start`
remains the Home alias. The owner requested complete removal of Help on October 18:
no Help button, section, descriptive answer or `/help` navigation alias remains
in the October 18 release. Old Help text follows ordinary authorized input. Owner-only handlers recheck server
authorization even if a user types a label or submits callback data directly.

## Inline controls

### Mini App section navigation (local, October 26, 2026)

At the owner's request to resolve the Mini App audit in stages, personal Mini App
sections offer a link to the corresponding existing bot menu. The closed startup
parameters are `mini_memory`, `mini_documents`, `mini_devices`, `mini_life`,
`mini_jobs`, `mini_vpn`, and `mini_operations`. They contain no resource IDs,
credentials, user text or confirmation identifiers. This work is local and has
not been deployed.

The link yields `/start mini_<section>` in a private chat. The normal update claim,
current section permissions and user/chat binding apply before menu navigation.
VPN and Operations also require the main owner. A denied link cannot cancel an
active guided interaction. An allowed link opens the same menu and cancels guided
input as its existing bottom-keyboard equivalent. Unknown startup parameters
keep their prior handling. Plain `/start`, keyboard rows, inline callback grammar
and action confirmations are unchanged.

`GET /mini/api/sections/:permission` provides server-built navigation after its
final access check. Bot links use the initialized bot's own username; if it is
unavailable, the client explains how to open the bot manually. Operations offers
an additional `/ops/` HTTPS link only to the owner when configured. Both clients
reject a configured Operations URL with credentials, a path, query or fragment.
Opening the panel does not approve its login or a VPS operation.

Mini App link labels identify the target section. They use Telegram's native link
opening methods on a click when available, with an ordinary HTTPS anchor as
fallback. The helper description distinguishes read-only Mini App data and HH
resume management from bot actions. Existing action confirmations stay in the
client where the action was requested.

Focused coverage: `test/miniAppSectionNavigation.test.js`, deep-link scenarios in
`test/telegramMessageService.test.js`, PostgreSQL handoff acceptance in
`test/miniAppIntegrationAcceptance.cjs`, and
`scripts/testMiniAppSectionHandoffs.cjs` at 390/1280 px. Real Telegram WebView,
owner/member taps and panel login remain separate acceptance checks.

### In-place text navigation (October 24, 2026)

At the owner's request, a text inline-button result replaces the text and
keyboard of the message that was clicked. A vacancy received at 10:00 stays
at that position when opened at 11:00; newer vacancy deliveries remain separate
messages below it. Back, letter-mode selection, draft previews and confirmations
use the same rule, as do other text menus. A terminal result clears old controls.
Returning Home edits the message and includes the existing job entry when allowed;
the persistent bottom keyboard is not resent by an inline click. Typed messages
still receive normal replies. Photos, documents and delivery-only artifacts retain
their separate delivery paths. Telegram edit failures attempt a safe callback
alert, without appending a message or repeating the action. Fast paths answer
the callback after delivery, so a failed edit uses the first answer for its alert.
After 1.5 seconds the bot acknowledges a slow callback to stop the spinner;
an alert after that acknowledgement is best effort and may not appear. If Telegram
rejects the alert, the failure is logged with a closed code. Live delivery of
error alerts still needs client acceptance, especially after a slow action.

Long callback results use `pg:<random-v4-uuid>:<0..99>` and the labels
`← Текст`, `Текст →`, with a page counter. Pages contain the complete text,
including whitespace, as plain text. Return controls remain on every page;
other domain action buttons appear on the last page, after the full preview.
Paging reads the prepared snapshot and never reruns
the callback that created it. The callback contains no letter or resource text.
Snapshots are held only in process memory, at most 200 for 10 minutes; restart,
expiry or eviction makes them unavailable. New navigation on the same message
invalidates its earlier snapshot. Expired, copied or unauthorized page callbacks
show a safe alert without creating a message or exposing cached content.

Every page checks the original Telegram identity, chat, message ID, internal
user and conversation, plus the current permissions of the original callback.
Callbacks for one chat/message are processed and delivered in sequence so a slow
edit cannot restore an obsolete page after a newer action.
Domain buttons still recheck resource revisions, expiry and original-client
confirmation through their existing handlers. No guided-input kind, database
migration, action permission or send-confirmation boundary changes.

Automated coverage: `test/telegramCallbackPresentation.test.js`. Installed on DE
as `jarvis-telegram:e857122`; server healthy and 75 Telegram checks passed inside
the new image. Real Telegram tap-through remains pending.
[Release and verification](updates/2026-10-24-telegram-inline-edit-release.md).

Callback data uses a closed grammar and at most 64 UTF-8 bytes. No bodies,
paths, storage keys, tokens, credentials, or unchecked user text may appear.

- `life:*`: Life OS hierarchy and proposals; mutable values use scoped guided input.
- `vpn:*`: country/protocol menus, subscriptions, and origin-bound confirmation.
  После подтверждённого создания или «Получить новую ссылку» VPN-подписка
  выдаётся через `https://sub.rilora.ru:9443`: текст содержит `/sub/`, кнопка
  импорта открывает `/happ-sub/` того же origin. Старые URL-кнопки на
  `https://jarvis.rilora.ru/happ-sub/` остаются допустимыми. Меню, callbacks,
  owner/private scope, подтверждение ротации и доставка без записи URL
  в историю сохраняются. Изменение запрошено владельцем 26 октября 2026.
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
node --test test/telegramCallbackPresentation.test.js
```

Then run `npm test` before deployment. Production changes also need deployment
preflight, Compose health, public smoke, and real owner/member tap-throughs of
the affected path. Keep those manual outcomes separate from fixture results.

## Job search: model and history

Выпуск на DE 25 октября добавляет фоновую проверку свежих вакансий по
тем же запросам и фильтрам каждые пять минут. Новых меню, кнопок, callbacks,
guided kinds и подтверждений нет. Ежедневная сверка повторяет весь выбранный период
по тем же фильтрам. Включение/выключение поиска действует на все три прохода.
Свежие карточки получают приоритет в существующей outbox, прежние
sent/unknown не повторяются. Уведомление о неполном сборе проверяет свой проход;
обновление верхней границы не создаёт новое уведомление. Миграции 047/048 применены.
[Выпуск и проверки](updates/2026-10-25-hh-three-lane-release.md).

The October 25 DE release adds five-minute background fresh searches
with the same queries and filters. Menus, buttons, callbacks, guided kinds and
confirmations stay unchanged. Daily reconciliation rescans the entire selected
history range using the same filters. The existing on/off control applies to all three lanes.
Fresh cards receive outbox priority; sent/unknown cards are not replayed. Incomplete
notices validate their own lane and retain one identity across head refreshes.
Migrations 047/048 are applied. [Release and checks](updates/2026-10-25-hh-three-lane-release.md).

23 октября 2026, по поручению владельца выпущено на DE: пункт «Модель AI»
полностью удалён из настроек поиска работы. Ручной ID, пресеты, старый текстовый
ввод `модель = ...` и callbacks поля больше не принимаются. Модель для писем
выбирается автоматически существующей очередью OpenRouter: проверенные бесплатные
варианты, затем настроенный общий платный резерв. Генерация остаётся по запросу,
финальное подтверждение отправки письма и private scope прежние. Migration 045
удаляет персональный выбор и аннулирует старые previews/ввод этого поля,
сохраняя фильтры и checkpoint. Новых callback или guided kinds нет.
[Выпуск и проверки](updates/2026-10-23-jobs-automatic-model-release.md).

22 октября 2026, согласовано владельцем и выпущено на DE:
история откликов и приглашений HH обновляется полностью раз в час у каждого
пользователя с действующим `jobs`, личным подключением и проверенным Telegram
scope. Включение поиска новых вакансий на это не влияет. Первая проверка не
требует открытия раздела. Текущая проверка и её checkpoint не заменяются;
ручная кнопка «Обновить из HH» остаётся.
В «Отклики» у каждой записи показано время проверки. Приглашение из архива
обозначается «Приглашение (архив)», без доказательства последней полной
проверки или при нераспознанном новом статусе — «Приглашение не подтверждено».
Порядок использует исходную дату HH, а не время импорта; неизвестные даты идут
после известных. Migration 044 хранит дату записи, раздел и доказательство
полного обхода. Callback grammar, кнопки, права и подтверждение отклика прежние.
[Выпуск, проверки и ограничения](updates/2026-10-22-hh-history-hourly-release.md).

## Job search: resumes

22 октября 2026, согласовано владельцем и выпущено на DE:
«Поиск работы → Резюме HH» после личного подключения показывает собственные
резюме с отметкой основного. Выбор и отдельный выключатель автоподнятия ведут
к полному названию и «Подтвердить / Отмена». Mini App и бот сохраняют один
primary. Новая политика включает бесплатное поднятие по умолчанию, сохраняя
прежний явный off и остановку unknown; минимум 4 часа и один primary прежние.
Выключение текущего расписания доступно и без резюме в каталоге или связи с HH.

Callbacks: `job:resumes`, `job:resumes_refresh`, `job:rs_pick:<menu-uuid>:<0..19>`,
`job:rs_auto:<menu-uuid>:<0|1>`, `job:rs_ok:<confirmation-uuid>`,
`job:rs_status:<confirmation-uuid>`. Значений HH в них нет. Migration 043
добавляет confirmation kind `resume`; новых guided-input kinds нет.
Снимок меню и preview имеют TTL 10 минут, user/conversation/private chat,
access stamp, manager/connection revision. Подтверждение потребляется один раз;
тот же UUID связывает исходную settings-операцию и проверку unknown без нового
select. Другая навигация отменяет preview. Отзыв jobs сериализован с записью
выбора. Смена primary отменяет прежние подтверждения отклика с другим резюме.
[Установка и проверки](updates/2026-10-22-hh-resume-bot-defaults-release.md).

## Job search: filters and connection

21 октября 2026, согласовано владельцем: новые фильтры поиска пустые.
В «Настройки → Поисковые запросы / Исключения → Добавить» одно сообщение
принимает несколько фраз, по одной на строку, с общим предпросмотром и
подтверждением. «Очистить список» использует существующий `cfg_pick` с индексом,
не содержит пользовательского текста. Зарплата, город и формат имеют варианты
без ограничения. Последний запрос можно удалить; поиск тогда выключается.
Без запросов включение не допускается. Прежние jobs/private scope, revision,
expiry, retry и single consumption сохраняются; callback grammar и kinds прежние.
[Проверки и результат выпуска](updates/2026-10-21-empty-job-filters.md).

21 октября 2026, согласовано владельцем и установлено на DE:
«Подключить HH» выдаёт личную временную ссылку текстом и URL-кнопкой
«Открыть вход HH». Запуск из Mini App также отправляет её этому пользователю
в личный Telegram. URL ограничен настроенным HTTPS origin и
`/mini/job-connect/#ticket=<64 hex>`; он не попадает в историю Jarvis и логи.
Сохраняются private scope, актуальное право jobs, отдельный профиль HH,
срок ссылки и подтверждение основного резюме в исходной Mini App.
Неизвестная доставка сверяется по исходной операции и не повторяется
автоматически. Нижняя клавиатура Telegram и запасные кнопки окна HH остаются.
Тап по полю HH включает ввод с клавиатуры телефона; значения полей не входят
в метаданные снимка. Настоящая клиентская приёмка ещё не подтверждена.
[Выпуск и проверки](updates/2026-10-21-hh-login-touch-release.md).

## Job search: settings input

`job:settings` открывает панель дохода, города, удалённых вакансий, интервала,
глубины истории, порога уведомления, запросов и исключений. Открытие не начинает
ввод или AI-запрос. Скалярные поля предлагают готовое/своё значение;
списки показываются по восемь, новая фраза открывает свою страницу.
Ручной выбор модели удалён, включая старый текстовый ввод и callbacks поля.

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

## Job search: application cards

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
подтверждение native answer сохраняется. Полный обход выполняется по почасовому
расписанию выше; новые уведомления этим контрактом не добавляются.

## Job search: letter modes and send confirmation

### Resume provenance guard (local, October 27, 2026)

По согласованию владельца подготовлен контроль связи письма с основным резюме
для всех профилей. Подготовка и подтверждение отклоняют черновик, если его
резюме или revision отличаются от текущего подключения. Старые черновики без
сохранённой привязки остаются в истории, но не отправляются: нужно явно выбрать
новый вариант письма. Продолжение и ручная правка сохраняют исходную привязку;
выбор нового варианта начинает независимое письмо и не передаёт старый текст
модели. Подтверждение точного текста, вакансии и резюме остаётся в исходном чате.
Изменение и migration 053 пока локальные; реальная клиентская проверка открыта.

The owner approved a resume provenance guard for all profiles. Preparation
and confirmation reject a draft whose saved resume or connection revision no
longer matches. Older drafts without provenance stay in history but cannot be
sent; the user must explicitly choose a new letter. Edits retain their original
binding, while a new letter does not pass the old draft to the model. Exact-text,
vacancy and resume confirmation remains in the originating chat. The change and
migration 053 are local; live client acceptance is still pending.

Выпущено на DE 24 октября 2026, миграция 046 применена: у любого текущего
черновика добавлена «Редактировать текст» (`job:manual_edit:<draft-uuid>`).
Кнопка показывает полный текст для копирования и просит прислать исправленный
вариант целиком. Новый `job_draft_manual_edit` хранит закрытый context
`{targetId, revision}` и добавлен в allowlist/PostgreSQL CHECK migration 046.
Для этого вида ввода сохраняются все символы, включая внешние пробелы и переносы;
непустота проверяется через trim, максимальная длина исходного текста 10 000.
Прочие виды ввода сохраняют прежнюю нормализацию.

Путь: callback → текущий private jobs scope → scoped guided input → атомарные
consume и append дочернего черновика → preview → прежние send/confirm.
Неверный ввод не потребляет interaction, старый/чужой/истёкший ввод отклоняется.
Модель при ручном сохранении не вызывается, базовое письмо и резюме не меняются.
Прежнее pending подтверждение отправки становится неактуальным. Текст правки
и служебный статус preview не смешиваются. Owner/admin/member используют своё
пространство и текущие права; реальная приёмка на телефоне остаётся отдельной.

AI-режимы получают личное выбранное резюме при подключённом HH, исходный текст,
facts и примеры стиля. Резюме читается через закрытый read-only RPC
`resume_content` с точным выбранным ID, по UUID-профилю пользователя; после
чтения и при сохранении проверяются актуальные выбор и revision. Сбой чтения
выбранного резюме сохраняет старый черновик. Без HH-подключения подготовка по
фактически переданным материалам доступна. Результаты установки, проверок
и оставшаяся приёмка записаны в [результате выпуска](updates/2026-10-24-shared-instructions-and-search-release.md);
описанные ниже прежние выпуски остаются историей.

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

## HH CAPTCHA: photo reply and recovery

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

## HH CAPTCHA: automatic opt-in

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

Приватный архив содержит картинки и ответы только автоматических попыток;
ручные ответы не сохраняются. Архив не входит в Telegram diagnostics или историю.
[Контракт архива](updates/2026-10-18-hh-captcha-evidence.md),
[лимит трёх попыток](updates/2026-10-18-hh-captcha-three-attempts-development.md).


## Access control and time

HH collection recovery, 24 October 2026: public search and CAPTCHA handover use
current jobs permission for owner/admin/member and the user's own private chat;
a connected HH account is not required for public collection. One durable
`HH_COLLECTION_STATUS` notice per saved run explains incomplete collection and
offers the existing `job:menu` button. Sending rechecks scope, active search and
run identity. `sent`/`unknown` notices are not replayed. Callback grammar, guided
kinds and CAPTCHA reply confirmation are unchanged. Owner approval is recorded
in the current task. [Repair record](updates/2026-10-24-hh-complete-collection.md).

При включении серверных прав нижняя клавиатура фильтруется ролью и личными
allow/deny. Главная сохраняется; jobs показывается участнику с этим правом,
но до его собственного HH подключения объясняет необходимость настройки.
Старые команды/callbacks и активный guided input проверяют текущие права,
отозванный ввод не потребляется и не меняет данные. Контекст модели и итоговый
ответ проверяют права на использованные источники. Callback grammar, guided
kinds, private scope и подтверждения прежние. Общие VPN/Operations/Supervisor
остаются за отдельными owner-bound границами. Даже при отключённом UI ранее
заведённые ограничения продолжают действовать. Кнопка «Открыть Jarvis» настроена;
настоящие нажатия owner/admin/member остаются для приёмки.

19 октября 2026, по запросу владельца: пользовательские часы и даты — МСК,
фиксированный UTC+3. В «Life OS → Напоминания → Добавить/Перенести» ввод без
пояса означает московское время; явные ISO Z/offset сохраняют момент.
Подсказка указывает МСК, карточка показывает МСК. Неверный календарный ввод
не потребляет guided state; исправленный ввод сохраняет прежние user/chat/
conversation, revision, expiry и single consumption. Callback grammar/kinds
не меняются. Старые записи не сдвигаются автоматически.
