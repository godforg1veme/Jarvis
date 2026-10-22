# Почасовая история HH и актуальность приглашений

[Русский](#русский) | [English](#english)

## Русский

Обновление: [выпущено 22 октября](2026-10-22-hh-history-hourly-release.md).
Ниже сохранён результат локальной разработки до выпуска.

Подготовлено локально 22 октября 2026 по поручению владельца. На VPS не
установлено; production-данные и сообщения Telegram не менялись.

История откликов и приглашений автоматически ставится на полный обход активного
и архивного разделов каждый час после завершения предыдущего. Это относится
ко всем пользователям с действующим `jobs`, личным подключением HH, выбранным
резюме и проверенным личным Telegram scope. Не нужны включённый поиск вакансий,
его настройки или предварительное открытие списка откликов. Существующий run,
lease, checkpoint и пауза капчи сохраняются. После терминальной ошибки новая
проверка возможна через час; прежний ограниченный retry временных ошибок остаётся.
Ручное обновление продолжает работать.

Чтение использует личный browser profile. Право, подключение и scope проверяются
при постановке задания, получении страницы, запуске чтения и сохранении данных.
Запуск RPC сериализован с отзывом доступа; ожидание сетевого ответа не держит
общую блокировку управления доступом. Отзыв во время чтения запрещает запись
полученного результата.

Указанное владельцем время последней полной проверки совпало с рабочей БД:
16 октября, 23:35:04 МСК. Причина отсутствия автоматических обновлений:
завершённый run не ставился в очередь повторно. Открытие списка выполняло только
первый импорт.

У десяти приглашений со скриншота не было даты отклика. Список сортировал их по
дате импорта, а раздел active/archived при сохранении терялся. Поэтому старые
записи занимали первые позиции и показывались без указания архива. Нераспознанный
новый статус сохранял прежнее значение; отсутствие записи при следующем обходе
также не делало прежнюю подпись неподтверждённой.

Migration 044 добавляет исходную дату записи HH, раздел истории и ID полного
обхода. В сортировке используется дата HH, неизвестные даты идут после известных.
У приглашения без доказательства из последнего полного обхода или с более новым
нераспознанным статусом подпись «Приглашение не подтверждено». Архивный результат
получает «Приглашение (архив)». У каждой строки показано время проверки статуса;
подробности сохраняют историю наблюдений и различают дату записи и дату отклика.
Прежние строки не переписываются автоматически в вымышленные статусы:
до нового полного обхода они не имеют доказательства актуальности.

Проверки: 787/787 server unit, 66/66 Telegram gate, 13/13 PostgreSQL history,
4/4 history reader unit, 4/4 Edge history fixtures. Полный browser unit suite:
80 прошли, 10 платформенных пропусков на Windows, ошибок нет. PostgreSQL
запускалась отдельно на loopback с одноразовой тестовой БД. Проверены два
пользователя, точная граница часа, независимость от поиска, первая загрузка,
checkpoint, concurrency, отзыв доступа, отключение HH, архивные/неподтверждённые
приглашения, отсутствие записи и исходные даты.
Независимая ревизия обнаружила промежуток между claim и запуском RPC, в котором
мог успеть отзыв доступа. Он закрыт проверкой при dispatch; регрессия отдельно
подтвердила отказ до чтения и отказ записи при отзыве во время ответа.
Повторная ревизия и 13 PostgreSQL-сценариев прошли без подтверждённых дефектов.

Живая сверка текущих active/archived страниц HH вернула `JOB_HH_MANUAL_ACTIVE`.
Ручной режим не обходился. Значение поля HH `INVITATION` не объявляется ошибочным
без такой сверки; его прежнее чтение было детерминированным, без AI. Текущий
статус десяти записей на самом HH и настоящие нажатия Telegram не подтверждены.

Для установки нужны согласованный выпуск server/browser и migration 044.
Отдельный collector не использует изменённый код истории; EXE Desktop менять
не требуется. После установки необходимо подтвердить полный обход каждого
подключённого профиля, новые подписи и следующий почасовой запуск.

## English

Update: [deployed on October 22](2026-10-22-hh-history-hourly-release.md).
The local, pre-deployment record is retained below.

Prepared locally on October 22, 2026 at the owner's request. Not deployed;
production data and Telegram messages were not changed.

Full active and archived history becomes due one hour after completion for
every user with current `jobs` access, a personal HH connection, a selected
resume and verified private Telegram scope. Vacancy-search activation,
settings and opening the history menu are not prerequisites. Existing runs,
leases, checkpoints and CAPTCHA pauses are preserved. Terminal failures retry
after an hour; existing bounded transient retries and manual refresh remain.

Reads use personal browser profiles. Scheduling, claiming, dispatch and commit
check current access and scope. RPC dispatch is serialized with revocation;
waiting for the network response does not hold the global access-admin lock.
Revocation during a read prevents observation commits.

The production database confirmed the last complete pass at October 16,
23:35:04 Moscow time. Completed runs were never scheduled again; opening the
list only requested an initial import.

The ten screenshot invitations had no application date. Sorting substituted
import time, and storage omitted active/archive provenance. Old rows appeared
first without an archive label. Unknown newer statuses preserved old values,
and missing rows did not qualify the old invitation label.

Migration 044 stores topic creation time, history section and completed-run
proof. Sorting uses original HH dates, with unknown dates last. Invitations
without evidence from the latest full pass, or followed by an unrecognized
status, are labelled unconfirmed. Archived invitations have an archive label.
Each row shows its status-check time; details distinguish topic creation from
application time and retain observation history. Legacy rows remain unconfirmed
until a new complete pass supplies proof.

Checks: 787/787 server unit, 66/66 Telegram gate, 13/13 PostgreSQL history,
4/4 reader unit and 4/4 Edge history fixtures. Full browser unit suite passed
80 tests with 10 Windows platform skips and no failures. A separate disposable
loopback PostgreSQL database covered hourly boundaries, two users, initial
loading, disabled/missing vacancy search, checkpoints, concurrency, revoked
access, disconnection, missing rows, archived/unconfirmed status and source dates.
Independent review found and closed a claim-to-dispatch revocation race.
Regression checks confirm no dispatch after revocation and no commit when
revocation occurs during a pending read. Re-review and all 13 PostgreSQL
scenarios passed with no further confirmed defects.

Live active/archive comparison returned `JOB_HH_MANUAL_ACTIVE`; manual mode was
not bypassed. The native `INVITATION` field is not claimed to be incorrect
without live comparison. Status parsing is deterministic, without AI. The ten
records' current HH status and real Telegram client taps remain unverified.

Deployment requires server/browser rollout and migration 044. The separate
collector does not use the changed history code; Desktop rebuilding is not
needed. After rollout, verify a complete pass for each connected profile,
the new labels and the next hourly run.
