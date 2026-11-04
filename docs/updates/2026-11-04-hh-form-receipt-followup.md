# HH: форма, квитанция и отмена / Form, receipt and cancellation

[Русский](#русский) | [English](#english)

## Русский

Локальный ремонт после [десятиминутного наблюдения](2026-11-04-hh-autonomy-recovery-release.md),
ветка `codex/hh-receipt-cancellation`, база `d9c63e3`. Новые изменения ещё
не опубликованы и не установлены. Реальных откликов на этом этапе не отправляли.

Причина остановки вакансии 138439067 установлена на временной копии собственной
сессии: обычный `/applicant/vacancy_response` содержит нативную анкету HH с двумя
radio-вопросами, test-description и uidPk/guid/startTime/testRequired. Прежний
код распознавал эту структуру только на `/test`. Форма использует POST на тот
же обычный адрес. Новый обработчик распознал два вопроса при живой читающей
проверке. Все POST и WebSocket были заблокированы, исходная сессия смонтирована
только для чтения, временные копии удалены. Тексты вопросов, резюме и cookies
в отчёт не выводились.

Оба расположения используют прежний строгий native parser, hash анкеты,
проверку ответов и единственный разрешённый wire-запрос. Driver открывает
тот же адрес формы, который был проверен при inspection; действие формы должно
совпасть с ним. Произвольные поля, чужие резюме, visibility changes и внешние
анкеты не разрешаются. Живая отправка этой анкеты пока не проверена.

Отмена на границе выключения больше не объявляется неизвестной отправкой,
если сервис доказал отсутствие попытки INSERT и прежней application operation.
Repository отмечает только JOB_AUTOMATION_UNAVAILABLE до попытки INSERT,
после успешного rollback. Если INSERT уже мог состояться, lookup не удался
или исходная операция существует, неопределённость не снимается. Worker
сохраняет известную отмену как skipped без уведомления об ошибке. Конфликт
версии поиска/вакансии не считается выключением; это замечание независимой
ревизии исправлено. Старый production item 139137207 не переписывался.

Тело квитанции теперь читается сразу при событии ответа, до завершения click.
Unit fixture воспроизводит потерю тела после завершения click и проверяет
успешное раннее чтение. Это устраняет воспроизводимую гонку; конкретный exception
живого отклика 138413793 не был сохранён и остаётся неизвестным. Новые закрытые
коды различают сбой метаданных и тела. Проверки JSON, размера и принадлежности
квитанции сохранены; ошибка не разрешает новый POST и не означает успех.

Проверки: server 941 passed, две DB-only skipped; отдельные PostgreSQL 20/20;
Linux browser/Chromium 134/134 без пропусков. Проверены off во время inspection,
сохранённый исходный результат после off, возможная запись claim, оба адреса
анкеты, точные ответы, потеря квитанции и отсутствие повторного POST.
Независимая повторная ревизия новых подтверждённых дефектов не нашла.

Пробный запуск всех `*Acceptance.cjs` вместе остановлен как неподходящий:
runtime/CAPTCHA-наборы требуют отдельных пустых profile tmpfs и HTTPS/hostname
fixtures, которых этот runner не задавал. Его ошибки и прерывания не считаются
успешной проверкой. Профильный набор unit + application driver запущен отдельно
и прошёл 134/134. Временные PostgreSQL, контейнеры, сеть и staging удалены;
production БД и настройки в этом этапе не менялись.

Для установки нужен согласованный выпуск server/collector и job-browser.
Новая миграция и сборка Desktop не нужны. После установки остаётся подтвердить
новую первичную квитанцию и нативную анкету на подходящей вакансии с текущим
личным согласием. Старые неизвестные операции не переотправлять.

## English

Local follow-up to the [ten-minute observation](2026-11-04-hh-autonomy-recovery-release.md),
branch `codex/hh-receipt-cancellation`, based on `d9c63e3`. The changes are not
published or installed. This stage sent no real applications.

The stop for vacancy 138439067 was diagnosed using a temporary copy of the
owner's session. The ordinary `/applicant/vacancy_response` page contains two
native HH radio questions, test-description and uidPk/guid/startTime/testRequired.
The old code recognized this structure only on `/test`. The form POST action
uses the same ordinary path. The new reader recognized both questions in a live
read-only check. All POST and WebSocket traffic was blocked; the source session
was mounted read-only and temporary copies were removed. No question text,
resume content or cookies were included in the report.

Both locations use the existing strict native parser, questionnaire hash,
answer validation and single permitted wire request. The driver opens the same
form path checked during inspection, and the form action must match. Arbitrary
fields, foreign resumes, visibility changes and external questionnaires remain
blocked. A live submission of this questionnaire has not been verified.

Cancellation at disablement is no longer reported as an uncertain submission
when the service proves that INSERT was not attempted and no previous application
operation exists. The repository marks only JOB_AUTOMATION_UNAVAILABLE before
the INSERT attempt, after successful rollback. A possibly executed INSERT,
failed lookup or existing original operation preserves uncertainty. The worker
saves known cancellation as skipped without an error notice. Search/vacancy
revision conflicts are not treated as disablement; this independent review
finding was fixed. The old production item for 139137207 was not rewritten.

Receipt body reading now starts at the response event, before click completes.
A unit fixture reproduces body loss after click completion and verifies early
reading. This removes a reproducible race; the exact exception from the live
138413793 application was not retained and remains unknown. New closed codes
distinguish metadata and body failures. JSON, size and receipt identity checks
remain; a failure never authorizes another POST or establishes success.

Verification: server 941 passed, two DB-only skipped; separate PostgreSQL 20/20;
Linux browser/Chromium 134/134 without skips. Coverage includes disablement
during inspection, preserving an original result after off, uncertain claim
writes, both questionnaire paths, exact answers, receipt loss and no repeated
POST. Independent follow-up review found no new confirmed defect.

A trial run of all `*Acceptance.cjs` together was stopped because this runner
did not supply the separate empty profile tmpfs and HTTPS/hostname fixtures
required by runtime/CAPTCHA suites. Its errors and interruptions are not counted
as successful verification. The focused unit/application-driver suite ran
separately and passed 134/134. Temporary PostgreSQL, containers, network and
staging were removed. Production database and settings were unchanged.

Installation requires an authorized server/collector and job-browser rollout.
No new migration or Desktop build is needed. After installation, verify a new
primary receipt and native questionnaire on a suitable vacancy with current
personal consent. Do not resend old uncertain operations.
