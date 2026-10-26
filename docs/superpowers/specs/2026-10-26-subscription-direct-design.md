# Прямой HTTPS-вход подписок / Direct HTTPS subscription ingress

## Русский

Happ iOS 6.1 получает таймаут при обновлении. Воспроизведённые запросы Jarvis
завершает с HTTP 200 за 245–1211 мс, но это не доказывает доставку клиенту.
Сравнение часов телефона и VPS не позволяет измерить сетевую задержку точно.
Первопричина внутри приложения, сети или Cloudflare пока не разделена.

Подготовить независимый путь через Caddy, уже используемый проектом:
DNS-only имя → HTTPS TCP 9443 → только существующий GET/HEAD /sub/:token.
Это проверяемый обход Cloudflare, а не доказанное устранение первопричины.
Основной сервер остаётся приватным. Xray TCP 443/8443 не меняется.
HTTP TCP 80 используется только для ACME HTTP-01; автоматические редиректы
выключены. Не публиковать остальные API, HTML bridge или данные других клиентов.
Оба порта привязываются к выделенному IPv4; другой IP DE остаётся свободным
для HTTP-01 renewal Hysteria2. Bind на все адреса запрещён для этого overlay.
Оригинальная проверка токена и отзыва остаётся на сервере; кэша credentials нет.
Логи ingress выключены, включая error logs, которые могут содержать URL.

Overlay включается отдельно после согласования выпуска, DNS и firewall.
Включение не меняет старые ссылки и не ротирует токены. Для проверки на телефоне
меняется только origin сохранённой ссылки на HTTPS нового имени с портом 9443.
Передача полной ссылки через shell, логи или отчёт запрещена. Новые Telegram
ссылки автоматически не меняются; расширение генерации потребует отдельного этапа.

Заголовок subscription-request-timeout не используется: документация Happ
относит его к настройкам с Provider ID, которого у текущей выдачи нет.
Рабочий успех требует TLS-проверки, проверки закрытых маршрутов и реального
импорта/refresh на том же iPhone. До этого результат остаётся подготовкой обхода.

## English

Happ iOS 6.1 times out on refresh. Observed Jarvis responses return HTTP 200
in 245–1211 ms; this does not prove client delivery. Unsynchronized phone/VPS
clocks cannot establish precise network latency. App, network and Cloudflare
causes remain unresolved.

Prepare an independent path using the project's existing Caddy image:
a DNS-only hostname → HTTPS TCP 9443 → the existing GET/HEAD /sub/:token only.
This is a testable Cloudflare bypass, not a proven root-cause fix. Keep the
server private and Xray TCP 443/8443 unchanged. TCP 80 serves ACME HTTP-01 only,
with automatic redirects disabled. Exclude other APIs and the HTML bridge.
Bind both ports to the dedicated IPv4 only, leaving DE's other address free
for Hysteria2 HTTP-01 renewal. Do not bind this overlay on all addresses.
Keep server token/revocation checks, omit credential caching and disable both
access and error logs because request URLs are bearer credentials.

Enable the overlay only after release, DNS and firewall approval. Preserve
existing URLs and tokens. For phone acceptance replace only the saved URL's
origin with the direct hostname and port 9443, without printing the full URL.
Do not change Telegram link generation in this stage.

Do not send subscription-request-timeout: Happ documents it under settings
requiring a Provider ID, which current responses do not include. Acceptance
requires real TLS, denied-route checks and import/refresh on the affected iPhone.
