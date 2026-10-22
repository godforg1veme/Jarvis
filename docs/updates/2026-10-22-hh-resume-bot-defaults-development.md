# Резюме HH в боте и автоподнятие по умолчанию / HH bot resumes and default raising

[Русский](#русский) | [English](#english)

## Русский

По новому запросу владельца подготовлены автоподнятие по умолчанию и кнопочный
выбор основного резюме в Telegram. Это локальные изменения; предыдущий
[выпуск](2026-10-22-hh-resume-management-release.md) на VPS пока сохраняет
отдельное включение через Mini App.

Migration 042 отделяет личное явное предпочтение от первого применения новой
политики. Подключённое собственное основное резюме получает бесплатное
автоподнятие по умолчанию. Последнее подтверждённое выключение сохраняется;
неизвестный исход и незавершённая операция не разрешают автоматический повтор.
GET/refresh/перезапуск не сбрасывают явный off. Остаются один primary, минимум
4 часа, бесплатная кнопка HH и прежний приватный durable ledger. Migration
не отправляет запросы в HH; применение политики требует актуального jobs.

В боте после подключения: «Поиск работы → Резюме HH». Показаны названия и
галочка основного; смена и выключатель ведут к предпросмотру с полным
названием и отдельному подтверждению. «Обновить список из HH» перечитывает
каталог, ошибка сохраняет прежний список. Бот и Mini App используют общие
настройки. Выключение текущего расписания работает без обращения к HH, даже
если основное удалено; другое резюме автоматически не подставляется.

Migration 043 добавляет confirmation kind `resume`, без новых guided kinds.
Callbacks содержат только UUID меню/подтверждения и индекс. Снимок привязан
к user/conversation/private chat, access stamp, revision и TTL 10 минут.
Другой пользователь, беседа, просроченный или отменённый preview и старая
revision не разрешают запись. UUID потреблённого подтверждения является
исходным ID settings-операции; неизвестный исход проверяется без повторного
select. Изменение primary делает старые подтверждения отклика неактуальными.

Независимая ревизия нашла гонку с отзывом jobs и недоступное выключение при
исчезнувшем резюме. Исправлены обе: запись выбора и её локальное сохранение
выполняются под access/owner lock; отключение текущего primary является
локальной записью без select/list RPC. Это сохраняет известную задержку других
операций на время bounded browser RPC. Потерянный ответ не разрешает повтор.

Проверено: server 787/787, PostgreSQL 32/32, включая 10 новых проверок бота
и две конкурентные проверки отзыва jobs. Focused Telegram/migrations gate —
88/88; грамматика и outbound gate — 4/4. Mini App build, Edge 1280/390 для
панели и прежний fixture 320/390/1280 прошли. Прерванное локальное выключение
также восстанавливается по исходному ID без browser RPC. Независимая ревизия
выполнена; оба подтверждённых замечания исправлены и покрыты тестами.
Реальные сообщения Telegram, изменения production и поднятия HH
не выполнялись. Для проверки на рабочем окружении потребуется выпуск server
и collector, применение 042/043 и синхронизация исходников обоих VPS. Browser
и Desktop не менялись. Настоящие нажатия и первое default-поднятие остаются
клиентской приёмкой.

## English

The owner's new request adds automatic raising by default and a button-based
primary resume selector in Telegram. These are local changes. The previous
[VPS release](2026-10-22-hh-resume-management-release.md) still uses a separate
Mini App opt-in.

Migration 042 separates explicit personal preference from initial application
of the new policy. A connected personal primary gets free raising by default.
The last confirmed off choice is preserved; unknown results and pending
operations never authorize replay. GET, refresh and restart cannot reset an
explicit off choice. One primary, a four-hour minimum, HH's free button and
the private durable ledger remain. Migration itself sends no HH requests;
policy application requires current jobs permission.

After connection, the bot offers “Job search → HH resumes”. Titles identify
the primary; selection and the separate switch show a full-title preview and
require confirmation. Refresh reads the catalog while retaining the previous
list on failure. Bot and Mini App share settings. Disabling the current schedule
works without HH access even when the primary was deleted; another resume is
never substituted automatically.

Migration 043 adds the `resume` confirmation kind with no guided kinds.
Callbacks contain only opaque menu/confirmation UUIDs and bounded indices.
Snapshots bind user/conversation/private chat, access stamp, revisions and a
ten-minute expiry. Foreign users/conversations, expired or cancelled previews
and stale revisions cannot write. The consumed confirmation UUID is the
original settings operation ID; unknown results are reconciled without
another select. Changing primary invalidates older application approvals.

Independent review found a permission-revocation race and inability to turn
raising off after a resume disappeared. Both were fixed: selection dispatch
and its local commit hold the access/owner lock, while disabling an unchanged
primary is a local setting without select/list RPC. The existing bounded
browser-RPC delay for other locked operations remains. Lost replies do not
authorize replay.

Verified: server 787/787, PostgreSQL 32/32, including ten new bot checks and
two concurrent jobs-revocation checks. Focused Telegram/migrations gate passed
88/88; callback grammar and outbound gate passed 4/4. Mini App build, panel
Edge 1280/390 and existing fixture 320/390/1280 passed. Interrupted local off
recovers by original ID without browser RPC. Independent review was completed;
both confirmed findings were corrected and covered by tests. No real Telegram
messages, production changes or HH raises were performed. Production
verification requires a server/collector rollout, migrations 042/043 and both
VPS source synchronization. Browser and Desktop are unchanged. Real taps and
the first default-enabled raise remain client acceptance checks.
