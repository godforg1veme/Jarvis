# Карта документации Jarvis

Текущий статус ниже опирается на записи о проверках. Правила для агентов
находятся в [AGENTS.md](../AGENTS.md), порядок публикации в
[release-workflow.md](release-workflow.md). Планы описывают намерения;
работающую версию подтверждают код, проверки и фактическое развёртывание.

## Текущее состояние

| Направление | Что подтверждено | Что ещё проверить |
| --- | --- | --- |
| Облако и память | Fastify/PostgreSQL, Telegram/Desktop text, owner-scoped memory, документы и production hybrid retrieval | Live multi-device сценарии |
| Desktop | Установлена 1.0.2; код и bundled Node соответствуют принятой версии | Живой микрофон и paired-Desktop voice |
| Telegram | Реальные owner text/voice, возврат «Миссия → Life OS»; автоматические owner/member и subscription flows | Member-client ограничения, галерея/удаление и changing actions |
| Life OS | Event Spine, Mission, Timeline, commitments, recovery и origin-bound proposals; real-PostgreSQL workflow | Реальные внешние провайдеры, изменяющий Recovery на paired Desktop |
| Vision | Camo 1280×720, два экрана, явные leases и первый memory/analysis slice локально | Развёрнутый провайдер и remote/Telegram acceptance |
| VPN | DE/NL службы активны; четыре активные подписки экспортируют четыре endpoints; VLESS 443/8443 прошёл в обе стороны | Hysteria hopping DE→NL дал смешанный результат; телефонный Happ refresh/traffic |
| VPN Supervisor | Owner-confirmed ограниченный NL Xray restart с postchecks; peer timers включены | Restore отключён; external timer failures ещё не создают Telegram incidents |
| Эксплуатация | Server, PostgreSQL и ASR healthy; hopping DNAT присутствует и сохранён в UFW на обоих узлах | Реальная проверка сохранения после reboot и автоматического ACME renewal; backups отложены владельцем |
| Дальнейшая работа | Облако и Windows являются основными частями продукта | PWA, server executors, расписания и реальные account connectors |
| Поиск работы | Поиск включён, карточки доставляются; server/browser/collector DE проверены. GitHub/Windows/DE/NL синхронизированы | Новые кнопки в живом Telegram и подтверждённый HH-отклик; [первый выпуск](updates/2026-10-15-job-search-release.md), [обновление кнопок](updates/2026-10-15-job-search-buttons.md) |

[Обновление кнопок поиска работы](updates/2026-10-15-job-search-buttons.md)
установлено на DE: включение/выключение и постоянный пункт в нижнем меню.
Также [отключён предпросмотр HH](updates/2026-10-15-job-link-previews.md)
в новых сообщениях и обработаны 260 ранее отправленных карточек.

Последняя сверка компонентов выполнена 9 октября 2026 года после публикации
единого release-workflow: Windows и оба VPS-исходника совпадают, установленный
Desktop и сервер соответствуют принятому коду. Server runtime из `52d085a`
подходит последующим изменениям документации. Подробности:
[порядок выпуска и проверка версий](updates/2026-10-09-release-workflow.md),
[VPN и подписки](updates/2026-10-08-vpn-probe-resilience.md).

## Основные документы

| Документ | Для чего читать |
| --- | --- |
| `README.md` | Назначение продукта, возможности и запуск |
| `AGENTS.md` | Короткие обязательные правила для всех агентов |
| `release-workflow.md` | Ветки, GitHub, VPS/Desktop и обновление MD; схема выпуска |
| `runtime-context.md` | Подробности облачных и Windows-подсистем, доверие и deployment records |
| `verification.md` | Команды проверок для изменённых компонентов |
| `telegram-button-architecture.md` | Routing, диагностика, доверие и обязательный pre-edit notice |
| `telegram-menu-contract.md` | Отправляемые кнопки, callbacks, confirmations и regression gate |
| `../deploy/README.md` | Установка и обслуживание Ubuntu/Compose/Host Agent |
| `VPN_RESILIENCE_RUNBOOK.md` | Проверка VLESS/Hysteria/Happ и границы доказательств |
| `VPN_SUPERVISOR_REPAIR_GUIDE.md` | Допустимый ремонт и reconciliation исходного ID |
| `VPN_PC_SETUP.md` | Настройка VPN-клиента на компьютере |

Документы из таблицы доступны в текущем каталоге; корневые README/AGENTS лежат
на уровень выше. [Skill jarvis-release](../.agents/skills/jarvis-release/SKILL.md)
использует руководство по выпуску, без независимой копии правил.

## Записи, которые объясняют нынешний статус

- [Голос и реальные Telegram-сценарии](updates/2026-09-23-telegram-dialogue-acceptance.md).
- [Life OS v2](updates/2026-09-15-jarvis-life-os-v2.md) и
  [Telegram parity](updates/2026-09-15-telegram-life-os-parity.md).
- [Первый Vision slice](updates/2026-09-09-vision-implementation.md).
- [Desktop 1.0.2 и maintenance](updates/2026-09-29-remaining-maintenance.md).
- [Частичная доступность подписок](updates/2026-09-29-subscription-partial-availability.md),
  [original-ID восстановление](updates/2026-09-29-subscription-missing-repair.md)
  и [сохранение hopping](updates/2026-09-29-hysteria-hopping-persistence.md).
- [Фактический scope мониторинга](updates/2026-09-24-vpn-monitoring-alerting-and-repair-scope.md),
  [host-bound Supervisor](updates/2026-09-24-vpn-supervisor-host-bound-callback-routing.md)
  и [таймеры/сертификат NL](updates/2026-09-24-vpn-probe-timers-and-nl-dns-acme.md).
- [Последняя VPN-сверка](updates/2026-10-08-vpn-probe-resilience.md).

## История решений

Первоначальные договорённости по поиску работы зафиксированы до реализации.
[Исходные договорённости от 14 октября 2026 года](superpowers/specs/2026-10-14-job-search-initial-agreements.md)
сохраняют согласованный контекст и открытые вопросы.
[Спецификация от 15 октября](superpowers/specs/2026-10-15-job-search-design.md)
согласована владельцем; подготовлен
[план реализации](superpowers/plans/2026-10-15-job-search.md). Локально реализуются
сбор, карточки и письма; текущий результат и ограничение API HH описаны в
[записи разработки](updates/2026-10-15-job-search-development.md). Функция не выпущена.

[Specs](superpowers/specs/) и [plans](superpowers/plans/) хранят решения и
исполнение. [Updates](updates/) хранят результаты выпусков. Ищи по подсистеме
и дате; более поздняя подтверждённая запись имеет приоритет над прежним планом.
Все прежние ссылки на `docs/specs/` и `docs/plans/` проверяй: актуальные файлы
находятся под `docs/superpowers/`.

[Прежняя подробная карта](history/2026-10-08-documentation-map.md) и
[прежний AGENTS](history/2026-10-08-agent-context.md) сохранены как архив.
Они не заменяют текущие правила и живую проверку.
