# Telegram bot menu contract

Status: current production navigation contract, checked 2026-09-23. This file
owns shipped labels, layout, callback families, and visible confirmations.
Read the stable architecture and agent workflow in
[`telegram-button-architecture.md`](telegram-button-architecture.md) before
changing a path. The isolated Telegram branch may lag concurrent Supervisor
source changes; verify the deployed revision before a server rollout.

## Change control

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

Согласовано владельцем 16 октября, подготовлено локально:
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
Это ещё не установленный на VPS выпуск.

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
