# HH: выпуск восстановления / HH recovery rollout

[Русский](#русский) | [English](#english)

## Русский

### Установка

По поручению владельца 4 ноября опубликован `bdf416e` и синхронизированы
Windows, DE и NL. Source guard прошёл на всех трёх узлах. На DE подготовлен
immutable release `/home/deploy/releases/jarvis-bdf416e-hh-recovery` с полным
SHA `bdf416e9e3c77a99af756aa507f673125b7202f5`.

На DE установлены `jarvis-hh-recovery-server:bdf416e` для server/collector
и `jarvis-hh-recovery-browser:bdf416e`. Перед заменой остановлены server
и collector. Browser заменён с сохранением HH profile/OCR volumes; запуск
server применил миграцию 058, затем обновлён collector. Окружение и mounts
сверены до и после переключения без вывода секретов. Старые bind-mounted
секреты и их исходные пути сохранены. Новые образы совпали с source:
386 файлов server/shared и 52 browser/shared; общая release-проверка server
дополнительно проверила 388 файлов и входные файлы сборки.

Server/browser healthy, live/ready HTTP 200; после установки у всех трёх
контейнеров restart count 0. На NL обновлены исходники, HH runtime там нет.
Host Agent обоих узлов совпал по 17 файлам, службы active. Desktop runtime
не менялся. Общая проверка показывает только прежнее `DESKTOP_PAYLOAD_DIFFERS`:
один неиспользуемый shared-файл отсутствует в EXE 1.0.2; остальные 146 файлов,
package и native/wake runtime совпадают. Этот ремонт не требует сборки Desktop.

### Подтверждённое восстановление

Исходная операция отклика на вакансию 138548473 перешла из unknown в sent
за одну читающую проверку. Связанный элемент очереди тоже sent; повторной
отправки не было. Миграция выделила 13 старых известных validation failures
без draft/application в manual_required. Ещё шесть старых application
operations пока остаются unknown: они не переотправляются.

Подробности ремонта, тесты и ограничения доказательства находятся
в [отчёте разработки](2026-11-04-hh-autonomy-recovery-development.md).

### Живое наблюдение

Десятиминутное окно начато в 20:26:50 МСК. Исходное состояние владельца — off;
для теста включена только его автоматика через JobAutomationService с текущими
scope, правами, резюме и revision. Установлен автоматический возврат в off
через 10 минут, если владелец сам не изменит revision. Другие аккаунты не включались.

Первый запуск служебного наблюдателя завершился сразу из-за неверного имени
поля времени в диагностическом SELECT; off был восстановлен. Диагностический
запрос исправлен до начала полного десятиминутного окна. Это ошибка временного
наблюдателя, не сбой production worker.

Окно завершено в 20:36:50 МСК, off восстановлен, revision 14. За окно
созданы 29 элементов: 26 пропусков (17 OUT_OF_DIRECTION, 9 UNCERTAIN),
один подтверждённый новый отклик, одна ручная остановка формы и один элемент,
который на границе выключения ещё выполнял подготовку отправки. После off
этот элемент (вакансия 139137207) завершился как unknown/submission/
JOB_AUTOMATION_UNAVAILABLE. Связанного operation ID и application record нет;
отправка не начиналась. Это оставшийся дефект классификации отмены на стадии
submitting: ранняя отмена уже различается, эта граница требует отдельного ремонта.
Активных элементов окна после завершения нет.
Новый отклик на вакансию 138413793 сначала получил
JOB_HH_RECEIPT_READ_FAILED, затем за одну читающую сверку стал sent.
Ledger содержит один original claim, одну operation для той же пары и один
подтверждённый sent result. Сервер и очередь тоже sent. Модельные расходы:
33 запроса, $0.015661572, неизвестных сумм нет.

В установленном browser image дополнительно прошли 6/6 изолированных проверок
GET proof, ledger и подготовки; production-профиль в этих тестах не использовался.

Следующие проверки: разобрать чтение первичной квитанции нового отклика
(восстановление сработало, само чтение по-прежнему дало закрытый код сбоя);
разобрать форму вакансии 138439067 (manual_required/JOB_HH_FORM_CHANGED,
draft есть, application operation не создана); продолжить читающую сверку
шести старых unknown без повторного submit. Новая нативная анкета и живой
member-путь этим окном не проверены. Причина двух рестартов прежнего browser
image остаётся неизвестной; новые контейнеры за окно не перезапускались.

## English

### Installation

With owner authorization, `bdf416e` was published on November 4 and Windows,
DE and NL sources were synchronized. Source guards passed on all three nodes.
DE uses immutable release `/home/deploy/releases/jarvis-bdf416e-hh-recovery`,
full SHA `bdf416e9e3c77a99af756aa507f673125b7202f5`.

DE now runs `jarvis-hh-recovery-server:bdf416e` for server/collector and
`jarvis-hh-recovery-browser:bdf416e`. Server and collector were stopped before
replacement. Browser retained its HH profile/OCR volumes; server startup
applied migration 058, then collector was updated. Environment and mounts
matched before and after cutover without exposing secrets. Existing secret
bind mounts and their source paths were preserved. New images matched source:
386 server/shared files and 52 browser/shared files. The general server release
check also verified 388 files and build inputs.

Server/browser are healthy; live/ready return HTTP 200. All three containers
had restart count 0 after installation. NL received source updates and has no
HH runtime. Both Host Agents matched 17 files and services were active. Desktop
runtime was unchanged. The general check reports only the existing
`DESKTOP_PAYLOAD_DIFFERS`: EXE 1.0.2 lacks one unused shared file; its other
146 files, package and native/wake runtimes match. This repair needs no Desktop build.

### Confirmed recovery

The original application operation for vacancy 138548473 moved from unknown
to sent after one read-only verification. Its queue item is also sent; no
second submission was made. Migration classified 13 old known validation
failures without drafts/applications as manual_required. Six other old
application operations remain unknown and are not resent.

Implementation, tests and proof limits are recorded in the
[development report](2026-11-04-hh-autonomy-recovery-development.md).

### Live observation

The ten-minute window started at 20:26:50 MSK. The owner's initial setting was
off; only that account was enabled through JobAutomationService with current
scope, access, resume and revision checks. Automatic restoration to off was
scheduled after ten minutes unless the owner changed the revision. Other
accounts were not enabled.

The first temporary observer exited immediately because its diagnostic SELECT
used the wrong timestamp column; off was restored. The query was corrected
before the full ten-minute window began. This was a temporary observer error,
not a production worker failure.

The window ended at 20:36:50 MSK; off was restored at revision 14. It created
29 items: 26 skips (17 OUT_OF_DIRECTION, 9 UNCERTAIN), one confirmed new
application, one manual form stop and one item still preparing submission
at the disable boundary. After off, that item (vacancy 139137207) became
unknown/submission/JOB_AUTOMATION_UNAVAILABLE, with no linked operation ID
or application record; submission had not started. This is a remaining
cancellation classification defect at the submitting boundary: earlier
cancellation is distinguished, while this boundary needs a separate repair.
No active items from the window remain. The new application for vacancy 138413793 initially
received JOB_HH_RECEIPT_READ_FAILED, then became sent after one read-only
reconciliation. Its ledger holds one original claim, one operation for the
same pair and one verified sent result. Server and queue are also sent.
Model usage: 33 requests, $0.015661572, no unknown costs.

An additional 6/6 isolated GET proof, ledger and preparation checks passed in
the installed browser image without mounting the production profile.

Follow-up checks: investigate initial receipt reading for the new application
(recovery worked, but the initial read still reported a closed failure code);
inspect vacancy 138439067 form (manual_required/JOB_HH_FORM_CHANGED, draft
present, no application operation); continue read-only checks of six old
unknown operations without another submit. This window did not verify a new
native questionnaire or a live member flow. The old browser image's two
restarts remain unexplained; the new containers did not restart during the window.
