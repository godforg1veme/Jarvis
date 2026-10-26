# Прямой HTTPS-вход для подписок Happ

Статус 26 октября 2026: [включён на DE](../docs/updates/2026-10-26-subscription-direct-release.md),
DNS и строгий TLS проверены; приёмка на проблемном iPhone ещё не выполнена.
Это независимый путь через DNS-only имя и TCP 9443. Он позволяет проверить
обход Cloudflare; исходная причина таймаута пока не установлена.

## Границы

Отдельный Caddy проксирует только GET/HEAD `/sub/sub_<64 hex>` и
`/happ-sub/sub_<64 hex>` в приватный
server. Токен и его отзыв проверяет Jarvis. Остальные пути не передаются
серверу; Cookie/Authorization/Forwarded удаляются. Ответы не кэшируются.
Access/error logs ingress выключены, поскольку URL является секретом.
Серверный журнал сохраняет безопасные статусы. Используется существующий
образ `caddy:2.10-alpine`. TCP 443/8443 остаётся у Xray. TCP 80 используется
для ACME HTTP-01, TCP 9443 — для HTTPS; HTTP-редиректы выключены.
Основной tunnel сохраняется. Генерация новых подписок и подтверждённая
выдача новой ссылки используют прямой origin; старые URL продолжают работать.

## Установка после согласования выпуска

1. Выполнить [release-workflow](../docs/release-workflow.md), синхронизировать
   оба source. Не менять production из неопубликованной рабочей копии.
2. Создать DNS-only A-запись отдельного имени, например `sub.rilora.ru`,
   на подтверждённый DE ingress IP. Не брать IP из старой документации.
   AAAA добавлять только с проверенным IPv6. Проверить свободу и внешнюю
   доступность TCP 80/9443, не перезагружая firewall и не меняя правила VPN.
3. Задать `JARVIS_SUBSCRIPTION_DOMAIN` в приватном deploy environment:
   только имя, без схемы, порта, пути и токена. Задать также
   `JARVIS_SUBSCRIPTION_BIND_ADDRESS`: выделенный IPv4 входа. На DE использовать
   адрес основного сервера, сохранив другой адрес Hysteria2 свободным для её
   HTTP-01 renewal. Нельзя занимать TCP 80 сразу на всех адресах. Сохранить mounted inode
   Caddyfile при последующих заменах source/release по release-workflow.
4. Из принятого `deploy/` выполнить команды ниже. Не включать профиль
   `direct`: он занимает TCP 443. Не выводить разрешённый Compose config
   с настоящим environment — там могут оказаться секреты.

```bash
docker compose --env-file /home/deploy/apps/jarvis/deploy/.env \
  -f docker-compose.yml -f docker-compose.subscription-direct.yml \
  --profile tunnel --profile subscription-direct config --quiet
docker compose --env-file /home/deploy/apps/jarvis/deploy/.env \
  -f docker-compose.yml -f docker-compose.subscription-direct.yml \
  --profile tunnel --profile subscription-direct up -d --no-deps subscription-direct
```

Команда не пересоздаёт server и не меняет VPN state. После запуска проверить
сертификат со строгим TLS, без `-k`. Неизвестный искусственный токен должен
получить 404; `/mini/`, `/api/`, `/health/ready`, неверный `/happ-sub/` и POST не должны
попадать в backend. Проверить прежние server health и VPN без их перезапусков.

Установленный release DE: `/home/deploy/releases/jarvis-subscription-e56340f`.
Его приватные переменные хранятся в
`/home/deploy/.config/jarvis/subscription-direct.env`; перед обслуживанием
загрузить их в shell без вывода содержимого. Server использует также сохранённые
overlays из `deploy/.deploy-stage-config/`. Для обслуживания ingress применять
только `subscription-direct --no-deps`; не пересоздавать server неполным Compose.

## Проверка на iPhone и откат

В настройке подписки Happ заменить только origin сохранённой ссылки на
`https://<новое-имя>:9443`. Путь и существующий токен сохранить. Полную ссылку
не помещать в команды, Git, скриншоты, чат или логи. Токен не ротировать ради
проверки; старый Cloudflare URL продолжает работать.

Подтвердить четыре сервера, новое время обновления и повторный refresh в
проблемной сети. Успешный curl с VPS не заменяет проверку на телефоне. Если
прямой путь тоже даёт таймаут, обход не принят и Cloudflare нельзя объявлять
причиной. Для отката вернуть старый origin на телефоне и остановить только
`subscription-direct` теми же Compose-файлами. Volumes сертификата сохранить.

## Локальные проверки

Нужны Python 3 и Caddy 2.10.x. Только искусственные токены и loopback fixture:

```powershell
py deploy/scripts/test-subscription-direct.py --caddy C:/path/to/caddy.exe -v
```

Проверяются настоящий адаптер и HTTP proxy: методы/пути, отказ upstream для
отозванного токена, удаление browser credentials, no-store и отсутствие токена
в выводе процесса. TLS снимается только в тестовой копии конфигурации.
Настоящий ACME и iPhone проверяются после установки.
