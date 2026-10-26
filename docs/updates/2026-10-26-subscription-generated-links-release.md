# Прямые ссылки Happ / Direct Happ links — 2026-10-26

## Русский

Исправлена недоработка [первого этапа](2026-10-26-subscription-direct-release.md):
Telegram продолжал выдавать прежний адрес. Теперь создание и подтверждённое
«Получить новую ссылку» используют `https://sub.rilora.ru:9443`. Кнопка импорта
открывает `/happ-sub/` того же origin; HTML содержит прямую `/sub/` ссылку.
Менять начало новой ссылки вручную больше не требуется.

На DE установлены server image `jarvis-subscription-links:e56340f` и Caddyfile
из `/home/deploy/releases/jarvis-subscription-e56340f`, SHA
`e56340faa07e78c4fa2a9df0f96477a047b2206a`. Сначала обновлён ingress, затем server.
Оба VPS source синхронизированы с GitHub. Принятая Windows main находится в
worktree задачи; посторонние изменения Mini App в `F:/test/jarvis` сохранены.
Desktop не менялся.

Прошли 76 Telegram regression tests, семь проверок настоящего Caddy и 863
server tests как локально, так и в собранном Linux-образе. В каждом полном
запуске пропущены две проверки с БД. Независимая ревизия не нашла дефектов.
В установленном контейнере проверены origin, rotation на искусственном
repository, допустимость URL-кнопки, manual URL и Happ deeplink.
Живые подписки при проверке не менялись, сообщения не отправлялись.

Server healthy, environment совпал с прежним без вывода значений. Прочие
container IDs и PID Xray/Hysteria2 сохранены; установленный server совпадает
с main. Прямой TLS с NL работает, неизвестные искусственные токены отвергаются
на обоих разрешённых маршрутах, `/mini/` закрыт. Старый public readiness дал
200 из Windows и 403 от Cloudflare из NL; это не доказывает причину таймаута iPhone.

Callback grammar, owner/private scope, подтверждение ротации и delivery-only
credentials прежние. Ротация по подтверждению делает старую ссылку неактивной;
при установке токены не ротировались. Реальная выдача через Telegram и импорт
на проблемном iPhone остаются для приёмки владельцем.

## English

This fixes an omission in the [first stage](2026-10-26-subscription-direct-release.md):
Telegram still generated the old origin. Creation and confirmed “Get a new link”
now use `https://sub.rilora.ru:9443`. Import buttons open `/happ-sub/` on that
origin and its HTML supplies the direct `/sub/` URL. Newly generated URLs no
longer require manual origin replacement.

DE runs `jarvis-subscription-links:e56340f` and the Caddyfile from
`/home/deploy/releases/jarvis-subscription-e56340f`, revision
`e56340faa07e78c4fa2a9df0f96477a047b2206a`. Ingress was updated before the server.
Both VPS sources match GitHub. Accepted Windows main is in this task's worktree;
unrelated Mini App changes in `F:/test/jarvis` are preserved. Desktop is unchanged.

Checks passed: 76 Telegram regression tests, seven actual-Caddy checks and 863
server tests both locally and in the built Linux image. Each full run skipped
two database checks. Independent review found no defects. The installed image
passed origin, rotation with an artificial repository, URL-button, manual URL
and Happ deeplink checks. No live subscription was rotated or message sent.

The server is healthy and its environment matches the previous configuration
without exposing values. Other container IDs and Xray/Hysteria2 PIDs are
unchanged; installed server code matches main. Strict direct TLS from NL works;
both token routes reject unknown synthetic tokens and `/mini/` is denied.
The old public readiness returned 200 from Windows and a Cloudflare 403 from NL;
this does not establish the iPhone timeout's cause.

Callback grammar, owner/private scope, rotation confirmation and delivery-only
credentials remain unchanged. Confirmed rotation invalidates the previous URL;
deployment itself rotated no tokens. Actual Telegram delivery and import on
the affected iPhone remain owner acceptance steps.
