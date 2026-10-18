# Telegram Mini App: выпуск / release

[Русский](#русский) | [English](#english)

## Русский

18 октября 2026 выпущен код `c4c41863daff85bc92001c8713a578d5c475de7f`.
GitHub main, Windows и исходники DE/NL синхронизированы. На DE установлен
server release `/home/deploy/releases/jarvis-c4c4186-mini-app`, image
`sha256:dd129f0c762c94976408b3815c3be614726112918df05f185ac9ccf22841f225`.
Пересоздан только server; PostgreSQL, ASR, HH browser/collector/OCR и tunnel
сохранили контейнеры. Host Agent и VPN на обоих узлах активны.

Mini App включён на https://jarvis.rilora.ru/mini/. В боте
[Jarvis](https://t.me/Jarvis_rilora_bot) настроена кнопка «Открыть Jarvis».
Повторное чтение Bot API подтвердило URL как меню по умолчанию и для владельца.
Первоначальная запись возвращала успех, но читалось старое меню; итоговая
настройка сверена отдельно. Пользовательских сообщений при настройке не отправляли.

Доступны настоящее вращающееся 3D-ядро Three.js, Telegram ID без email,
роли, личные разрешения, назначение администраторов владельцем, блокировки
и аудит. Администраторы управляют доступом; личные данные других людей
остаются закрытыми. Реализованы личный текстовый диалог и чтение своих разделов.
Подробности: [README клиента](../../mini-app/README.md).

Проверено:

- Linux Docker image: 741/741 server tests; отдельная тестовая БД: 8/8
  PostgreSQL acceptance без пропусков. Полный pipeline всех 40 migrations
  прошёл на этой БД; после проверки БД удалена.
- Production: все 40 migrations записаны, таблицы 037/038 присутствуют,
  владелец заведён и не заблокирован. Live/ready возвращают 200,
  Mini App/assets — 200, анонимный `/mini/api/me` — 401. Чужой Origin
  на входе получает 403; preview-файл в production отсутствует (404).
- HTTPS работает через существующий Cloudflare tunnel. Mini App получает
  ограниченный Telegram Web framing/CSP, остальные страницы сохраняют DENY.
  Caddy не используется в текущем DE deployment; его конфигурация не проходила
  живую приёмку.
- До выпуска прошли production browser fixtures и WebGL preview: формы прав,
  конфликты revision, исходный UUID после reload, личные разделы, мобильная
  ширина, независимое вращение колец, пауза/reduced motion/fallback.
- Итоговая сверка source/runtime прошла: server 321 файл, Desktop 143,
  Host Agent по 17 на DE/NL. Desktop 1.0.2 соответствует принятому runtime;
  пересборка EXE не требовалась.

Реальный вход с телефона/Telegram Web, cookies/expiry, плавность 3D на телефоне
и два настоящих аккаунта owner/admin/member ещё требуют клиентской приёмки.
Browser fixtures не подтверждают эти сценарии. Второй HH требует личного
подключения: существующий browser принадлежит одному владельцу.
Общие VPN/Operations/Supervisor сохраняют отдельные owner-bound ограничения.

[Предыдущий локальный этап](2026-10-18-telegram-mini-app-development.md).

## English

On October 18, 2026, code `c4c41863daff85bc92001c8713a578d5c475de7f` was released.
GitHub main, Windows and DE/NL source checkouts are synchronized. DE runs
server release `/home/deploy/releases/jarvis-c4c4186-mini-app`, image
`sha256:dd129f0c762c94976408b3815c3be614726112918df05f185ac9ccf22841f225`.
Only the server container was recreated; PostgreSQL, ASR, HH browser/collector/
OCR and tunnel retained their containers. Host Agent and VPN services are active
on both nodes.

The Mini App is enabled at https://jarvis.rilora.ru/mini/. The
[Jarvis bot](https://t.me/Jarvis_rilora_bot) has an “Открыть Jarvis” menu button.
Bot API reads confirmed the URL for both the default menu and the owner's chat.
The initial write reported success while reads showed the old menu; the final
setting was verified separately. Configuration sent no user messages.

The release includes an actual rotating Three.js core, Telegram IDs without
email, roles, personal overrides, owner-appointed administrators, blocks and
audit. Administrators manage access; other people's private data remains closed.
Private text conversation and own-section reads are implemented. See the
[client README](../../mini-app/README.md).

Verified:

- Linux Docker image: 741/741 server tests; isolated test database: 8/8
  PostgreSQL acceptance tests with no skips. The complete 40-migration pipeline
  passed on that database; the test database was removed afterward.
- Production records all 40 migrations, has the 037/038 tables and an unblocked
  owner membership. Live/ready return 200, the Mini App returns 200 and anonymous
  `/mini/api/me` returns 401. Foreign-Origin login returns 403; the production
  preview file is absent (404).
- HTTPS uses the existing Cloudflare tunnel. Restricted Telegram Web framing/CSP
  applies to the Mini App; other pages retain DENY. Caddy is not used by the
  current DE deployment and its configuration has no live acceptance.
- Production browser fixtures and WebGL preview passed before release:
  permission forms, revision conflicts, original UUID after reload, private
  sections, mobile widths, independent ring rotation, pause/reduced motion/fallback.
- Final source/runtime comparison passed: 321 server files, 143 Desktop files
  and 17 Host Agent files on each node. Desktop 1.0.2 matches the accepted runtime;
  no EXE rebuild was needed.

Actual phone/Telegram Web login, cookies/expiry, phone 3D performance and two
real owner/admin/member accounts still need client acceptance. Browser fixtures
do not establish these outcomes. A second HH account needs a personal
connection; the existing browser belongs to one owner. Shared VPN/Operations/
Supervisor retains separate owner-bound boundaries.

[Earlier local stage](2026-10-18-telegram-mini-app-development.md).
