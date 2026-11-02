# HH: контекст отбора и ответы / Selection context and answers release

[Русский](#русский) | [English](#english)

Позднее 2 ноября: подготовлен [локальный ремонт лимита оценки](2026-11-02-hh-evaluation-token-budget.md)
после отказа по вакансии 138512145. Он ещё не установлен; ниже сохранён результат выпуска.

Later on November 2: a [local evaluation-cap repair](2026-11-02-hh-evaluation-token-budget.md)
was prepared after vacancy 138512145 failed evaluation. It is not deployed;
the original release result is retained below.

## Русский

2 ноября 2026 по поручению владельца код `bda2e592123221911e7464bc8155bd339f01d7fd`
опубликован в GitHub `main` и установлен на DE. Исходники Windows, DE и NL
синхронизированы. Последующий коммит документации не требует пересборки.
Этот результат заменяет статус «локально» в
[записи разработки](2026-11-02-hh-context-and-answers-development.md).

### Что изменилось

Оценка получает полную вакансию, все настройки поиска, результаты обычных
фильтров с причинами и неизвестными значениями, выбранное полное резюме,
подтверждённые факты и базовое письмо. Обычные исключения остаются отдельной
проверкой. Целевое направление важнее сходства отдельных навыков: упоминание AI
в продаже недвижимости не делает её вакансией по внедрению AI. Сохраняются
короткая причина решения и версии входных данных. Известный завершённый skip
может пересматриваться при новой версии поиска; unknown не переотправляется.

Автоматическое письмо использует базовый текст и отвечает на вопросы из
описания. Защита блокирует известные виды неподтверждённых карьерных обещаний
и сохраняет отрицания в цитатах. Она не доказывает истинность любого текста LLM.

При личном включённом автопоиске LLM отвечает на поддерживаемые вопросы внутри
HH: текст, один или несколько вариантов. Анкета, точные ответы и версии контекста
сохраняются до отправки; браузер проверяет их соответствие текущей форме.
Неизвестные личные факты, внешние анкеты, файлы, CAPTCHA, медиа и неподдерживаемые
смешанные поля требуют участия пользователя. Короткий личный ответ «да/нет»
без подтверждения не угадывается. Ручная отправка сохраняет подтверждение
точного письма. Текст вопросов работодателя считается недоверенным.

Причина остановки проходит через журнал операции и личное уведомление.
Отсутствующая причина остаётся неизвестной. Исходные операции по вакансиям
137477284 и 138338991 завершились `manual_required` без валидированного POST;
точная сработавшая проверка не была записана. Старое сообщение не доказывает
наличие теста. Эти операции не повторялись.

### Установка и проверки

| Компонент | Фактический результат |
| --- | --- |
| DE server и collector | `jarvis-hh-context-server:bda2e59`; server healthy, collector running |
| DE HH browser | `jarvis-hh-context-browser:bda2e59`, healthy |
| PostgreSQL | Применены `056_job_selection_context.sql` и `057_job_questionnaire_answers.sql` |
| Исходники и образы | Сервер и работающий collector: по 384 файла src/shared совпали; браузер: 49 файлов src/shared совпали. Итоговая проверка сервера также сверяет package/lock и входы сборки |
| Серверные тесты | 916 прошли, 2 пропущены без PostgreSQL; обе отдельно прошли в изолированной БД |
| Telegram gate | 78/78 |
| Linux browser и native driver | 122/122; ещё 13/13 проверок формы/RPC в выпускаемом образе |
| Изолированные PostgreSQL-наборы | 45/45 |
| Сквозные проверки | Автоответ и прежний ручной путь прошли через PostgreSQL, RPC и Chromium с сетевыми фикстурами; один POST и восстановление исходного ID |
| Работающее окружение | Публичные live/ready smoke прошли, перезапусков новых контейнеров нет; прежние env и mounts сохранены, inode секрета сохранён, шесть остальных контейнеров не заменялись |
| NL | Исходники обновлены; HH-компоненты там не запускаются |
| Desktop | Код клиента не менялся; EXE не пересобирался и не устанавливался |

Приватные настройки, личное включение автоматики и HH-профили сохранены.
Сборка браузера использует корень репозитория и allowlist Docker-контекста,
включающий `shared/jobQuestionnaire.js`. Этот новый модуль нужен серверу и
HH-браузеру; Desktop его не импортирует. Общая проверка Desktop считает весь
каталог shared частью EXE и сообщает один отсутствующий файл, без изменённых
клиентских файлов. Это зафиксированное ограничение проверки, не обновление EXE.
Остальные проверки установленного Desktop, включая Electron и wake runtime,
совпали; Host Agent на обоих VPS совпадает с принятой версией.

### Что ещё не подтверждено

Реальная отправка новой анкеты работодателю не выполнялась. Публичный JS HH
подтвердил протокол, тесты проверили исполнение, но среди 61 публичной карточки
и нескольких личных осмотров не найден доступный живой тест. Поддержка всех
вариантов HH, owner/member приёмка и новый текст внутри Telegram остаются для
живой проверки. При потере квитанции ответы не доказываются одним письмом в
истории HH: операция остаётся unknown с прежним ID, без повторной отправки.

## English

On November 2, 2026, owner-authorized code
`bda2e592123221911e7464bc8155bd339f01d7fd` was published to GitHub `main` and
installed on DE. Windows, DE and NL source checkouts are synchronized. The later
documentation commit needs no rebuild. This supersedes the local-only status in
the [development record](2026-11-02-hh-context-and-answers-development.md).

### Behavior

Evaluation receives the full vacancy, all search settings, ordinary filter
results with reasons and unknowns, complete selected resume, confirmed facts and
base letter. Existing exclusions remain independent gates. Target direction
precedes transferable skills: AI tools mentioned in property sales do not make
it an AI implementation job. A short decision reason and input versions are
stored privately. Confirmed completed skips may be reconsidered for a new search
revision; unknown outcomes are never resubmitted.

Automatic letters use the base text and answer questions in the description.
Guards block known classes of unsupported career commitments and preserve quote
negation. They do not prove arbitrary LLM output is true.

Personal enabled automation can answer supported native HH text, single-choice
and multiple-choice questions. The questionnaire, exact answers and context
versions are saved before sending and checked against the current form. Missing
personal facts, external forms, files, CAPTCHA, media and unsupported mixed fields
require user intervention. Short personal yes/no answers need confirmed support.
Manual sending retains exact-letter confirmation. Employer content is untrusted.

Stop reasons reach the operation ledger and private notification. Missing reasons
remain unknown. Original operations for vacancies 137477284 and 138338991 ended
with `manual_required` without a validated POST; the specific guard was not saved.
The old message does not establish a test existed. Neither operation was retried.

### Deployment and evidence

DE server and collector use `jarvis-hh-context-server:bda2e59`; the browser uses
`jarvis-hh-context-browser:bda2e59`. Server and browser are healthy, collector is
running, and migrations 056/057 are applied. Source comparisons matched 384
src/shared files in both server and running collector, and 49 browser src/shared files; the final server check
also covers package/lock and build inputs. Public live/ready smoke passed.
No new-container restarts occurred. Environment and mounts match their previous
state, the secret inode was preserved, and six unrelated containers were retained.
Personal consent and HH profile volumes were preserved. NL received source only.

Server tests: 916 passed, two skipped without PostgreSQL and separately passed
with an isolated database. Telegram gate: 78/78. Linux browser/native driver:
122/122; the release image also passed 13/13 focused form/RPC checks. Isolated
PostgreSQL suites: 45/45. Automatic-answer and original manual-path end-to-end
fixtures passed through PostgreSQL, RPC and Chromium, covering one POST and
recovery by the original operation ID.

The browser builds from the repository root with an allowlisted context including
`shared/jobQuestionnaire.js`. Desktop does not import this server/browser module.
The broad Desktop inventory includes all shared files and reports this one missing
module, with no changed client files. This is a recorded inventory limitation.
Other installed Desktop comparisons, Electron and wake runtime passed; Host Agent
matches on both VPS. The EXE was neither rebuilt nor installed.

### Remaining live checks

No new questionnaire was submitted to an employer. Public HH JavaScript confirmed
the protocol and fixtures exercised it, but 61 public cards and several private
read-only inspections did not expose an available live test. All live variants,
owner/member acceptance and the updated Telegram text remain unverified. When a
receipt is lost, a letter in HH history cannot prove exact questionnaire answers:
the operation stays unknown under its original ID without resubmission.
