# UDP-буферы VPN и проверка обхода РФ / VPN UDP buffers and RU bypass review

## Русский

По поручению владельца опубликовано изменение `32d7133` и применено на DE и NL.
Максимальные буферы `net.core.rmem_max` и `net.core.wmem_max` повышены с
212992 до 7340032 байт. Defaults не менялись. Состояние сохранено в root-only
журнале; управляемый drop-in сохраняет лимиты после загрузки sysctl. Реальная
перезагрузка VPS для проверки persistence не выполнялась.

Hysteria перезапущена последовательно на DE и NL, чтобы новые сокеты получили
увеличенные буферы. `ss` показал `rb14680064,tb14680064` на listener каждого
узла: Linux отражает удвоенный socket accounting относительно запрошенных
7340032 байт. Xray, Host Agent и контейнеры не перезапускались. Новые лимиты
не означают заранее выделенную память каждому пользователю.

Шесть тестов CLI прошли локально и на каждом Linux VPS. Проверены повторное
применение, сохранение более высоких значений, откат, продолжение прерванного
применения/отката, исходные права файла и отказ при постороннем изменении.
Независимая ревизия после исправлений не нашла блокирующих дефектов.
37 тестов существующей маршрутизации и подписок прошли без изменения их кода.
Source guard обоих VPS и публичный smoke Jarvis прошли.

После перезапуска свежие authenticated peer-пробы прошли все восемь проверок:
VLESS TCP 443/8443, Hysteria fixed UDP 443 и hopping в обоих направлениях.
Проба NL→DE записана 29 октября в 00:15:18 МСК, DE→NL — в 00:16:04 МСК.
Все три службы на обоих узлах активны. До изменения системные счётчики
переполнения UDP приёма составляли 4670 на DE и 24545 на NL; в коротком
ненагруженном интервале ошибок не прибавилось. Они относятся ко всему хосту,
не доказывают причину конкретного звонка и не являются измерением улучшения.

Ключи, токены, привязки подписок, пулы hopping, firewall и DNS не менялись.
Перевыдача и обновление подписок для серверных буферов не нужны. Основные
домены Госуслуг и «Вкусно — и точка» уже покрыты `.ru`. Подтверждённых новых
API-доменов приложения не найдено; расширять direct на сторонние CDN без
доказательств не стали. Обновлена инструкция повторного импорта отдельного
Happ routing-профиля по существующей странице активации.

Остаётся приёмка владельцем: переподключить Happ, сравнить звонок Discord и
стрим на тех же сети и узле, записать задержку под нагрузкой и реальные потери.
Также остаётся проверить приложение ресторана с активным `Jarvis RU Direct`.
Проходимость между VPS не доказывает качество маршрута пользователя.
Откат: [VPN runbook](../VPN_RESILIENCE_RUNBOOK.md#udp-socket-buffers-and-call-quality).

## English

At the owner's request, change `32d7133` was published and applied to DE and NL.
Both `net.core.rmem_max` and `net.core.wmem_max` were raised from 212992 to
7340032 bytes, leaving socket defaults unchanged. A root-only journal preserves
the baseline, while a managed sysctl drop-in persists the limits. Reboot
persistence has not been exercised on a real VPS reboot.

Hysteria was restarted on one node at a time so newly opened sockets could
request larger buffers. Both listeners reported `rb14680064,tb14680064` in
`ss`; Linux socket accounting doubles the requested 7340032-byte size. Xray,
Host Agent and application containers were not restarted. The limits do not
preallocate this memory for each user.

All six CLI tests passed locally and on each Linux VPS, covering idempotence,
preservation of higher limits, rollback, interrupted apply/rollback recovery,
original file permissions and rejection of foreign changes. Independent review
found no remaining blockers. All 37 existing routing/subscription tests passed;
their application code was unchanged. Both source guards and public smoke passed.

Fresh authenticated peer probes after the restarts passed all eight checks:
VLESS TCP 443/8443 and Hysteria fixed UDP 443/hopping in both directions.
NL→DE was sampled at 00:15:18 MSK on October 29; DE→NL at 00:16:04 MSK.
All three services are active on each node. Before tuning, cumulative host UDP
receive-buffer errors were 4670 on DE and 24545 on NL, with no increase during
a short quiet sample. These counters cover all host applications and do not
prove the cause of a particular call or an improvement after tuning.

Credentials, subscription tokens/bindings, hopping pools, firewall and DNS were
unchanged. Existing subscriptions do not need reissuance or refresh for this
server-side tuning. The `.ru` rule already covers the principal Gosuslugi and
Vkusno i Tochka domains. No additional app API domains were verified, so no
unverified CDN exclusions were added. The separate Happ routing profile's
reimport instructions were clarified.

Owner acceptance remains: reconnect Happ and compare Discord calls, streams,
loaded latency and loss on the same network/node; verify the restaurant app
with `Jarvis RU Direct` enabled. Peer reachability is not a client-quality test.
See the [runbook](../VPN_RESILIENCE_RUNBOOK.md#udp-socket-buffers-and-call-quality)
for rollback and diagnostics.

## Проверенные источники / Sources checked

- [quic-go: socket buffers](https://quic-go.net/docs/quic/optimizations/)
- [Happ: routing import and same-name profile updates](https://www.happ.su/main/dev-docs/routing)
- [Вкусно — и точка: официальный сайт приложения](https://vkusnoitochka.ru/app)
- [Apple: managed-app per-app VPN](https://support.apple.com/en-euro/guide/deployment/dep575bfed86/web)
