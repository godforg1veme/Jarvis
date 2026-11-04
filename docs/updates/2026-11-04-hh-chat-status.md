# HH: итоги диагностики и исправлений / Diagnosis and changes

[Русский](#русский) | [English](#english)

## Русский

Сводка поручений этого чата и проверенного состояния на 4 ноября 2026.
Подробности каждой темы остаются в связанных результатах выпуска; старые записи
описывают состояние на свою дату, а не заменяют эту итоговую сводку.

### Пять пунктов оптимизации

| Пункт | Статус | Результат и оставшиеся ограничения |
| --- | --- | --- |
| 1. Основные обязанности должны соответствовать AI/LLM-направлению | Реализован и установлен | Модель указывает профессию, точный запрос и цитаты; адаптер и worker проверяют их до письма. GPT как инструмент другой профессии недостаточен. Сохраняется приватное объяснение и версия политики. Смысл определяет LLM, поэтому ложные решения полностью не исключены. [Проверки и выпуск](2026-11-02-hh-core-role-relevance.md). |
| 2. Разобрать отказ формы по сохранённой операции без повторной отправки | Частично разобран, не закрыт | У 137477284 и 138338991 сохранён manual_required без валидированного POST; точная старая проверка не записана и достоверно не восстановлена. Новая диагностика причин и поддержка нативной анкеты установлены, но не доказывают причину старого отказа. Исходные операции не повторялись. [Результат](2026-11-02-hh-context-and-answers-release.md). |
| 3. Убрать повторное чтение резюме между оценкой и письмом | Реализован и установлен | Кэш 60 секунд, до 32 снимков, разделение user/resume/connection revision/completeness; права и подключение проверяются при каждом вызове. Параллельные запросы используют одно чтение. Правки текста прямо на HH могут появиться с задержкой до 60 секунд. [Проверки и замеры](2026-11-02-hh-throughput.md). |
| 4. Проверить CPU и приоритет вакансий перед историей | Закрыт с замерами | Проверены 1/2/3 CPU; по поручению владельца оставлены 3 CPU. Ожидающая история уступает вакансиям, но обслуживается после четырёх обычных задач; начатая операция не прерывается. Приоритет подтвердился живой read-only пробой, устойчивое ускорение всех откликов не заявляется. [Приёмка](2026-11-02-hh-browser-priority.md). |
| 5. Разделить причины ошибок вместо общей 15-минутной паузы | Не закрыт | Известные пропуски по направлению теперь не запускают общую паузу, причины новых остановок передаются в журнал. Полной классификации отказов и отдельных правил задержки для каждого класса ещё нет. |

### Другие поручения чата

Оценщик получает полный контекст: настройки и смысл обычных фильтров, их результаты
и неопределённости, вакансию, выбранное резюме, подтверждённые факты и базовое письмо.
Проверки намерений не допускают известные виды выдуманных карьерных обещаний;
они не доказывают истинность любого произвольного текста модели.

LLM может отвечать от соискателя на поддерживаемые вопросы внутри HH: текст,
один или несколько вариантов. Требуются личное включение автоматики и факты,
которыми можно обосновать ответ. Внешние анкеты, неизвестные личные факты,
файлы, CAPTCHA и неподдерживаемые поля передаются пользователю. Точные ответы
сохраняются до отправки, форма проверяется повторно. Ручной режим сохраняет
подтверждение письма. Это уже установленная возможность, но успешная реальная
отправка новой анкеты в этом чате ещё не подтверждена.
[Контракт, тесты и ограничения](2026-11-02-hh-context-and-answers-release.md).

Уведомление о недоступности для 138512145 разобрано отдельно: лимит оценки
1024 токена был израсходован на обязательный reasoning. Установлен лимит 6000
при той же модели, цене провайдера и запрете повторов. Исходная unknown-операция
не переотправлялась. [Диагностика и исправление](2026-11-02-hh-evaluation-token-budget.md).

### Скорость и качество

Переход с 1 на 2 CPU сократил среднее чтение полного резюме с 22,55 до 9,34 с.
При 3 CPU получено 9,69 с против 10,82 с в новой контрольной серии с 2 CPU;
устойчивый дополнительный выигрыш третьего CPU не доказан. В пробе очереди
вакансия завершилась за 12,094 вместо 18,085 с, но все три чтения вместе заняли
20,937 вместо 18,098 с: очередь перераспределяет ожидание.

По сохранённым циклам после кэша: 30 модельных пропусков с медианой 6,909 с;
четыре попытки отклика с медианой 72,194 с, из них три manual_required и одна
unknown. Это не четыре успешных отклика. После установки очереди личные
автоотклики уже были выключены, поэтому нового живого полного цикла не было.
Отдельный DOM-сбой истории на восьмой странице предшествует выпуску очереди
и остаётся открытым. [Периоды наблюдения и границы сравнения](2026-11-02-hh-browser-priority.md).

Итоговая проверка релевантности: 930 серверных тестов прошли, две DB-проверки
пропущены без БД; отдельный набор с PostgreSQL — 49/49. Четыре исходные
неподходящие карточки отклонены, четыре AI-примера приняты. Расширенная серия
GLM — 10/11; отдельная диагностика поздней обязанности — 1/1 без изменения кода.
Использован тестовый профиль и реальные направления: это не проверка полной
личной квалификации по живому резюме. Остаточный ложный пропуск и расходы
раскрыты в [результате](2026-11-02-hh-core-role-relevance.md).

### Что опубликовано и установлено

На момент этой сверки весь принятый код опубликован в GitHub main. Windows и
исходники DE/NL совпадают с ним; незакоммиченной работы перед обновлением этой
документации не было. Проверка установки: сервер — 386 файлов и входные файлы
сборки совпадают; оба Host Agent — по 17 файлов совпадают, службы active.

| Компонент DE | Установленный образ | Состояние |
| --- | --- | --- |
| Server | jarvis-hh-relevance-server:062edcf | healthy; включает кэш, контекст, ответы и новый отбор |
| HH browser | jarvis-hh-priority-browser:3f9206a | healthy, 3 CPU; приоритет очереди установлен |
| Collector | jarvis-hh-context-server:bda2e59 | Прежний образ; последующие изменения его кода не затрагивали |

Разные SHA компонентов ожидаемы: каждый пересобирался при изменении его кода.
Новый commit только с документацией не требует перезапуска служб. NL получил
исходники; отдельный HH server на NL не устанавливался. Desktop 1.0.2 не менялся.
Общая проверка по-прежнему отмечает DESKTOP_PAYLOAD_DIFFERS из-за отсутствующего
неиспользуемого shared/jobQuestionnaire.js; остальные 146 проверенных файлов,
package, native runtime и wake runtime совпадают. Это не полностью одинаковый
Desktop и source, но к серверным изменениям отличие не относится.

При свежей сверке автоотклики выключены, revision 4; сохранены 3285 автоматических
операций. Никакие новые отклики, личные настройки или неизвестные операции при
обновлении документации не отправлялись и не менялись. Секреты, приватные логи,
резюме и личные настройки не выгружаются в Git: опубликованы код и безопасные MD.

## English

This records the chat's requests and verified state on November 4, 2026.
Linked release records remain the detailed sources for each topic. Older records
describe their historical state rather than superseding this final overview.

### Five optimization items

| Item | Status | Result and remaining limits |
| --- | --- | --- |
| 1. Primary duties must match the AI/LLM direction | Implemented and deployed | The model supplies profession, exact query and quotations; adapter and worker verify them before drafting. Incidental GPT use in another profession is insufficient. Private reasoning and policy version are retained. The model still judges semantics, so zero erroneous decisions is not claimed. [Validation and release](2026-11-02-hh-core-role-relevance.md). |
| 2. Diagnose the saved form refusal without resubmitting | Partly investigated, open | 137477284 and 138338991 have manual_required without a validated POST; the precise historical guard was not recorded and could not be established reliably. New stop-reason diagnostics and native questionnaire support are deployed, but do not prove the old failure's cause. Original operations were not repeated. [Record](2026-11-02-hh-context-and-answers-release.md). |
| 3. Avoid rereading the resume between evaluation and drafting | Implemented and deployed | A 60-second cache holds up to 32 snapshots, separated by user/resume/connection revision/completeness. Every call rechecks access and connection; concurrent calls share one read. Direct edits on HH may take up to 60 seconds to appear. [Validation and measurements](2026-11-02-hh-throughput.md). |
| 4. Measure CPUs and prioritize vacancies over history | Completed with measurements | 1/2/3 CPUs were tested; 3 CPUs remain at the owner's request. Waiting history yields to vacancies but runs after four normal tasks. Active work is not preempted. Live read-only probes confirmed priority, not a sustained speedup of all applications. [Acceptance](2026-11-02-hh-browser-priority.md). |
| 5. Classify failures instead of a universal 15-minute pause | Open | Known direction skips no longer trigger global backoff, and new stop reasons reach the ledger. Complete failure classification and separate delay policies for each class are not implemented. |

### Other requests

The evaluator receives complete context: search settings and ordinary filter
semantics, filter results and uncertainties, vacancy, selected resume, confirmed
facts and base letter. Intent checks block known unsupported career promises;
they cannot prove the truth of every arbitrary model-generated statement.

The LLM can answer supported native HH text, single-choice and multiple-choice
questions for the applicant. This requires personally enabled automation and
facts supporting the answer. External questionnaires, unknown personal facts,
files, CAPTCHA and unsupported fields require user action. Exact answers are
saved before submission and checked against the current form. Manual mode retains
letter confirmation. The capability is deployed, but this chat has not confirmed
a successful live submission of a new questionnaire.
[Contract, tests and limits](2026-11-02-hh-context-and-answers-release.md).

The unavailability notice for 138512145 was diagnosed separately: mandatory
reasoning exhausted the 1024-token evaluation allowance. The deployed limit is
6000, preserving model, provider price constraints and no retries. The original
unknown operation was not resubmitted.
[Diagnosis and repair](2026-11-02-hh-evaluation-token-budget.md).

### Speed and quality

Moving from 1 to 2 CPUs reduced mean complete-resume reading from 22.55 to 9.34 s.
Three CPUs yielded 9.69 s versus 10.82 s in a new two-CPU control series; a sustained
third-CPU benefit was not established. The queue probe completed a vacancy in
12.094 rather than 18.085 s, while all three reads together took 20.937 rather
than 18.098 s: priority redistributes waiting time.

Saved post-cache cycles included 30 model skips with a 6.909 s median and four
application attempts with a 72.194 s median: three manual_required, one unknown.
These were not four successful applications. Personal automation was already off
when queue priority was installed, so no new live full cycle ran afterward.
A separate page-eight history DOM failure predates that release and remains open.
[Observation windows and comparison limits](2026-11-02-hh-browser-priority.md).

Final relevance validation: 930 server tests passed, two DB checks skipped without
a database; the separate PostgreSQL suite passed 49/49. Four original irrelevant
cards were rejected and four AI examples accepted. The extended GLM series passed
10/11; a separate late-duty diagnostic passed 1/1 without code changes. A synthetic
profile with real search directions was used, not the complete live personal
resume. The remaining false negative and costs are disclosed in the
[record](2026-11-02-hh-core-role-relevance.md).

### Publication and installation

At this verification, all accepted code is published in GitHub main. Windows and
DE/NL sources match it; there was no uncommitted work before this documentation
update. Installation checks matched 386 server files and build inputs, plus all
17 files in each Host Agent; their services are active.

| DE component | Installed image | State |
| --- | --- | --- |
| Server | jarvis-hh-relevance-server:062edcf | healthy; includes cache, context, answers and new selection |
| HH browser | jarvis-hh-priority-browser:3f9206a | healthy, 3 CPUs; queue priority installed |
| Collector | jarvis-hh-context-server:bda2e59 | Existing image; later changes did not affect its code |

Different component SHAs are expected: each was rebuilt when its code changed.
A documentation-only commit requires no service restart. NL received sources;
no separate HH server was installed on NL. Desktop 1.0.2 was unchanged. The general
check still reports DESKTOP_PAYLOAD_DIFFERS because unused shared/jobQuestionnaire.js
is absent; the other 146 checked files, package, native runtime and wake runtime
match. Desktop and source are therefore not completely identical, but this
difference is unrelated to the server changes.

Fresh verification found automatic applications off at revision 4 and 3285 saved
automation items. No new applications, personal settings or unknown operations
were submitted or changed while updating documentation. Secrets, private logs,
resumes and personal settings are not uploaded to Git: publication contains code
and safe Markdown records.
