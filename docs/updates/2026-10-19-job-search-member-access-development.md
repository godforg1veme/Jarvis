# Личный поиск работы для участников / Personal job search for members

## Русский

19 октября 2026: изменения подготовлены локально в ветке `codex/jobs-member-hh`.
Это разработка, не выпуск: ветка не опубликована, миграция 039 на production не
применялась, VPS и работающий Mini App не менялись.

Пользователь с актуальным правом `jobs` получает личный путь поиска. В Telegram
сохраняются существующая кнопка и callback. Поиск, CAPTCHA, история, письма,
доставки и выбранное резюме проходят с проверкой текущего разрешения и области
пользователя. Каждый внутренний UUID получает отдельный Chromium-профиль; профиль
главного владельца остаётся в прежнем каталоге. Разрешение администратора не даёт
доступ к чужим профилям. VPN и Operations остаются только за главным владельцем.

Для первого входа Mini App создаёт одноразовую HTTPS-ссылку со сроком пять минут.
Её можно открыть на телефоне или ПК; ссылка копируется, а на поддерживаемом
устройстве передаётся через системное меню «Поделиться». Отдельная HTTPS-страница
показывает ограниченное изображение страницы HH и принимает касания, мышь и
ввод в активное поле. На телефоне используется экранная клавиатура устройства;
по умолчанию введённое скрыто. Страница передаёт события через HTTPS в память
серверного gateway и внутреннего browser RPC. Введённый текст не записывается в
БД, файлы, Telegram, логи или diagnostics; серверный браузер технически доступен
владельцу инфраструктуры. Пользователь возвращается в исходную Mini App и
подтверждает основное резюме. Временная сессия действует десять минут.

HH cookies и состояние профиля хранятся отдельно для каждого UUID с закрытыми
правами в файловой системе. Новый неподтверждённый профиль очищается после
отмены, ошибки/истечения входа или отзыва права; профиль с ранее подтверждённым
HH подключением не удаляется при временном отзыве. Публичный gateway использует
существующий HTTPS origin и
HttpOnly cookie для временного окна. Browser RPC остаётся во внутренней сети,
connect credential отделён от read/apply/CAPTCHA credentials. Текущие права
повторно проверяются на сервере; Tailscale и установка программы пользователю
не нужны. Реальный пароль и код вводятся через временный интерфейс удалённой
страницы HH, а не отправляются сообщением в Telegram.

При ревизии соседних разделов подтверждено: ассистент, Life OS, память,
документы и устройства остаются в собственной области пользователя; роль
администратора не открывает личные разговоры, файлы или устройства. VPN и
закрытые операции VPS остаются owner-bound. Изменяется только путь разрешения
`jobs`; в старом режиме без membership Mini App поиск сохраняется исключительно
для Telegram ID главного владельца.

### Проверенное состояние

- Просмотрен исходный путь Telegram → jobs handler → репозитории и worker → browser RPC; замечено и исправлено отсутствие отдельного Mini App status endpoint для исходной сессии.
- В legacy owner fallback дополнена повторная проверка по числовому Telegram ID; очередь collector и доставка сохраняют доступ владельца без создания новых memberships.
- Устаревший fallback Telegram-меню, доверявший `users.role='owner'`, заменён на проверку точного настроенного Telegram ID для VPN/Operations.
- Сверены allowlist Mini App assets, пути API и ограниченные browser operations. Обновлены документация и план реализации.
- Проверено повторное предъявление одноразового ticket: без уже выданной guest cookie ссылка отклоняется; тот же браузер может безопасно повторить запрос после потерянного ответа. Также проверены маршрутизация профилей, текущие права и revision, принадлежность резюме, очистка при отзыве доступа, область guest-сессии, лимиты ввода и отдельный connect credential.
- Серверные unit-тесты прошли 765/765. Browser-тесты прошли 69/69; девять проверок прав файловой системы Linux пропущены на Windows. Оба PostgreSQL acceptance-теста прошли на временной изолированной БД.
- Сборка Mini App и синтетический Chromium сценарий прошли на ширинах 390 и 1280 пикселей. Реальный вход HH, отзыв права в живой браузерной сессии и проверка на VPS ещё не подтверждены. На момент подготовки этой записи GitHub и VPS не менялись.

## English

October 19, 2026: the changes were prepared locally on branch
`codex/jobs-member-hh`. This is development, not a release: the branch has not
been published, migration 039 has not been applied to production, and the VPS
and running Mini App have not changed.

A user with current `jobs` permission receives a personal job-search path. The
existing Telegram button and callback stay unchanged. Search, CAPTCHA, history,
letters, delivery and the selected resume check current permission and user
scope. Each internal UUID gets a separate Chromium profile; the main owner's
profile remains in its existing directory. Administrator access does not open
other profiles. VPN and Operations remain restricted to the main owner.

For first sign-in, the Mini App creates a one-time HTTPS link that expires after
five minutes. It can be opened on a phone or PC; the link can be copied or sent
through the system share sheet where supported. A dedicated HTTPS page shows a
bounded image of HH and accepts touch, mouse and input into the active field.
Phones use their system keyboard; typed text is masked by default. The page
relays events over HTTPS through the server gateway and private browser RPC.
Input values are not written to the database, files, Telegram, logs or
diagnostics; the infrastructure owner can technically access the server
browser. The user returns to the originating Mini App and confirms the primary
resume. The temporary session lasts ten minutes.

HH cookies and profile state are stored separately per UUID with private file
permissions. A new unconfirmed profile is cleared after cancellation, login
failure/expiry or permission revocation; any profile with a previously confirmed
HH connection is preserved when permission is temporarily revoked. The public
gateway uses the existing HTTPS origin and an HttpOnly cookie for the temporary
window. Browser RPC stays
on the private network, with a connect credential separate from read/apply/CAPTCHA
credentials. Server-side permission checks remain current; users need neither
Tailscale nor an installed client. The real password and code are entered through
the temporary remote HH page rather than sent in Telegram.

The adjacent-section review confirmed that Assistant, Life OS, memory,
documents and devices remain scoped to each user's own data; an administrator
role does not open private conversations, files or devices. VPN and closed VPS
operations remain owner-bound. Only the `jobs` permission path changes; in the
legacy mode without Mini App memberships, job search remains available solely
to the main owner's numeric Telegram ID.

### Verified state

- Reviewed the Telegram → jobs handler → repositories and workers → browser RPC path; found and fixed the missing Mini App status endpoint for the originating session.
- Added a numeric Telegram ID check to the legacy owner fallback; collector queue and delivery retain owner access without creating new memberships.
- Replaced the legacy Telegram-menu fallback that trusted `users.role='owner'` with an exact configured Telegram ID check for VPN/Operations.
- Reviewed the Mini App asset allowlist, API paths and restricted browser operations. Updated the documentation and implementation plan.
- Tested replay of a one-time ticket: the link is rejected without the guest cookie already issued to that browser; the same browser can retry safely after a lost response. Checks also cover per-user profile routing, current permission and revision, resume ownership, revocation cleanup, guest-session scope, input limits and a separate connect credential.
- Server unit tests passed 765/765. Browser tests passed 69/69; nine tests of Linux filesystem permissions were skipped on Windows. Both PostgreSQL acceptance tests passed on a temporary isolated database.
- The Mini App build and synthetic Chromium flow passed at 390 and 1280 pixel widths. Real HH sign-in, revocation during a live browser session and VPS acceptance remain unverified. GitHub and VPS were unchanged when this record was prepared.
