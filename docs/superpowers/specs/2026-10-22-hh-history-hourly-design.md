# Почасовая история HH / Hourly HH history

## Русский

Владелец согласовал 22 октября полное автоматическое обновление истории
откликов и приглашений каждый час для всех пользователей с действующим `jobs`,
личным подключением HH и проверенной привязкой к личному Telegram-чату.
Выключенный поиск вакансий не отключает чтение истории. Пользователь, который
ещё не открывал «Отклики», также получает первое обновление.

Существующий worker читает активную и архивную историю через личный browser
profile. Планировщик создаёт новую проверку после истечения часа с завершения
предыдущей; не заменяет queued/running/paused проверку и её checkpoint.
Повтор после терминальной ошибки допускается через час, временная ошибка и
капча используют прежний ограниченный retry. Отключение HH, блокировка или
отзыв права запрещают дальнейшее чтение и запись. Очередь сохраняется в БД,
перезапуск не запускает вторую копию проверки. Ручное обновление сохраняется.

Бот должен отличать сохранённый статус от актуального результата HH. Статусы
определяет детерминированный reader, без AI. Приглашение нельзя выводить как
свежее только потому, что старая запись недавно импортирована. Нужны дата
наблюдения, правильная сортировка и проверка current/archived контекста.
Reader сохраняет исходную дату записи отдельно от даты отклика. БД сохраняет
active/archived и ID последнего полного обхода; без этого доказательства или
после нераспознанного статуса приглашение помечается неподтверждённым.
Трактовка самого `INVITATION` не меняется без сверки текущей страницы HH.

Новые кнопки, callback grammar, guided-input kinds, внешние отправки и
изменения подтверждения отклика не нужны. Выпуск на VPS требует отдельного
поручения. Чужие изменения документации сохраняются.

Проверки: fake clock на границе часа, несколько пользователей, отсутствие
истории/поисковых настроек, выключенный поиск, одновременные workers, текущий
run и checkpoint, отказ доступа/отключение HH, временная и терминальная
ошибки; fixtures реальных полей HH и Telegram-вывод со старым статусом.

## English

On October 22 the owner approved automatic full history refresh every hour
for every user with current `jobs` access, a personal HH connection and a
verified private Telegram conversation. Vacancy-search activation is
independent; users who never opened application history are included.

The existing worker reads active and archived history through each user's
profile. Scheduling becomes due one hour after completion; terminal failures
are retried after an hour. Queued/running/paused work and checkpoints remain
intact. Existing transient-error and CAPTCHA retries remain. Revoked access,
blocked users and disconnected accounts cannot read or commit observations.
The database queue survives restarts and manual refresh remains available.

The bot must distinguish saved observations from current HH results. Status
parsing is deterministic, without AI. Import time must not make an old
invitation appear recent. Verify current and archived context, sorting and
per-row observation times. Preserve topic creation separately from application
time and store active/archive section plus completed-run proof. Missing proof
or a newer unknown status makes an invitation unconfirmed. Keep native
`INVITATION` semantics unchanged until a live comparison is available.

No new buttons, callbacks, guided kinds or application confirmations are
required. Deployment needs separate authorization. Preserve unrelated edits.
Tests cover hourly boundaries, multiple users, missing prior history/search,
disabled search, concurrency, checkpoints, revocation/disconnection, retries,
HH status fixtures and Telegram presentation of historical observations.
