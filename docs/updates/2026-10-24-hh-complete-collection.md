# HH: полная выдача и восстановление CAPTCHA / Complete collection and CAPTCHA recovery

[Русский](#русский) | [English](#english)

## Русский

Общее исправление выпущено для пользователей с действующим разрешением «Работа»,
включая owner, admin и member. На DE обновлены server, collector и browser.
Исходники Windows, GitHub и обоих VPS совпадают; итоговый release-status прошёл
без замечаний. Публикация и восстановление доставки поручены владельцем.

У остановки CAPTCHA и неполной выдачи были разные причины. Скрытый штатный branded
блок вакансии не читался при проверке исходной страницы. Отдельно сборщик считал
обрезанный pager HH повреждённой страницей и останавливался до обработки карточек.
Кроме того, фоновая передача CAPTCHA требовала подключённый HH-аккаунт даже для
публичного поиска. Ранее доставленные 71 карточка участника сохранены.

Поиск использует проверенные на HH `date_from`/`date_to` в формате DD.MM.YYYY по МСК.
Выдача свыше 2000 результатов делится по календарным дням. Обрезанный pager допускается
при проверенной следующей странице. Короткие проходы сохраняют страницу и позицию,
чередуют оставшиеся окна и продолжаются автоматически. Исчезнувшая вакансия не
останавливает весь поиск; локальная ошибка одного окна не блокирует другие запросы.
Старые курсоры один раз сбрасываются при переходе на календарные окна с сохранением
исходного периода. Доставка остаётся уникальной по пользователю и вакансии;
`sent` и `unknown` не переотправляются.

CAPTCHA доступна всем активным разрешённым поискам в собственном личном чате.
Неопределённый ответ не повторяется. Исходная страница должна пройти точную проверку.
Причины подготовки картинки пишутся закрытыми кодами без содержимого HH.
Если сбор не завершён, приходит одно уведомление на сохранённый проход; оно
проверяет текущий доступ и чат перед отправкой, не повторяется после потери квитанции.

Ограничения HH сохраняются: более 2000 вакансий за один день нельзя объявить полной
выдачей; такое окно остаётся незавершённым. CAPTCHA, недоступность сайта и устаревший
период также могут потребовать вмешательства. Эти состояния не продвигают checkpoint.

Живое восстановление выявило медленные ответы HH. Проход дополнительно ограничен
60 секундами между запросами, с разрешением прочитать хотя бы одну карточку после
медленного поиска. Текущий запрос завершается; сохранённый курсор переходит в
следующий проход. Это позволяет обслуживать остальных пользователей.

Проверено: server 802/802, Telegram gate 66/66; изолированные Linux Chromium → RPC →
PostgreSQL сценарии 16/16, включая роли, отзыв прав, восстановление, очереди и dedup.
Read-only проверка HH приняла дневную и широкую выдачу без отправки CAPTCHA.
Полный Linux browser suite: 103/103 без пропусков. Проверка допуска также прошла
для 104 активных пользователей; ограничение первой сотней удалено после ревизии.

### Установка и первая живая проверка

| Узел | Фактический результат |
| --- | --- |
| DE server / collector | `jarvis-hh-recovery:1ed9316`, release `1ed93169697b4d36354281ab910e5697b93eb37b`; server healthy, collector running |
| DE browser | `jarvis-hh-browser:9565e59`, healthy; 47 исходных JS-файлов сверены с принятой версией |
| DE HTTPS | `/health/live` и `/health/ready` прошли smoke |
| NL | Source обновлён; неизменённые Host Agent и VPN active и совпадают с принятым кодом |
| Desktop | 1.0.2, 146 файлов и runtime совпадают; пересборка не требовалась |

Окружение трёх сервисов сверено без вывода значений. Существующие volumes,
профили, секреты и прежние release-каталоги сохранены. Схема БД не менялась.
Изолированные тестовые БД, сеть и временный source удалены.

Read-only статус CAPTCHA владельца и участника — `idle`: прежняя пауза снята.
При последней проверке этого выпуска участнику фактически доставлены 12 новых
карточек: количество `sent` выросло с 71 до 83, столько же вакансий доступно
в профиле. Ошибка насыщенной выдачи снята,
`hh_calendar_v1` применён. Шесть оставшихся окон и исходный период сохранены;
checkpoint остаётся пустым до полного обхода. Полная выгрузка ещё не завершена,
сбор и доставка продолжаются штатным фоновым процессом. Это контрольный срез
выпуска, а не счётчик в реальном времени. GitHub main и оба VPS source после
записи результата — `81b834d`; работающий runtime остаётся на `1ed9316`,
поскольку следующий коммит менял только документацию. Живые нажатия телефона
и следующий CAPTCHA-цикл отдельно не проверялись.

Эта запись продолжает [локальный ремонт CAPTCHA](2026-10-23-hh-captcha-recovery-development.md).
Решение и критерии: [спецификация](../superpowers/specs/2026-10-23-hh-complete-collection-design.md).

## English

A shared repair is deployed for users with current jobs permission, including owner,
admin and member. DE server, collector and browser are updated. Windows, GitHub and
both VPS sources match; the final release-status passed without issues. The owner
authorized publication and delivery recovery.

CAPTCHA recovery and incomplete collection had separate causes. The exact target
verification could not read HH's standard hidden branded description. Separately,
the collector treated HH's cropped pager as a broken page and stopped before reading
cards. Background CAPTCHA handover also required a connected HH account even for
public search. The member's 71 previously delivered cards are preserved.

Search uses HH-verified DD.MM.YYYY `date_from`/`date_to` in Moscow time. Searches above
2000 results split along calendar days. Cropped pagers are accepted with a verified
next page. Bounded passes retain page and item offsets, rotate unfinished windows,
and continue automatically. A removed vacancy does not stop collection; a local
window failure does not block other queries. Legacy cursors reset once when moving
to calendar windows while retaining the original range. Delivery remains unique per
user and vacancy; `sent` and `unknown` are never resent.

CAPTCHA handover covers all active permitted searches in their own private chats.
An uncertain answer is never repeated. The original target must pass exact reading
verification. Preparation failures use closed diagnostic codes without HH content.
An incomplete run receives one durable notice. Current permission and chat are
checked before sending; lost acknowledgement does not cause another send.

HH limits remain: a day with more than 2000 vacancies cannot be declared complete
and remains pending. CAPTCHA, site failures and expired search ranges may also need
intervention. These conditions never advance the checkpoint.

Live recovery exposed slow HH responses. Passes also have a 60-second budget checked
between requests, while allowing at least one detail read after a slow listing.
The current request finishes and its cursor is saved for the next pass, allowing
other users to proceed.

Verified: server 802/802, Telegram gate 66/66; isolated Linux Chromium → RPC → PostgreSQL
scenarios 16/16, covering roles, revocation, recovery, queues and deduplication.
Read-only HH checks accepted daily and broad searches without submitting CAPTCHA.
The complete Linux browser suite passed 103/103 without skips. Eligibility also passed
with 104 active users; the first-100 limit was removed after independent review.

### Deployment and first live check

| Node | Actual result |
| --- | --- |
| DE server / collector | `jarvis-hh-recovery:1ed9316`, release `1ed93169697b4d36354281ab910e5697b93eb37b`; server healthy, collector running |
| DE browser | `jarvis-hh-browser:9565e59`, healthy; 47 source JS files compared with the accepted code |
| DE HTTPS | `/health/live` and `/health/ready` passed smoke |
| NL | Source updated; unchanged Host Agent and VPN services are active and match accepted code |
| Desktop | 1.0.2, 146 files and runtime match; no rebuild needed |

The environments of all three services were compared without printing values.
Existing volumes, profiles, secrets and previous release directories were retained.
The database schema did not change. Isolated test databases, network and temporary
source were removed.

Read-only CAPTCHA status is `idle` for owner and member: the previous pause cleared.
At the final check of this rollout, the member actually received 12 new cards:
`sent` increased from 71 to 83, with the same number available in the profile.
The saturated-search failure cleared and
`hh_calendar_v1` applied. Six unfinished windows and the original range are retained;
the checkpoint stays empty until full traversal. Complete delivery is still pending;
collection and delivery continue through the normal background worker. This is a
release snapshot rather than a live counter. GitHub main and both VPS sources
after recording results were `81b834d`; runtime remains on `1ed9316` because the
following commit changed documentation only. Physical
phone actions and the next CAPTCHA cycle were not separately tested.

This record follows the [local CAPTCHA repair](2026-10-23-hh-captcha-recovery-development.md).
Design and acceptance criteria: [specification](../superpowers/specs/2026-10-23-hh-complete-collection-design.md).
