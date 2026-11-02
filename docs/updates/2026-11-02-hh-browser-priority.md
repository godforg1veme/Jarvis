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

### Выпуск и повторный замер

Код `3f9206a559b7be3b34d3b242869958f9d71f2ebb` опубликован в GitHub main.
На DE установлен `jarvis-hh-priority-browser:3f9206a` из immutable release
`/home/deploy/releases/jarvis-3f9206a-hh-priority`; замена завершена в 18:24:14 МСК.
Server остаётся `jarvis-hh-throughput-server:2c8d0df`, с установленным кэшем.
Исходники Windows и обоих VPS синхронизированы; Desktop не менялся.

Source/release guard, preflight и CAPTCHA-конфигурация прошли. Все 51 файл
browser src/shared в образе совпали с кодом. Дополнительно в новом образе прошли
19/19 тестов очереди, health, истории и driver. Сквозной набор с изолированной
PostgreSQL прошёл 11/11: автоматический отбор/письмо/отправка, нативная анкета и
восстановление без повторного POST. HH и модель в сквозных тестах — fixtures,
они не отправляют реальные отклики. Тестовая БД и закрытая сеть удалены.

При замене server/collector были остановлены с ожиданием завершения работы,
browser заменён и проверен, затем те же server/collector запущены снова.
Семь остальных container IDs сохранены. Окружение, volume профиля и остальные
mounts браузера совпали; 3 CPU и 1 GiB сохранены. Browser/server healthy,
restart count нового браузера 0; публичные live/ready HTTP 200.

| Контрольная read-only проба | До | После |
| --- | --- | --- |
| Порядок завершения | resume, history, vacancy | resume, vacancy, history |
| Завершение вакансии от начала пробы | 18,085 с | 12,094 с |
| Ожидание и чтение самой вакансии | 17,458 с | 11,466 с |
| Завершение истории от начала пробы | 14,424 с | 20,920 с |
| Завершение всех трёх чтений | 18,098 с | 20,937 с |

Вакансия завершилась на 5,991 секунды раньше (33,1% в этой пробе). Приоритет
перераспределяет ожидание в пользу вакансии; он не ускоряет суммарную работу
всех чтений. Пробы выполнены в разное время под фоновой нагрузкой, поэтому
постоянный процент ускорения из одной пары не выводится. Сам обгон истории
подтверждён реальным RPC; отсутствие голодания — тестом ограничения четырёх задач
и завершением истории в живой пробе. Начатая история по-прежнему не прерывается.

За 18:24:14–18:29:14 МСК сборщик добавил три вакансии. Новых циклов автоотклика
не было: личный переключатель выключен с 15:04:20 МСК, revision 4, до выпуска.
Настройка не менялась. Поэтому полный реальный цикл после кэша измерен по
сохранённым попыткам выше, а после установки очереди подтверждены read-only
порядок и сквозной fixture-сценарий. Нового реального успешного отклика нет.

Отдельный старый сбой истории: следующий запуск начался в 17:30:34 МСК и
завершился `JOB_HH_DOM_CHANGED` на восьмой странице в 17:32:09, до выпуска.
Это не отказ новой очереди; page 0 в read-only пробе прочитана. Полное устранение
этого parser-сбоя и ошибки форм не заявляется в результате ускорения.

Пункт 4 выполнен: CPU измерены и оставлены 3, кэш установлен, реальный полный
цикл после кэша измерен, приоритет установлен и проверен. Ошибки релевантности,
форм и классификация пауз остаются отдельными пунктами 1, 2 и 5.

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

### Deployment and repeated measurement

Code `3f9206a559b7be3b34d3b242869958f9d71f2ebb` was published to GitHub main.
DE now runs `jarvis-hh-priority-browser:3f9206a` from immutable release
`/home/deploy/releases/jarvis-3f9206a-hh-priority`; cutover completed at 18:24:14
Moscow time. Server remains `jarvis-hh-throughput-server:2c8d0df` with the cache.
Windows and both VPS source checkouts are synchronized; Desktop was unchanged.

Source/release guards, preflight and CAPTCHA configuration passed. All 51 browser
src/shared image files matched code. The new image additionally passed 19/19
queue, health, history and driver tests. An isolated PostgreSQL integration suite
passed 11/11: automatic evaluation/letter/submission, native questionnaire and
recovery without another POST. HH and model responses in those tests are fixtures;
no real applications were sent. The test database and internal network were removed.

During cutover, server/collector were stopped with drain time, the browser was
replaced and checked, and the same server/collector containers were started again.
Seven other container IDs were preserved. Browser environment, profile volume and
other mounts matched; limits remain 3 CPUs and 1 GiB. Browser/server are healthy,
the new browser has zero restarts, and public live/ready returned HTTP 200.

| Controlled read-only probe | Before | After |
| --- | --- | --- |
| Completion order | resume, history, vacancy | resume, vacancy, history |
| Vacancy completion from probe start | 18.085 s | 12.094 s |
| Vacancy request wait and read | 17.458 s | 11.466 s |
| History completion from probe start | 14.424 s | 20.920 s |
| All three reads completed | 18.098 s | 20.937 s |

The vacancy finished 5.991 seconds earlier, a 33.1% reduction in this probe.
Priority redistributes waiting in favor of the vacancy; it does not accelerate
the total work of all reads. Probes ran at different times under background load,
so one pair does not establish a sustained speedup percentage. Real RPC confirms
history overtaking; the four-task limit test and completed live history read
confirm progress for history. An active history operation is still not interrupted.

From 18:24:14 to 18:29:14 Moscow time, the collector added three vacancies. No
new automatic application cycles started: the personal toggle has been off since
15:04:20 Moscow time, revision 4, before deployment. It was not changed. Therefore
the complete real cycle after caching is measured from the saved attempts above;
after queue deployment, read-only order and complete fixture integration were
verified. There is no new verified successful live application.

A separate older history failure: its next run started at 17:30:34 Moscow time
and stopped with `JOB_HH_DOM_CHANGED` on page eight at 17:32:09, before deployment.
This is not a new-queue failure; page zero was read in the live probe. This
performance result does not claim to repair that parser failure or application forms.

Item 4 is complete: CPU limits were measured and set to 3, caching is deployed,
the complete real cycle after caching is measured, and priority is deployed and
verified. Relevance, forms and pause classification remain separate items 1, 2 and 5.
