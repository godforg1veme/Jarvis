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

Статус установки: выпуск подготовлен; фактические SHA, образ и результаты DE/NL
будут записаны после установки. Production-операции с личными данными не нужны.
Desktop не изменён. Этап 6 — два реальных Telegram-аккаунта, WebView/cookies,
узкий экран и клавиатура — остаётся открытым.

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

Installation status: release prepared; actual SHAs, image and DE/NL results will
be recorded after installation. No production personal-data mutations are needed.
Desktop is unchanged. Stage 6 remains open: two real Telegram accounts,
WebView/cookies, narrow screens and keyboard acceptance.
