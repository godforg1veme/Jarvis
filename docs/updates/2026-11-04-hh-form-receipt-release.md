# HH: выпуск формы и квитанции / Form and receipt rollout

[Русский](#русский) | [English](#english)

## Русский

### Установка

По поручению владельца опубликован `853d4cfb2111500244f4f101422db5a5ee736079`.
Windows и source DE/NL синхронизированы; source guard прошёл на всех узлах.
Immutable release DE: `/home/deploy/releases/jarvis-853d4cf-hh-followup`.
Server/collector используют `jarvis-hh-followup-server:853d4cf`, browser —
`jarvis-hh-followup-browser:853d4cf`. Новая миграция и сборка Desktop не нужны.

Перед переключением остановлены server/collector. После готовности нового
browser запущены новые server/collector. Окружение и mounts совпали до и после
установки; профиль HH, OCR volumes и bind-mounted секреты сохранены. В новых
образах совпали с source 386 server/shared и 53 browser/shared файла.
Server/browser healthy; restart count всех трёх контейнеров 0. Общая проверка
подтвердила source обоих VPS и установленный server, Host Agent совпал на обоих
узлах. Осталось прежнее несоответствие Desktop 1.0.2: в EXE отсутствует один
неиспользуемый shared-файл, остальные файлы/package/native runtime совпадают.
Этот серверный выпуск не меняет Desktop runtime.

В установленном browser image прошли 8/8 изолированных проверок квитанции,
формы и ledger. До выпуска прошли 941 server unit, 20/20 PostgreSQL,
134/134 Linux/Chromium; независимая ревизия завершена.
[Причины и ограничения ремонта](2026-11-04-hh-form-receipt-followup.md).

### Десятиминутное наблюдение

Окно: 21:02:33–21:12:33 МСК 4 ноября. Владелец начал с off; только его
автоматика временно включена штатным JobAutomationService с проверкой scope,
прав, выбранного резюме и revision. Установлен возврат в off через 10 минут,
если владелец сам не изменит revision. Другие аккаунты не включались.

Окно завершилось автоматически в 21:12:33 МСК; off восстановлен, revision 16.
Обработан 31 элемент: 30 пропусков (17 OUT_OF_DIRECTION, 12 UNCERTAIN,
один до оценки моделью) и одна новая application operation на вакансию 139136699.
На границе окна она ещё была unknown/JOB_HH_RECEIPT_BODY_FAILED. Поздняя
читающая сверка подтвердила sent за одну попытку; очередь тоже sent. В ledger
один original claim, одна operation для той же пары и один sent result.
Повторной отправки не было. Модель: 31 запрос, $0.0146102555, неизвестных сумм нет.

Таким образом, раннее чтение не устранило все реальные ошибки квитанции.
Новый закрытый код установил этап сбоя — response.body(), но исходное исключение
не сохранено; конкретная причина пока неизвестна. Следующая диагностика должна
различить закрытие/переход страницы, недоступность тела в Chromium и транспортный
сбой, без записи сырых исключений или нового POST по этой операции.

Вакансия 138439067 в новом consent revision 15 была пропущена оценкой; новую
живую отправку её анкеты окно не проверило. Парсер и точные ответы проверены
в fixtures и живым read-only чтением. Отмена при выключении в стадии submitting
за это окно не встретилась; её реальная проверка остаётся открытой, PG прошёл.
Шесть прежних unknown исчерпали шесть читающих попыток и сохраняют
JOB_RECONCILIATION_EXHAUSTED. Они не переотправляются и требуют ручной проверки.

При итоговой проверке 5 ноября server/browser healthy, collector running,
server/collector restart count 0. Browser restart count 1, StartedAt
4 ноября 22:57:40 МСК — после тестового окна; OOMKilled=false. Доступный лог
содержит только два JOB_BROWSER_READY, Docker events причины не сохранили.
Причина перезапуска неизвестна. Не считать это доказательством стабильности
браузера после выпуска. Автопоиск остаётся off; новое тестовое окно не запускалось.

## English

### Installation

With owner authorization, `853d4cfb2111500244f4f101422db5a5ee736079` was published.
Windows and DE/NL sources were synchronized; source guards passed on all nodes.
DE immutable release: `/home/deploy/releases/jarvis-853d4cf-hh-followup`.
Server/collector use `jarvis-hh-followup-server:853d4cf`; browser uses
`jarvis-hh-followup-browser:853d4cf`. No new migration or Desktop build is needed.

Server/collector were stopped before cutover and restarted on new images after
the new browser became healthy. Environment and mounts matched before and after
installation; HH profile, OCR volumes and secret bind mounts were retained.
New images matched 386 server/shared and 53 browser/shared source files.
Server/browser are healthy; all three containers have restart count 0. General
verification confirmed both VPS source checkouts and the installed server;
both Host Agents matched. The existing Desktop 1.0.2 discrepancy remains:
one unused shared file is absent from the EXE, while other files/package/native
runtime match. This server rollout does not change Desktop runtime.

The installed browser image passed 8/8 isolated receipt, form and ledger tests.
Pre-release verification passed 941 server units, 20/20 PostgreSQL and 134/134
Linux/Chromium checks; independent review completed.
[Repair causes and limits](2026-11-04-hh-form-receipt-followup.md).

### Ten-minute observation

Window: November 4, 21:02:33–21:12:33 MSK. The owner's initial setting was off;
only that account was temporarily enabled through JobAutomationService with
scope, access, selected resume and revision checks. Restoration to off was
scheduled after ten minutes unless the owner changed the revision. Other
accounts were not enabled.

The window ended automatically at 21:12:33 MSK; off was restored at revision 16.
It processed 31 items: 30 skips (17 OUT_OF_DIRECTION, 12 UNCERTAIN and one
before model evaluation) and one new application operation for vacancy 139136699.
At the window boundary it was still unknown/JOB_HH_RECEIPT_BODY_FAILED. A later
read-only reconciliation verified sent after one attempt; the queue is also sent.
Its ledger contains one original claim, one operation for the same pair and one
sent result. No second submission occurred. Model usage: 31 requests,
$0.0146102555, no unknown costs.

Early reading therefore did not eliminate every live receipt failure. The new
closed code identifies response.body() as the failing stage, but the original
exception was not retained; its exact cause remains unknown. Further diagnostics
must distinguish page closure/navigation, unavailable Chromium response bodies
and transport failure without retaining raw exceptions or issuing another POST
for this operation.

Under consent revision 15, vacancy 138439067 was skipped by evaluation; this
window did not verify a new live submission of its questionnaire. The parser
and exact answers passed fixtures and live read-only inspection. Disablement
at the submitting boundary did not occur during this window, so its live check
remains open; PostgreSQL checks passed. Six earlier unknown operations exhausted
six read-only attempts and retain JOB_RECONCILIATION_EXHAUSTED. They are not
resent and require manual review.

Final inspection on November 5 found server/browser healthy and collector
running; server/collector restart count 0. Browser restart count is 1, StartedAt
November 4 at 22:57:40 MSK, after the test window; OOMKilled=false. Available
logs contain only two JOB_BROWSER_READY entries, and Docker events retained no
cause. The restart cause is unknown. This does not establish post-rollout
browser stability. Automation remains off; no further test window was started.
