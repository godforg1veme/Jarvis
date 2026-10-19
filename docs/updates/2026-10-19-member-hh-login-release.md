# Личное подключение HH для участников / Member HH sign-in

[Русский](#русский) | [English](#english)

## Русский

19 октября 2026 года личный вход в HH для участников с актуальным правом `jobs`
опубликован в GitHub `main` и установлен на DE. Сервер, Chromium browser и
collector собраны из кода `35a340a19a31056e029b780bbde0c8342a5f8cb6`.
Миграция `039_job_member_hh_sessions.sql` применена.

Участник запускает подключение из Telegram Mini App и открывает временную
HTTPS-ссылку на телефоне или компьютере. На отдельной странице он входит в HH,
затем возвращается в исходную Mini App и подтверждает основное резюме. Ссылка
действует пять минут; её обмен привязан к браузеру с выданной ему HttpOnly
cookie. Повторный запрос из того же браузера восстанавливает потерянный ответ,
а копия ссылки в другом браузере не создаёт сессию.

Профиль HH создаётся отдельно для каждого внутреннего UUID. Jarvis проверяет
текущее право `jobs` на запросах и фоновых действиях; администратор Mini App
не получает доступ к чужому HH. Ассистент, Life OS, память, документы и
устройства сохраняют собственные области пользователя. VPN и Operations
остаются доступны только главному владельцу. Старый поиск без Mini App
membership остаётся привязан к числовому Telegram ID владельца.

Пароль и код HH вводятся на временной странице и не отправляются в Telegram.
Значения полей проходят в памяти через HTTPS gateway и внутренний browser RPC;
они не сохраняются в базе, файлах, логах или diagnostics. Cookie входа имеет
ограниченный путь, а connect credential отделён от read, apply и CAPTCHA
секретов. Пользователям не нужны Tailscale или установленная программа.

Перед обновлением сборщик остановили мягко. Активный поиск сохранил контрольную
точку и был назначен на ближайший запуск. Прежний Docker volume профиля владельца
`jarvis-job-browser-owner-20261015` сохранён. PostgreSQL, ASR, OCR и tunnel не
пересоздавались; после выпуска сервер и browser прошли healthcheck, collector
запущен. На публичном домене `/health/live`, `/health/ready`, `/mini/` и страница
подключения ответили `200`; неавторизованный `/mini/api/me` ответил `401`.

Синхронные исходники на DE и NL получили опубликованный код; job runtime
обновлён только на DE. Desktop не менялся. Реальный вход участника в HH с
телефона или ПК и подтверждение резюме ещё не проверены в живом аккаунте.

Проверки перед выпуском: серверные тесты `765/765`; browser tests `69/69`,
девять проверок Linux file permissions пропущены на Windows; два PostgreSQL
acceptance-теста прошли на отдельной временной базе. Сборка Mini App и
синтетический Chromium сценарий прошли на ширинах 390 и 1280 пикселей.
В Linux image прошли целевые проверки server `5` и job-browser `8/8`.

## English

On October 19, 2026, personal HH sign-in for members with current `jobs`
permission was published to GitHub `main` and deployed on DE. The server,
Chromium browser and collector were built from code commit
`35a340a19a31056e029b780bbde0c8342a5f8cb6`. Migration
`039_job_member_hh_sessions.sql` was applied.

A member starts the connection from the Telegram Mini App and opens a temporary
HTTPS link on a phone or computer. They sign in to HH on a dedicated page, then
return to the originating Mini App and confirm the primary resume. The link
expires after five minutes. Its exchange is tied to the browser holding the
issued HttpOnly cookie. A retry from that browser can recover a lost response;
a copied link in another browser cannot create a session.

Each internal UUID gets a separate HH profile. Jarvis checks current `jobs`
permission on requests and background actions. A Mini App administrator does
not gain access to another member's HH account. Assistant, Life OS, memory,
documents and devices keep their own user scopes. VPN and Operations remain
available only to the main owner. Legacy job search without Mini App membership
remains bound to the owner's numeric Telegram ID.

The HH password and code are entered on the temporary page and are not sent in
Telegram. Field values pass through the HTTPS gateway and private browser RPC in
memory; they are not saved to the database, files, logs or diagnostics. The
login cookie has a restricted path, and the connect credential is separate from
read, apply and CAPTCHA secrets. Users do not need Tailscale or an installed app.

The collector was stopped gracefully before the update. The active search kept
its checkpoint and was scheduled to run again. The existing owner profile
Docker volume `jarvis-job-browser-owner-20261015` was preserved. PostgreSQL,
ASR, OCR and the tunnel were not recreated; the server and browser passed their
healthchecks, and the collector is running. On the public domain,
`/health/live`, `/health/ready`, `/mini/` and the connection page returned
`200`; unauthenticated `/mini/api/me` returned `401`.

DE and NL source checkouts received the published code; the job runtime was
updated on DE only. Desktop was unchanged. A real member sign-in from a phone or
PC and resume confirmation have not yet been tested with a live HH account.

Pre-release checks: server tests `765/765`; browser tests `69/69`, with nine
Linux filesystem-permission tests skipped on Windows; both PostgreSQL acceptance
tests passed against a separate temporary database. The Mini App build and
synthetic Chromium flow passed at 390 and 1280 pixel widths. Focused Linux image
checks passed for server (`5`) and job-browser (`8/8`).
