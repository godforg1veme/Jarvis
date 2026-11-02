# HH: приоритет вакансий и замер полного цикла

[Русский](#русский) | [English](#english)

## Русский

Продолжение [ускорения CPU и кэша резюме](2026-11-02-hh-throughput.md).
Владелец поручил полностью закрыть пункт 4: приоритет вакансий перед фоновой
историей и замер полного цикла. Принятый лимит остаётся 3 CPU.

### Очередь

Один HH-профиль выполняет одну операцию. Среди ожидающих задач история уступает
обычным операциям: чтению вакансии/резюме, проверке формы, отправке и сверке.
После четырёх обычных операций при ожидающей истории выполняется её старейшая
задача. Внутри каждого класса сохраняется FIFO. Уже начатая операция завершается;
публичный RPC не принимает настройки приоритета. `tail` ждёт обе очереди, включая
историю после обгона, поэтому shutdown и смена профиля сохраняют прежнюю границу.
Счётчик учитывает только операции при ожидающей истории, а не прошлый трафик.

### Проверки и исходные замеры

Linux/Chromium: 132/132 без пропусков, включая шесть новых тестов очереди,
полный browser unit-набор, историю и application driver fixtures.
Серверные RPC/history/automation регрессии: 17/17.
Дополнительная независимая ревизия оказалась недоступна из-за лимита агента;
главный агент проверил diff и потребителей `tail` самостоятельно.

Исходная read-only проба штатного owner-bound RPC: активное чтение резюме,
затем история, затем вакансия. Порядок завершения `resume, history, vacancy`.
Вакансия закончилась на 18,085 секунды от начала пробы; собственное ожидание
и чтение заняли 17,458 секунды. История закончилась на 14,424 секунды.
Проба не отправляла отклики и не сохраняла содержание страниц.

После установки кэша и до приоритетной очереди, с 14:45:42 до 14:56:04 МСК:
30 завершённых модельных отсевов, медиана полного цикла 6,909 секунды,
подготовки перед моделью 0,030 секунды. Четыре попытки с решением apply
закончились как три manual_required и одна unknown, без подтверждённой отправки:
медиана полного цикла 72,194 секунды, диапазон 69,073–92,946.
Медианы этапов: до письма от начала оценки 7,589 секунды, письмо 9,312,
после письма до результата 55,974. Последний этап включает проверки формы.
Manual/unknown не являются успешным откликом; эти отказы относятся к другим
пунктам исходного списка. Шесть быстрых немодельных отсевов исключены из
статистики модельных оценок. Это фактические попытки автоматики, не новые пробы LLM.
Фоновая история к этому времени уже завершила 29 страниц.

Установка очереди и последующий замер фиксируются после проверки работающего образа.

## English

This continues the [CPU and resume-cache optimization](2026-11-02-hh-throughput.md).
The owner requested completing item 4: vacancy priority over background history
and a complete-cycle measurement. The accepted limit remains 3 CPUs.

### Queue

Each HH profile runs one operation. Among waiting tasks, history yields to normal
operations: vacancy/resume reads, form checks, submission and reconciliation.
After four normal operations while history waits, its oldest task runs. Each
class remains FIFO. Active operations finish; public RPC accepts no priority
setting. `tail` waits for both queues, including overtaken history, preserving
shutdown and profile-selection boundaries. The counter tracks operations only
while history waits, rather than past traffic.

### Validation and baseline

Linux/Chromium: 132/132 with no skips, including six new queue tests, all browser
unit tests, history and application-driver fixtures. Server RPC/history/automation
regressions: 17/17. An additional independent review was unavailable because of
the agent usage limit; the root agent reviewed the diff and `tail` consumers.

The baseline read-only probe used standard owner-bound RPC: an active resume read,
then history, then a vacancy. Completion order was `resume, history, vacancy`.
The vacancy finished 18.085 seconds after probe start; its own wait/read took
17.458 seconds. History finished at 14.424 seconds. No application was sent and
no page content was saved.

After cache deployment and before queue priority, from 14:45:42 to 14:56:04 Moscow
time: 30 completed model-driven skips had a 6.909-second median complete cycle
and 0.030-second median preparation before the model. Four apply decisions ended
as three manual_required and one unknown, without a verified submission: median
complete cycle 72.194 seconds, range 69.073–92.946. Median stages were 7.589 seconds
from evaluation start to letter start, 9.312 for the letter, and 55.974 after the
letter to the result, including form checks. Manual/unknown outcomes are not
successful applications; those failures belong to other original checklist items.
Six fast non-model skips were excluded from model-evaluation statistics. These
were actual automation attempts, not additional LLM probes. Background history
had already completed its 29 pages.

Queue deployment and subsequent measurements will be recorded after verification
of the running image.
