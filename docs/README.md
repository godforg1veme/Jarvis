# Карта документации Jarvis

[Русский](#русский) | [English](#english)

## Русский

Описание проекта и текущие записи переведены на два языка:
[обновление документации от 16 октября](updates/2026-10-16-bilingual-project-docs.md).
Изменения опубликованы в GitHub и получены обоими VPS; сверка исходников,
Desktop, сервера и Host Agent прошла. Отличия сохранённого образа сборщика
и наблюдение перезапуска браузера перечислены в записи обновления.

Текущий статус ниже опирается на записи о проверках. Правила для агентов
находятся в [AGENTS.md](../AGENTS.md), порядок публикации в
[release-workflow.md](release-workflow.md). Планы описывают намерения;
работающую версию подтверждают код, проверки и фактическое развёртывание.

### Текущее состояние

[Приватный журнал попыток OCR установлен на DE](updates/2026-10-18-hh-captcha-evidence.md):
картинка, ответ и закрытые результаты для разбора новых неудач. Linux browser — 62/62;
экспорт проверен, архив пока пуст. Прежние картинки и ответы восстановить нельзя.

[Лимит увеличен до трёх попыток](updates/2026-10-18-hh-captcha-three-attempts-development.md)
перед отправкой капчи владельцу: код в GitHub и на обоих VPS, browser на DE обновлён.

[Дообученный OCR HH установлен на DE](updates/2026-10-18-hh-trained-ocr-release.md):
исходное выпрямление и веса, теперь до трёх автоматических попыток перед Telegram фото,
остановка после unknown и сохранение бюджета при перезапуске. Проверены 1 709
изображений, CPU parity 73/73 и изолированные Linux browser/worker/socket.
Первая живая попытка не подтвердила доступ: автоматика остановилась, фото
отправлено владельцу. Прохождение настоящей капчи OCR пока не подтверждено.

[13 подтверждённых исправлений аудита выпущены](updates/2026-10-17-audit-remediation-release.md):
server/Operations UI на DE, Host Agent на DE/NL, Desktop пересобран и установлен.
Server image 723/723, cloud 73/73, Host Agent по 149/149 на обоих Linux-узлах;
Operations tests/build и browser fixtures прошли. Код и установленные компоненты
сверены. Живые голос, камера, changing commands и owner Operations browser
остаются для клиентской проверки; внешняя Operations-проба с VPS получила 403.

На DE установлена [панель настроек поиска с кнопками](updates/2026-10-16-job-settings-panel-release.md):
отдельные параметры, готовые значения, ввод своего, списки фраз и подтверждение
изменения. Rendering и callbacks проверены; реальные нажатия в Telegram остаются
для пользовательской проверки.

На DE установлен [учёт старых и новых откликов HH](updates/2026-10-16-job-application-tracking-release.md):
единый список, отдельные статусы отправки и работодателя, первый импорт и
обновление по кнопке. Чтение active/archived проверено; первый полный импорт
и реальные нажатия в Telegram остаются для пользовательской проверки.

На DE установлены [четыре варианта сопроводительного](updates/2026-10-16-job-letter-modes-release.md):
базовое, улучшенное с AI, кастомное без AI и с AI. Факты и примеры необязательны;
оба AI-режима учитывают их при наличии. Редактор и выбор вариантов проверены
на работающем сервере; реальные нажатия в Telegram и HH-отклик ещё не проверены.

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
| Поиск работы | После OOM установлено восстановление браузера и очереди CAPTCHA; новое фото доставлено, ответ принят, прежний сбор продолжился | [Результат выпуска](updates/2026-10-16-hh-captcha-resilience-release.md). Live HH-отклик и длительная работа под нагрузкой ещё не проверены |

[Обновление кнопок поиска работы](updates/2026-10-15-job-search-buttons.md)
установлено на DE: включение/выключение и постоянный пункт в нижнем меню.
Также [отключён предпросмотр HH](updates/2026-10-15-job-link-previews.md)
в новых сообщениях и обработаны 260 ранее отправленных карточек.

История CAPTCHA включает [OCR и одну автоматическую попытку](updates/2026-10-15-hh-captcha-recovery-release.md),
[диагностику](updates/2026-10-15-hh-ocr-diagnosis.md),
[исправление изображения](updates/2026-10-15-hh-ocr-preprocessing-development.md)
и [native запроса](updates/2026-10-16-hh-native-captcha-request.md).

По поручению владельца прежний HH web-доступ через Tailscale заменён
[ответом на фото в Telegram](updates/2026-10-16-hh-telegram-captcha.md).
Срок картинки — 10 минут; сама пауза поиска не имеет таймера. В новой схеме
распознаёт картинку владелец. В установленном 16 октября режиме автоматический
OCR не запускался; с 18 октября действует отдельный opt-in, описанный выше.
16 октября владелец подтвердил успешное прохождение капчи вручную.
Серверная проверка подтвердила результат ответа `solved`, снятие ручной паузы
и продолжение сбора: страница сменилась с 15 на 18, число отправленных карточек
выросло с 583 до 602. Это снимок приёмки, а не постоянные показатели поиска.
Прежние результаты мобильной страницы сохранены как история.

Позднее того же дня браузер перестал готовить следующую CAPTCHA после нехватки
памяти. [Исправление установлено на DE](updates/2026-10-16-hh-captcha-resilience-release.md):
новая картинка доставлена в Telegram, сервер подтвердил `solved`, idle coordinator
и продолжение прежнего progress. Запросы обновления сохраняются при сбоях;
health проверяет Chromium, а ошибки получают понятные сообщения.

Последняя сверка компонентов выполнена 16 октября 2026 года после
[выпуска сопроводительных](updates/2026-10-16-job-letter-modes-release.md):
Windows, GitHub и оба VPS-исходника совпадают; Desktop 1.0.2 и сервер соответствуют
принятому коду. Server работает из `2e1da534e80366d6644a225f5b3f5ac0b526ec7e`,
browser — из `e6fe29a7e3129a34626223df9bd6a1b980da46be`; collector сохранил прежний контейнер,
его используемые операции не менялись. Документальные коммиты не требуют пересборки.
Подробности: [выпуск восстановления HH](updates/2026-10-16-hh-captcha-resilience-release.md),
[порядок выпуска и проверка версий](updates/2026-10-09-release-workflow.md),
[VPN и подписки](updates/2026-10-08-vpn-probe-resilience.md).

### Основные документы

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

### Записи, которые объясняют нынешний статус

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

### История решений

Первоначальные договорённости по поиску работы зафиксированы до реализации.
[Исходные договорённости от 14 октября 2026 года](superpowers/specs/2026-10-14-job-search-initial-agreements.md)
сохраняют согласованный контекст и открытые вопросы.
[Спецификация от 15 октября](superpowers/specs/2026-10-15-job-search-design.md)
согласована владельцем; подготовлен
[план реализации](superpowers/plans/2026-10-15-job-search.md). На том этапе сбор,
карточки и письма реализовывались локально; результат и ограничение API HH описаны в
[записи разработки](updates/2026-10-15-job-search-development.md). На момент этой
записи функция не была выпущена; более поздний статус приведён выше.

[Specs](superpowers/specs/) и [plans](superpowers/plans/) хранят решения и
исполнение. [Updates](updates/) хранят результаты выпусков. Ищи по подсистеме
и дате; более поздняя подтверждённая запись имеет приоритет над прежним планом.
Все прежние ссылки на `docs/specs/` и `docs/plans/` проверяй: актуальные файлы
находятся под `docs/superpowers/`.

[Прежняя подробная карта](history/2026-10-08-documentation-map.md) и
[прежний AGENTS](history/2026-10-08-agent-context.md) сохранены как архив.
Они не заменяют текущие правила и живую проверку.

## English

The project description and current records now have both language versions:
[documentation update from 16 October](updates/2026-10-16-bilingual-project-docs.md).
The changes were published to GitHub and received by both VPS nodes; source,
Desktop, server, and Host Agent comparisons passed. Differences in the retained
collector image and an observed browser restart are listed in the update record.

The status below is based on verification records. [AGENTS.md](../AGENTS.md)
contains the rules for agents; [release-workflow.md](release-workflow.md)
describes publishing. Plans describe intentions. Code, checks, and actual
deployment establish what is running.

### Current status

[Private OCR attempt evidence is installed on DE](updates/2026-10-18-hh-captcha-evidence.md):
image, answer and closed outcomes for new failure analysis. Linux browser checks passed 62/62;
export works and the archive is empty. Previous images and answers cannot be recovered.

[The limit is now three attempts](updates/2026-10-18-hh-captcha-three-attempts-development.md)
before handing a challenge to the owner: code is on GitHub and both VPS nodes, and the DE browser is updated.

[Fine-tuned HH OCR is installed on DE](updates/2026-10-18-hh-trained-ocr-release.md):
original rectification and weights, now up to three automatic attempts before a Telegram
photo, unknown-result stop and a restart-safe budget. Checks cover 1,709 images,
73/73 CPU parity and isolated Linux browser/worker/socket behavior. The first live
attempt did not confirm access; automation stopped and a photo was sent to the
owner. Solving an actual HH challenge with OCR remains unconfirmed.

All [13 confirmed audit fixes are deployed](updates/2026-10-17-audit-remediation-release.md):
server/Operations UI on DE, Host Agent on DE/NL, Desktop rebuilt and installed.
The server image passed 723/723, cloud 73/73, and Host Agent 149/149 on each Linux
node; Operations tests/build and browser fixtures passed. Source and installed
components were compared. Live voice, camera, changing commands and owner
Operations browser access remain client checks; an external Operations probe
from the VPS received 403.

The [button-based job settings panel](updates/2026-10-16-job-settings-panel-release.md)
is deployed on DE: separate fields, presets, custom values, phrase lists and
explicit save confirmation. Rendering and callbacks passed; actual Telegram taps
remain for user acceptance.

[Tracking old and new HH applications](updates/2026-10-16-job-application-tracking-release.md)
is deployed on DE: a merged list, separate submission and employer states, an initial
import and explicit refresh. Active/archived reading passed; the first full import
and real Telegram taps remain for user acceptance.

[Four cover-letter modes](updates/2026-10-16-job-letter-modes-release.md)
are deployed on DE: base, AI-improved, custom without AI and custom with AI.
Facts/examples are optional and included in both AI modes when present. The
editor and mode selection were checked on the running server; real Telegram
taps and an HH application remain unverified.

| Area | Confirmed | Still to check |
| --- | --- | --- |
| Cloud and memory | Fastify/PostgreSQL, Telegram/Desktop text, owner-scoped memory, documents, and production hybrid retrieval | Live scenarios across multiple devices |
| Desktop | Version 1.0.2 installed; code and bundled Node match the accepted version | Live microphone and paired Desktop voice |
| Telegram | Real owner text/voice, Mission → Life OS return; automated owner/member and subscription flows | Member-client restrictions, gallery/deletion, and actions that change state |
| Life OS | Event Spine, Mission, Timeline, commitments, recovery, origin-bound proposals; workflow against real PostgreSQL | Real external providers and Recovery that changes state on a paired Desktop |
| Vision | Camo at 1280×720, two screens, explicit leases, and the first local memory/analysis workflow | Deployed provider and remote/Telegram acceptance |
| VPN | DE/NL services active; four active subscriptions export four endpoints; VLESS 443/8443 passed in both directions | Hysteria hopping DE→NL had mixed results; Happ refresh/traffic on a phone |
| VPN Supervisor | Limited NL Xray restart with owner confirmation and postchecks; peer timers enabled | Restore disabled; external timer failures do not yet create Telegram incidents |
| Operations | Server, PostgreSQL, and ASR healthy; hopping DNAT present and persisted in UFW on both nodes | Persistence after reboot and automatic ACME renewal; backups deferred by the owner |
| Further work | Cloud and Windows are the main product components | PWA, server executors, schedules, and real account connectors |
| Job search | Browser and CAPTCHA queue recovery installed after OOM; new photo delivered, answer accepted, existing collection resumed | [Release record](updates/2026-10-16-hh-captcha-resilience-release.md). Live HH application submission and sustained operation under load remain unchecked |

The [job-search button update](updates/2026-10-15-job-search-buttons.md) is
installed on DE, with enable/disable controls and a permanent bottom-menu entry.
[HH link previews were also disabled](updates/2026-10-15-job-link-previews.md)
in new messages, and 260 previously sent cards were updated.

The CAPTCHA history includes [OCR and one automatic attempt](updates/2026-10-15-hh-captcha-recovery-release.md),
[diagnosis](updates/2026-10-15-hh-ocr-diagnosis.md),
[image preprocessing](updates/2026-10-15-hh-ocr-preprocessing-development.md),
and the [native request fix](updates/2026-10-16-hh-native-captcha-request.md).

At the owner's request, the former HH web access through Tailscale was replaced
with [replies to Telegram photos](updates/2026-10-16-hh-telegram-captcha.md).
Images expire after 10 minutes; the search pause has no timer. The owner reads
the image in this workflow. The mode installed on 16 October did not run automatic
OCR; a separate opt-in has been active since 18 October, as described above.
On 16 October, the owner confirmed solving the CAPTCHA manually.
The server confirmed `solved`, cleared the manual pause, and resumed collection:
the page advanced from 15 to 18 and sent cards increased from 583 to 602.
These figures describe the acceptance check, not ongoing search metrics.
Earlier mobile-page results remain in the history.

Later that day, the browser stopped preparing the next CAPTCHA after running out
of memory. The [fix was installed on DE](updates/2026-10-16-hh-captcha-resilience-release.md):
a new image reached Telegram, and the server confirmed `solved`, an idle
coordinator, and continued progress from the saved position. Refresh requests
survive failures; health checks test Chromium, and failures receive clear messages.

The last component comparison was performed on 16 October 2026 after the
[cover-letter release](updates/2026-10-16-job-letter-modes-release.md).
Windows, GitHub, and both VPS source checkouts matched; Desktop 1.0.2 and the server
matched the accepted code. Server runs from `2e1da534e80366d6644a225f5b3f5ac0b526ec7e`;
browser runs from `e6fe29a7e3129a34626223df9bd6a1b980da46be`; the collector retained its existing
container because the operations it uses did not change. Documentation commits
do not require rebuilding. See the [HH recovery release](updates/2026-10-16-hh-captcha-resilience-release.md),
[release process and version checks](updates/2026-10-09-release-workflow.md),
and [VPN and subscriptions](updates/2026-10-08-vpn-probe-resilience.md).

### Main documents

| Document | Purpose |
| --- | --- |
| `README.md` | Product purpose, capabilities, and startup |
| `AGENTS.md` | Short mandatory rules for all agents |
| `release-workflow.md` | Branches, GitHub, VPS/Desktop, Markdown updates, and release flow |
| `runtime-context.md` | Cloud and Windows subsystems, trust boundaries, and deployment records |
| `verification.md` | Verification commands for changed components |
| `telegram-button-architecture.md` | Routing, diagnostics, trust, and mandatory pre-edit notice |
| `telegram-menu-contract.md` | Emitted buttons, callbacks, confirmations, and regression gate |
| `../deploy/README.md` | Ubuntu/Compose/Host Agent installation and maintenance |
| `VPN_RESILIENCE_RUNBOOK.md` | VLESS/Hysteria/Happ checks and limits of evidence |
| `VPN_SUPERVISOR_REPAIR_GUIDE.md` | Permitted repairs and reconciliation using the original ID |
| `VPN_PC_SETUP.md` | VPN client setup on the computer |

Documents in the table are in this directory; the root README/AGENTS files are
one level above. The [jarvis-release skill](../.agents/skills/jarvis-release/SKILL.md)
uses the release guide without maintaining an independent set of rules.

### Records explaining the current status

- [Voice and real Telegram scenarios](updates/2026-09-23-telegram-dialogue-acceptance.md).
- [Life OS v2](updates/2026-09-15-jarvis-life-os-v2.md) and
  [Telegram parity](updates/2026-09-15-telegram-life-os-parity.md).
- [First Vision workflow](updates/2026-09-09-vision-implementation.md).
- [Desktop 1.0.2 and maintenance](updates/2026-09-29-remaining-maintenance.md).
- [Partial subscription availability](updates/2026-09-29-subscription-partial-availability.md),
  [recovery using the original ID](updates/2026-09-29-subscription-missing-repair.md),
  and [hopping persistence](updates/2026-09-29-hysteria-hopping-persistence.md).
- [Actual monitoring scope](updates/2026-09-24-vpn-monitoring-alerting-and-repair-scope.md),
  [host-bound Supervisor](updates/2026-09-24-vpn-supervisor-host-bound-callback-routing.md),
  and [NL timers/certificate](updates/2026-09-24-vpn-probe-timers-and-nl-dns-acme.md).
- [Latest VPN comparison](updates/2026-10-08-vpn-probe-resilience.md).

### Decision history

The original job-search agreements were recorded before implementation.
The [agreements from 14 October 2026](superpowers/specs/2026-10-14-job-search-initial-agreements.md)
preserve the agreed context and open questions. The owner approved the
[15 October specification](superpowers/specs/2026-10-15-job-search-design.md),
and an [implementation plan](superpowers/plans/2026-10-15-job-search.md) was prepared.
At that stage, collection, cards, and letters were being implemented locally;
the result and HH API limitation are in the
[development record](updates/2026-10-15-job-search-development.md). The feature
had not been released when that record was written; later status appears above.

[Specs](superpowers/specs/) and [plans](superpowers/plans/) preserve decisions
and execution. [Updates](updates/) preserve release results. Search by subsystem
and date; a later confirmed record takes precedence over an earlier plan.
Check old links to `docs/specs/` and `docs/plans/`: current files are under
`docs/superpowers/`.

The [former detailed map](history/2026-10-08-documentation-map.md) and
[former AGENTS](history/2026-10-08-agent-context.md) remain archived.
Current rules and live verification take precedence over them.
