# HH: полная выдача и восстановление CAPTCHA / Complete collection and CAPTCHA recovery

[Русский](#русский) | [English](#english)

## Русский

Подготовлено общее исправление для пользователей с действующим разрешением «Работа»,
включая owner, admin и member. Публикация и восстановление доставки поручены владельцем.
Установка и фактическая доставка будут записаны после проверки работающих компонентов.

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

Проверено: server 800/800, Telegram gate 66/66; изолированные Linux Chromium → RPC →
PostgreSQL сценарии 16/16, включая роли, отзыв прав, восстановление, очереди и dedup.
Read-only проверка HH приняла дневную и широкую выдачу без отправки CAPTCHA.
Полный Linux browser suite: 103/103 без пропусков. Установка проверяется отдельно.

Эта запись продолжает [локальный ремонт CAPTCHA](2026-10-23-hh-captcha-recovery-development.md).
Решение и критерии: [спецификация](../superpowers/specs/2026-10-23-hh-complete-collection-design.md).

## English

A shared repair is prepared for users with current jobs permission, including owner,
admin and member. The owner authorized publication and delivery recovery. Deployment
and actual delivery will be recorded after checking the running components.

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

Verified: server 800/800, Telegram gate 66/66; isolated Linux Chromium → RPC → PostgreSQL
scenarios 16/16, covering roles, revocation, recovery, queues and deduplication.
Read-only HH checks accepted daily and broad searches without submitting CAPTCHA.
The complete Linux browser suite passed 103/103 without skips. Deployment is checked separately.

This record follows the [local CAPTCHA repair](2026-10-23-hh-captcha-recovery-development.md).
Design and acceptance criteria: [specification](../superpowers/specs/2026-10-23-hh-complete-collection-design.md).
