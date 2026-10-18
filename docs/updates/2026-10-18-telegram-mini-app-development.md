# Telegram Mini App: разработка / development

[Русский](#русский) | [English](#english)

## Русский

Более новый результат: [выпуск на DE 18 октября](2026-10-18-telegram-mini-app-release.md). Ниже сохранён локальный этап.

18 октября 2026, локальная ветка `codex/telegram-mini-app`. Владелец согласовал
макет, Three.js, Telegram ID вместо email, роли с личными исключениями и
письменную спецификацию. GitHub и VPS пока не обновлялись.

Подготовлены вход с проверкой Telegram HMAC, отзываемые hashed-сессии,
CSRF/Origin, роли, личные allow/deny/inherit, назначение администраторов только
владельцем, блокировка, аудит и revision/CAS. Главный администратор защищён;
другие администраторы не читают чужую переписку, память или документы.
Изменение роли обновляет revision участников. Cookie использует
HttpOnly/Secure/SameSite=None/Partitioned; реальный Telegram Web ещё не проверен.

Mini App сохраняет настоящее вращающееся ядро и добавляет рабочую админку,
личный текстовый диалог и чтение своих разделов. Preview с вымышленными ID
отделён от production. Неопределённые операции сохраняют исходный UUID даже
после reload; browser storage не содержит тексты или credentials. Действия
с подтверждением остаются в исходных клиентах.

Права проверяются в Telegram/menu/guided input, Desktop HTTP/Vision/WebSocket,
контексте модели, отправке команд, server executors и фоновой доставке Life OS.
Закрыты обнаруженные обходы через percent-encoded paths, старые pairing codes,
открытые Desktop sessions и Life context composer. Отзыв контекстных прав
во время генерации скрывает ответ; исходные результаты уже отправленных команд
продолжают сверяться. Выключение UI не снимает уже заведённые блокировки.
Новых callback families или guided kinds нет; прежние подтверждения сохранены.

Migration 037 добавляет права/аудит/сессии, 038 — квитанции ассистента.
Подготовлены opt-in окружение, сборка Mini App в Dockerfile и ограниченный
Telegram Web framing для `/mini/`; остальные страницы сохраняют DENY.
Desktop runtime/ресурсы не менялись, пересборка EXE не требуется.

Проверено:

- Полный `npm test --prefix server`: 741/741, без пропусков.
- Отдельный PostgreSQL 16: 8/8 acceptance, без пропусков; реальные целевые
  migrations и repositories, HMAC, session revoke, CAS, конкурентность,
  повтор ID, чужой scope, настоящий runtime и UI-off persistence.
- Production browser fixtures: вход, CSRF, роли, Telegram ID, overrides,
  подтверждение, conflict draft, unknown/reload, личный диалог/разделы,
  keyboard, 320/390/1280 px и отсутствие credential storage.
- 3D preview fixtures: WebGL/frames, pause/offscreen/reduced motion/fallback,
  320/390/844 px, роли/overrides, XSS-as-text и отсутствие CSP ошибок.
- Build Mini App, Desktop asset check и `git diff --check` прошли.

PostgreSQL использовал временные схемы с целевыми migrations без несвязанного
pgvector. Полный production migration pipeline и Linux Docker/Caddy build
остаются для release staging. Browser API/model fixtures не являются живой
проверкой Telegram, HH или производительности телефона.

HH browser пока привязан к одному владельцу: второму человеку показано требование
собственного подключения. Общие VPN/Operations/Supervisor сохраняют owner-bound
границы. Выдача галочки не подтверждает второй работающий HH аккаунт.

Для живой приёмки нужен согласованный выпуск GitHub main, обновление server/HTTPS
на DE и исходников обоих VPS, включение Mini App и настройка URL запуска в боте.
Затем проверить два аккаунта, owner/admin/member, Telegram Web cookies/expiry,
телефонный FPS и отзыв прав. Выпуск, Docker/Caddy, реальные клиенты и второй HH
остаются неподтверждёнными.

[README клиента](../../mini-app/README.md),
[спецификация](../superpowers/specs/2026-10-18-telegram-mini-app-design.md),
[план](../superpowers/plans/2026-10-18-telegram-mini-app.md).

## English

Newer result: [DE release on October 18](2026-10-18-telegram-mini-app-release.md). The local stage is preserved below.

October 18, 2026, local branch `codex/telegram-mini-app`. The owner approved the
design, Three.js, Telegram IDs instead of email, roles with personal overrides
and the written specification. GitHub and VPS are unchanged.

Implemented Telegram HMAC authentication, revocable hashed sessions, CSRF/Origin,
roles, personal allow/deny/inherit, owner-only administrator appointments,
blocking, audit and revision/CAS. The owner is protected; other administrators
cannot read other people's conversations, memory or documents. Role changes
increment member revisions. Cookies use HttpOnly/Secure/SameSite=None/Partitioned;
actual Telegram Web remains unverified.

The Mini App retains its actual rotating core and adds working administration,
private text conversation and own-section reads. The fictional-ID preview is
separate from production. Uncertain operations retain the original UUID across
reload; browser storage contains no text or credentials. Confirmed actions
remain in their originating clients.

Permissions cover Telegram/menu/guided input, Desktop HTTP/Vision/WebSocket,
model context, command dispatch, server executors and background Life OS
delivery. Review closed bypasses through percent-encoded paths, stale pairing
codes, existing Desktop sessions and Life context composition. Context revocation
during generation withholds the answer; original results of dispatched commands
still reconcile. Disabling the UI preserves established blocks. No callback
families or guided kinds were added; existing confirmations remain.

Migration 037 adds access/audit/sessions and 038 assistant receipts. Opt-in
configuration, Mini App Docker build and restricted Telegram Web framing for
`/mini/` are prepared; other pages retain DENY. Desktop runtime/resources are
unchanged and the EXE needs no rebuild.

Verified:

- Complete `npm test --prefix server`: 741/741, no skips.
- Isolated PostgreSQL 16: 8/8 acceptance, no skips; actual target migrations
  and repositories, HMAC, session revocation, CAS, concurrency, duplicate IDs,
  foreign scope, actual runtime and UI-off persistence.
- Production browser fixtures: login, CSRF, roles, Telegram IDs, overrides,
  confirmation, conflict drafts, unknown/reload, private chat/sections,
  keyboard, 320/390/1280 px and no credential storage.
- 3D preview fixtures: WebGL/frames, pause/offscreen/reduced motion/fallback,
  320/390/844 px, roles/overrides, XSS-as-text and no CSP errors.
- Mini App build, Desktop asset check and `git diff --check` passed.

PostgreSQL used temporary schemas with target migrations without unrelated
pgvector. The complete production migration pipeline and Linux Docker/Caddy
build remain for release staging. Browser API/model fixtures do not establish
live Telegram, HH or phone performance acceptance.

The HH browser remains bound to one owner: a second user sees a personal
connection requirement. Shared VPN/Operations/Supervisor preserves owner-bound
limits. A checkbox does not establish a working second HH account.

Live acceptance requires an authorized GitHub main release, server/HTTPS update
on DE and source synchronization on both VPS, enabling the Mini App and
configuring the bot launch URL. Then verify two accounts, owner/admin/member,
Telegram Web cookies/expiry, phone FPS and access revocation. Release,
Docker/Caddy, real clients and the second HH account remain unverified.

[Client README](../../mini-app/README.md),
[specification](../superpowers/specs/2026-10-18-telegram-mini-app-design.md),
[plan](../superpowers/plans/2026-10-18-telegram-mini-app.md).
