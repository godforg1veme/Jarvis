# Прямой вход подписок Happ / Direct Happ subscription ingress — 2026-10-26

[Русский](#русский) | [English](#english)

## Русский

Позднее 26 октября установлен [дополнительный выпуск генерации ссылок](2026-10-26-subscription-generated-links-release.md).
Ниже сохранён результат первого этапа, когда Telegram ещё выдавал прежний origin.

На DE включён отдельный HTTPS-вход `https://sub.rilora.ru:9443`, который
передаёт только GET/HEAD существующих подписок напрямую в Jarvis, без Cloudflare.
Исходная причина таймаута Happ iOS 6.1 не установлена. Этот выпуск предоставляет
независимый путь загрузки; исправление на проблемном iPhone ещё не подтверждено.

Код входа: `47618d5a29bbdeb41343ee0dc1054ed54dcf5d05`. Отдельный immutable
release: `/home/deploy/releases/jarvis-subscription-47618d5`. Контейнер
`jarvis-family-subscription-direct-1` использует Caddy 2.10.2 из существующего
образа проекта `caddy:2.10-alpine`. Исходники DE и NL синхронизированы с GitHub.
Принятая Windows-копия находится в worktree этой задачи; незавершённые изменения
Mini App в `F:/test/jarvis` сохранены и в этот выпуск не включены.

DNS-only A-запись создана и проверена через API и публичный DNS. Вход привязан
к основному IPv4 DE, TCP 80/9443. Другой IPv4 остаётся свободным для HTTP-01
renewal Hysteria2. Сертификат прошёл строгую проверку имени и цепочки из NL;
срок заканчивается 24 января 2027. Из Windows TLS прошёл с явным разрешением
имени на IP, пока локальный DNS держал отрицательный ответ новой записи.

Проверки:

- Шесть локальных сценариев через настоящий Caddy: GET/HEAD, закрытые пути и
  методы, сохранение отказа upstream для отозванного токена, удаление browser
  credentials, no-store и отсутствие искусственных токенов в выводе.
- Настоящий Docker Compose проверил overlay и привязку к одному IPv4.
- Независимая проверка не обнаружила обхода границы маршрутов или утечек.
- С NL синтетический неизвестный токен получил серверный
  `SUBSCRIPTION_NOT_FOUND`; POST, `/mini/`, `/api/`, `/happ-sub/` закрыты.
- После установки прежние container IDs и PID Xray/Hysteria2 совпали с
  записанным состоянием до установки; основной server остался healthy.

Полные URL и credentials не сохранялись в отчёте или командах. Access/error
logs нового входа выключены, private/no-store применяется ко всем ответам.
Проверку токена и отзыва выполняет существующий сервер. Токены, привязки
клиентов и прежние ссылки не менялись. Telegram продолжает выдавать прежний
origin. EXE не менялся и не пересобирался.

Для проверки существующей подписки на iPhone нужно заменить только её origin
`https://jarvis.rilora.ru` на `https://sub.rilora.ru:9443`, сохранив путь и
токен. Полную ссылку не присылать в чат. Нужны четыре сервера, успешный refresh
и повторное обновление на проблемной сети. Принятие четырёх реальных записей
через новый вход и исчезновение таймаута пока не проверены.

Настройка timeout 15 секунд не выпускалась: документация Happ относит её
к настройкам с Provider ID, которого у текущей выдачи нет. Порядок обслуживания
и отключения: [deployment instructions](../../deploy/subscription-direct.md).
Приватные настройки запуска сохранены в `/home/deploy/.config/jarvis/`.

## English

A [link-generation follow-up](2026-10-26-subscription-generated-links-release.md)
was installed later on October 26. The first-stage record below is preserved;
Telegram still generated the original origin at that stage.

DE now has a separate HTTPS ingress at `https://sub.rilora.ru:9443`. It forwards
only existing subscription GET/HEAD requests directly to Jarvis, without
Cloudflare. The original Happ iOS 6.1 timeout cause remains unresolved. This
release provides an independent download path; a fix on the affected iPhone
has not yet been confirmed.

Ingress code: `47618d5a29bbdeb41343ee0dc1054ed54dcf5d05`. Immutable release:
`/home/deploy/releases/jarvis-subscription-47618d5`. Container
`jarvis-family-subscription-direct-1` runs Caddy 2.10.2 from the project's
existing `caddy:2.10-alpine` image. Both DE and NL source checkouts match GitHub.
The accepted Windows copy is this task's worktree. Unfinished Mini App changes
in `F:/test/jarvis` are preserved and excluded from this release.

The DNS-only A record was created and verified through the API and public DNS.
The ingress binds DE's primary IPv4 on TCP 80/9443, leaving the other IPv4 free
for Hysteria2 HTTP-01 renewal. NL passed strict certificate hostname and chain
validation; expiry is January 24, 2027. Windows passed TLS with an explicit
hostname-to-IP resolution while its local DNS retained a negative cached answer.

Checks:

- Six local scenarios using actual Caddy cover GET/HEAD, denied paths/methods,
  upstream rejection of revoked tokens, removal of browser credentials,
  no-store responses and absence of synthetic tokens in process output.
- Actual Docker Compose validated the overlay and single-IPv4 publication.
- Independent review found no route-boundary bypass or credential disclosure.
- From NL, an unknown synthetic token received the server's
  `SUBSCRIPTION_NOT_FOUND`; POST, `/mini/`, `/api/` and `/happ-sub/` were denied.
- Existing container IDs and Xray/Hysteria2 PIDs matched the pre-install
  checkpoint; the main server remained healthy.

No full subscription URL or credentials were included in commands or reports.
Ingress access/error logs are disabled, with private/no-store on all responses.
The existing server retains token and revocation checks. Tokens, bound clients
and previous URLs are unchanged. Telegram still generates the original origin.
Desktop code and the installed EXE were unchanged.

To test an existing iPhone subscription, replace only its saved origin
`https://jarvis.rilora.ru` with `https://sub.rilora.ru:9443`, preserving the path
and token without sharing the complete URL. Acceptance requires four entries,
a successful refresh and another refresh on the affected network. Actual
four-entry delivery through the new ingress and disappearance of the timeout
remain unverified.

The 15-second timeout header was not released: Happ documents it under settings
requiring a Provider ID, which current responses do not include. See the
[deployment instructions](../../deploy/subscription-direct.md) for maintenance
and disabling the ingress. Private startup settings are retained under
`/home/deploy/.config/jarvis/`.
