# Mini App и доступ: выжимка чата / Mini App and access: chat handoff

[Русский](#русский) | [English](#english)

## Русский

Выжимка решений и результатов чата от 18 октября 2026. Это контекст для
продолжения работы; текущие полномочия проверяются в конфигурации и базе.
Правила агентов находятся в [AGENTS.md](../../AGENTS.md), контракт клиента —
в [mini-app/README.md](../../mini-app/README.md), состояние проекта —
в [карте документации](../README.md).

### Что согласовал владелец

- Полноценный Telegram Mini App с удобной админкой. Пользователи добавляются
  по числовому Telegram ID; email не используется.
- Роли задают доступ к разделам. Для каждого человека доступны личные исключения:
  наследовать роль, разрешить или запретить. Разделы: ассистент, поиск работы,
  Life OS, память, документы, устройства, VPN и Operations.
- Главный владелец назначает администраторов; администраторы управляют ролями
  и доступом. Их статус не открывает чужие диалоги, память и документы.
  Общие VPN/Operations/Supervisor сохраняют отдельные ограничения владельца.
- Настоящее 3D-ядро с красивым вращением, а не статичный макет. Three.js
  явно согласован как production-зависимость; внешний API генерации не нужен.
- Раздел «Помощь» удалён целиком: нижняя кнопка, справочный ответ и `/help`
  как навигация. Старый текст обрабатывается как обычный ввод с проверкой прав.

### Что реализовано

Mini App содержит вращающееся ядро с независимыми кольцами, перетаскиванием,
скоростью, паузой, reduced motion и fallback при отсутствии WebGL. Скрытая
сцена останавливается. Production отделён от превью с вымышленными ID.

Работают серверные роли и личные исключения, блокировки, аудит, revision/CAS,
личный текстовый диалог и чтение своих разделов. Проверки доступа действуют
в Telegram, Desktop HTTP/WebSocket, контексте модели, исполнении команд и фоновой
доставке Life OS. Отключение UI сохраняет заведённые ограничения.

Вход требует подписанных Telegram initData, срока действия и membership.
Сессии отзываемые; сервер хранит хэши, применяет Origin/CSRF. При недоступном
внешнем SDK клиент передаёт исходный `tgWebAppData` из fragment на ту же
серверную проверку. Подстановка ID или username не является входом.
После неизвестного результата клиент сверяет исходный UUID; повторная отправка
под новым ID не выполняется автоматически. Свой код клиента не сохраняет
тексты или credentials в browser storage для восстановления операции.

### Владелец и выпуск

В этом чате через Bot API проверено соответствие `@godforg1veme` числовому ID
`6501699834`. У него уже был вычисляемый уровень `owner`, без блокировки,
со всеми восемью разрешениями. Переназначение не понадобилось.
Источник полномочий — `JARVIS_OPERATIONS_OWNER_TELEGRAM_ID` и серверная проверка;
эта датированная запись не задаёт владельца и не разрешает назначение по username.

Дополнительная проверка участника: Bot API сопоставил `@ch4rnka` с ID
`784581163`. В текущей БД у неё `admin`, блокировки нет, восемь разрешений;
Mini App создал действующую сессию в 23:35 МСК 18 октября. Telegram admission
и Mini App используют одну membership, копировать ID в legacy allowlist не нужно.
С её текущими правами прошли `/start`, меню памяти и обычное сообщение через
настоящие Bot/message/menu handlers с тестовыми ответами и историей, в read-only
транзакции БД. Настоящие сообщения не отправлялись и пользовательские данные
не менялись. Это проверка обработки, не подтверждение доставки на телефон.
Отказ на предоставленном скриншоте расположен под датой «14 сентября»;
нужна новая `/start` для живой проверки. Роль не повышалась до владельца.

В [боте Jarvis](https://t.me/Jarvis_rilora_bot) настроена кнопка «Открыть Jarvis»
на `https://jarvis.rilora.ru/mini/`. HTTPS работает через Cloudflare tunnel.
На DE обновлён только server; NL получил исходники, его runtime не менялся.
Desktop 1.0.2 совпал с принятым runtime; пересборка EXE не требовалась.

Последняя проверенная общая `main`: `9173a58b59193be196cccff77c91a9c209740a15`.
Server release: `32e9dde60aea6cfa8e9e20a18381473e271f4407`, каталог
`/home/deploy/releases/jarvis-32e9dde-mini-entry`. Более новая `main` включала
только запись результата. Windows и исходники обоих VPS совпали, server healthy,
Host Agent/VPN активны. Перед следующими изменениями повторить живую сверку.

### Проверки и незакрытые вопросы

- Последняя правка: 742/742 server tests локально и в Linux image; production
  browser fixtures прошли, включая вход без SDK и отказ сервера.
- Первый выпуск: 8/8 изолированных PostgreSQL acceptance, все 40 migrations,
  WebGL-анимация, пауза, reduced motion, fallback и мобильные размеры проверены.
  Эти проверки не запускались заново при последующем обновлении только документации.
- Публично: live/ready и Mini App — 200, анонимный `/mini/api/me` — 401.
  При заблокированном SDK неверные synthetic initData отправлены один раз,
  сервер ответил 400, интерфейс остался закрытым.
- После скриншота исправлена воспроизведённая зависимость входа от SDK.
  Настоящий успешный вход владельца после исправления пользователь ещё не подтвердил.
- Остаются реальные Telegram Web cookies/expiry, плавность 3D на устройстве,
  два аккаунта owner/admin/member и отзыв доступа в открытой сессии.
- Второй HH требует собственного подключения. Выдача галочки не подключает
  аккаунт и не передаёт браузер владельца. Изменяющие действия с подтверждением
  остаются в исходных Telegram/Desktop клиентах.

Следующая клиентская проверка: `/start` обновляет старую клавиатуру, затем
полностью закрыть и открыть Mini App кнопкой бота и проверить вход владельца.
Новый push, PR или выпуск требуют поручения для следующей работы по AGENTS.md;
согласие на уже завершённые выпуски не является постоянным разрешением.

Подробные результаты: [первый выпуск](2026-10-18-telegram-mini-app-release.md),
[исправление входа и удаление помощи](2026-10-18-mini-app-entry-help-removal.md).
Согласованный замысел и план сохранены в
[спецификации](../superpowers/specs/2026-10-18-telegram-mini-app-design.md)
и [плане](../superpowers/plans/2026-10-18-telegram-mini-app.md).

## English

Summary of decisions and results from the October 18, 2026 chat. This provides
continuation context; current authority must be checked against configuration
and the database. Agent rules are in [AGENTS.md](../../AGENTS.md), the client
contract in [mini-app/README.md](../../mini-app/README.md), and project status
in the [documentation index](../README.md).

### Owner decisions

- A full Telegram Mini App with convenient administration. Users are added by
  numeric Telegram ID; email is unused.
- Roles grant section access. Each person can inherit the role, receive an
  explicit allowance or an explicit denial. Sections: assistant, job search,
  Life OS, memory, documents, devices, VPN and Operations.
- The main owner appoints administrators, who manage roles and access. Their
  status does not open other people's conversations, memory or documents.
  Shared VPN/Operations/Supervisor retains separate owner restrictions.
- An actual 3D core with polished rotation. Three.js was explicitly approved as
  a production dependency; no external generation API is required.
- Help was removed entirely: bottom button, descriptive answer and `/help`
  navigation. Old text uses ordinary input handling with current authorization.

### Implementation

The Mini App has a rotating core with independent rings, dragging, speed,
pause, reduced motion and a WebGL fallback. Hidden scenes stop rendering.
Production is separate from the fictional-ID preview.

Server roles and personal overrides, blocks, audit, revision/CAS, private text
conversation and own-section reads are implemented. Authorization covers
Telegram, Desktop HTTP/WebSocket, model context, command execution and background
Life OS delivery. Disabling the UI preserves existing access restrictions.

Authentication requires signed Telegram initData, expiry and membership checks.
Sessions are revocable; the server stores hashes and enforces Origin/CSRF.
If the remote SDK is unavailable, the client sends raw fragment `tgWebAppData`
through the same server validation. An ID or username alone cannot authenticate.
Unknown results are reconciled by the original UUID; the client does not
automatically resubmit under a new ID. Its own recovery code does not store
text or credentials in browser storage.

### Owner and deployment

Bot API checks in this chat matched `@godforg1veme` to numeric ID `6501699834`.
That account already had the derived `owner` level, was unblocked and had all
eight permissions. Reassignment was unnecessary. Authority comes from
`JARVIS_OPERATIONS_OWNER_TELEGRAM_ID` and server validation; this dated record
does not configure ownership or authorize username-based appointment.

Additional member check: Bot API matched `@ch4rnka` to ID `784581163`.
Her current database level is `admin`, unblocked, with eight permissions;
the Mini App created an active session at 23:35 Moscow time on October 18.
Telegram admission and the Mini App use the same membership; no ID copy to the
legacy allowlist is needed. With her current permissions, `/start`, the memory
menu and an ordinary message passed the actual Bot/message/menu handlers with
fixture replies/history in a read-only database transaction. No real messages
were sent and no user data changed. This verifies handling, not delivery to the
phone. The screenshot's denial appears under “14 September”; a fresh `/start`
is needed for live verification. The account was not promoted to owner.

The [Jarvis bot](https://t.me/Jarvis_rilora_bot) has an “Открыть Jarvis” button
for `https://jarvis.rilora.ru/mini/`. HTTPS uses Cloudflare tunnel. Only the DE
server was updated; NL received source changes without a runtime change.
Desktop 1.0.2 matched the accepted runtime; no EXE rebuild was needed.

Last verified shared `main`: `9173a58b59193be196cccff77c91a9c209740a15`.
Server release: `32e9dde60aea6cfa8e9e20a18381473e271f4407`, directory
`/home/deploy/releases/jarvis-32e9dde-mini-entry`. The newer `main` only added
deployment documentation. Windows and both VPS source checkouts matched, the
server was healthy and Host Agent/VPN services were active. Repeat live
comparison before further changes.

### Verification and remaining work

- Latest fix: 742/742 server tests locally and in the Linux image; production
  browser fixtures passed, including SDK-free entry and server rejection.
- First release: 8/8 isolated PostgreSQL acceptance tests, all 40 migrations,
  WebGL animation, pause, reduced motion, fallback and mobile widths passed.
  These checks were not repeated for the subsequent documentation-only update.
- Public HTTPS: live/ready and Mini App returned 200; anonymous `/mini/api/me`
  returned 401. With the SDK blocked, invalid synthetic initData was submitted
  once, the server returned 400 and the interface stayed closed.
- The reproduced SDK dependency was fixed after the screenshot. The user has
  not yet confirmed successful owner login after that fix.
- Real Telegram Web cookies/expiry, device 3D performance, two owner/admin/member
  accounts and revocation in an open session still need acceptance.
- A second HH account needs its own connection. Granting a permission neither
  connects it nor shares the owner's browser. Actions requiring confirmation
  remain in their originating Telegram/Desktop clients.

Next client check: `/start` refreshes the old keyboard, then fully close and
reopen the Mini App through the bot button and verify owner login. A new push,
PR or release needs authorization for the next work under AGENTS.md; approval
for completed releases is not standing authorization.

Detailed results: [first release](2026-10-18-telegram-mini-app-release.md),
[entry fix and Help removal](2026-10-18-mini-app-entry-help-removal.md).
The approved design and plan remain in the
[specification](../superpowers/specs/2026-10-18-telegram-mini-app-design.md)
and [plan](../superpowers/plans/2026-10-18-telegram-mini-app.md).
