# Mini App: этап 5 / Stage 5

[Русский](#русский) | [English](#english)

## Русский

27 октября завершена оставшаяся часть этапа 5. После подтверждения в Mini App
можно загрузить или удалить свой документ, подключить или отключить устройство,
отозвать одноразовый код, создать/перенести/отменить напоминание, завершить или
снять договорённость, закрепить/скрыть/вернуть проект. Операции памяти выпущены
ранее. Команды компьютеру сохраняют существующий путь Telegram/Desktop.

Квитанция и изменение атомарны, права и сессия проверяются при каждой записи.
После потери ответа восстанавливается исходный UUID; отмена неизвестного запроса
блокирует позднее выполнение. Файлы ограничены до буферизации и готовятся вне
блокировки доступа. Коды устройств не сохраняются открытым текстом. Формы
показывают МСК, а скрытие проекта — точное время возврата через 24 часа.

Неизвестный результат выбора резюме HH после смены роли требует чтения исходной
операции и нового явного подтверждения. Сервер сверяет текущее резюме; повторного
select/raise нет. Несовпадение или отзыв права сохраняют блокировку.
[Контракт и ограничения](../superpowers/specs/2026-10-27-mini-app-stage-five.md).

Проверки: 885/885 server tests, 32/32 PostgreSQL acceptance tests, 54 файла
миграций, десять браузерных fixture-программ и отдельный настоящий browser →
Fastify → PostgreSQL → filesystem E2E. Последний включает owner/member вход,
документы, устройства, Life, потерю ответа и сверку HH после смены роли без
повторного выбора. Telegram SDK и внешний HH transport тестовые; серверные API
и БД настоящие. Сборка и экраны 390/1280 проверены. Промежуточная независимая
security-ревизия выполнена; заключительная повторная ревизия HH недоступна из-за
лимита помощников. Итог принят после проверки основным агентом и тестов.

На DE установлен image `jarvis-mini-app:6e240e5afdc8`, immutable release
`/home/deploy/releases/jarvis-mini-6e240e5afdc8`, код
`6e240e5afdc82d7c7cdc7db885e370fe63f7e54c`. В Linux-образе прошли 883 теста,
два теста с отдельной БД пропущены; локально они прошли в полном наборе 885/885.
Server healthy; подтверждены 54 миграции, включая 052, совпадение 371 серверного
файла и 24 собранных assets. Публичные live/ready, Mini App и новый JS отвечают
200; личный API и binary upload без сессии — 401. Пересоздан только server,
остальные контейнеры и эффективное окружение сохранены.

Windows и source обоих VPS синхронизированы с GitHub main. На NL отдельного
server runtime нет. На обоих узлах Host Agent совпал по 17 файлам, Host Agent,
Xray, Hysteria и VPN probe timer активны; PID VPN-сервисов не изменились.
Незавершённая HH-работа другого worktree сохранена и не опубликована. Общая
инвентаризация отмечает существующие ветки/worktrees и недоступный manifest
установленного Desktop; сравнение Desktop/wake/native runtime не подтверждено.
Windows-код этим выпуском не менялся, EXE не пересобирался и не устанавливался.

Личные production-данные проверочными операциями не изменялись. Этап 6 — два
реальных Telegram-аккаунта, WebView/cookies, узкий экран и клавиатура — открыт.

## English

October 27: the remaining part of stage 5 is complete. After confirmation in
Mini App, users can upload/delete their own documents, pair/revoke devices,
cancel one-time codes, create/reschedule/cancel reminders, complete/dismiss
commitments, and pin/hide/restore projects. Memory operations shipped earlier.
Computer commands retain the existing Telegram/Desktop path.

Receipts and mutations are atomic; every write checks current permissions and
session. Lost replies recover the original UUID; cancelling an unknown request
blocks late execution. Uploads are bounded before buffering and prepared outside
the access lock. Device codes are not stored in plaintext. Forms display MSK;
hiding a project shows its exact return time 24 hours later.

An unknown HH resume-selection result after a role change requires reading the
original operation and new explicit confirmation. The server verifies the current
resume without another select/raise. A mismatch or revoked permission retains
the block. [Contract and limits](../superpowers/specs/2026-10-27-mini-app-stage-five.md).

Validation: 885/885 server tests, 32/32 PostgreSQL acceptance tests, 54 migration
files, ten browser fixture programs and a separate real browser → Fastify →
PostgreSQL → filesystem E2E. The latter covers owner/member login, documents,
devices, Life, lost replies and HH verification after a role change without
repeating selection. Telegram SDK and external HH transport are test fixtures;
server APIs and database are real. Build and 390/1280 layouts passed. Intermediate
independent security review completed; the final HH re-review was unavailable
because helper quota was exhausted. The primary agent reviewed and accepted
the final code after testing.

DE runs image `jarvis-mini-app:6e240e5afdc8`, immutable release
`/home/deploy/releases/jarvis-mini-6e240e5afdc8`, code revision
`6e240e5afdc82d7c7cdc7db885e370fe63f7e54c`. The Linux image passed 883 tests;
two tests requiring a separate database were skipped there and passed locally
in the full 885/885 run. Server is healthy; all 54 migrations including 052,
371 server files and 24 compiled assets were verified. Public live/ready,
Mini App and the new JS return 200; personal API and binary upload without a
session return 401. Only server was recreated; other containers and effective
environment were preserved.

Windows and both VPS source checkouts match GitHub main. NL has no separate
server runtime. Both Host Agents matched 17 files; Host Agent, Xray, Hysteria
and VPN probe timers are active, with VPN service PIDs unchanged. Unfinished
HH work in another worktree was preserved and excluded from publication. The
global inventory flags existing branches/worktrees and an unavailable installed
Desktop manifest; Desktop/wake/native runtime comparison remains unverified.
This release changes no Windows client code; no EXE was rebuilt or installed.

Verification did not mutate production personal data. Stage 6 remains open:
two real Telegram accounts, WebView/cookies, narrow screens and keyboard acceptance.
