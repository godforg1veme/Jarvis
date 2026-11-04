# HH: проверка withoutTest / HH withoutTest validation

[Русский](#русский) | [English](#english)

## Русский

### Причина и область ремонта

4 ноября два обычных отклика остановились с `JOB_HH_SUBMISSION_BLOCKED`.
В отдельном временном Chromium с копией сессии все изменяющие запросы
безусловно блокировались. На обеих формах единственное несовпадение с
валидатором — `withoutTest`. Форма вакансии 138486454 отправила `no`, а код
требовал `yes`; изменение только этого поля в памяти дало валидный запрос.
Вакансия 138530283 остановилась на том же поле. Временные профили удалены;
диагностика не отправляла отклики и не меняла исходные операции.

Общий `submissionProtocol.js` теперь требует `withoutTest=no` для обычного
отклика и поддерживаемой нативной анкеты. `yes` отклоняется. Проверки аккаунта,
вакансии, выбранного резюме, точного письма, ответов и контрольных точек
сохраняются. Код общий для всех аккаунтов; переключатели других пользователей
не меняются. Старые `manual_required` и `unknown` не отправляются заново.

Тестовая обычная форма прежде формировала `yes` и закрепляла ошибочное
предположение. Теперь она отражает наблюдаемый запрос. Регрессии проверяют
multipart и urlencoded с `no`, запрещённые значения/отсутствие флага,
чужие данные и непорученные поля анкеты.

### Проверки и выпуск

До публикации: Windows browser suite — 114 passed, 11 Linux-only skipped;
профильная независимая ревизия — без блокирующих замечаний, 3/3 теста.
Linux/Chromium — 128/128 без пропусков; изолированные PostgreSQL/RPC/Chromium
acceptance — 12/12 без пропусков. Проверены обычный отклик, owner/member,
точные ответы анкеты, потеря ответа и восстановление без повторного POST.
Тестовые PostgreSQL и закрытая сеть удалены.
В GitHub main опубликован `f1bf207`. Windows и source DE/NL синхронизированы;
source guard прошёл на всех трёх узлах. На DE установлен
`jarvis-hh-without-test-browser:f1bf207` из immutable release
`/home/deploy/releases/jarvis-f1bf207-hh-without-test`.
Все 51 файл browser src/shared в образе совпали с выпуском; внутри образа
прошли ещё 6/6 проверок формы и протокола.

Замена завершена 4 ноября в 15:01:51 МСК. Окружение совпало; именованные volumes
профиля и OCR, sandbox, 3 CPU и 1 GiB сохранены. При проверке mounts сценарий
остановился на сравнении массивов; отдельная сверка по точным назначениям,
именам volumes и режимам подтвердила совпадение. Server/collector корректно
остановлены перед заменой и запущены после проверки нового браузера. Browser
и server healthy, restart count браузера 0, public live/ready HTTP 200.
Остальные компоненты и Desktop не пересобирались. На NL обновлены исходники;
отдельного HH browser на NL нет.

### Пять минут на реальном аккаунте

Окно 15:02:52–15:07:52 МСК прошло на аккаунте владельца. Выключенное состояние
временно включено через `JobAutomationService` с проверкой scope, прав,
выбранного резюме, подключения и revision; работал штатный worker. В 15:07:52
автоматика возвращена в выключенное состояние, revision 8. Остальные аккаунты
не включались; исправленный код общий для них.

За окно: 25 пропусков, из них 15 `OUT_OF_DIRECTION`, 8 `UNCERTAIN` и два до
оценки моделью. Новых application operations и отправок — 0. Сделаны 23
учтённых модельных запроса на $0.0108002017; неизвестных сумм нет. Обе исходные
остановленные операции остались `manual_required/JOB_HH_SUBMISSION_BLOCKED`
с прежними ID. Старые записи и неизвестные результаты не повторялись.

При выключении ещё один item читал предварительный контекст. К 15:08:07 он
завершился как `failed`: нет evaluation, draft, operation или записи запроса
модели; завершение в 15:07:56, после выключения. Активных items не осталось.
Это не неудачная отправка HH. Точное исключение не сохранено; связь с отменой
следует из времени и ветки обработки до LLM, её нельзя выдавать за записанный
код ошибки.

Подходящих для новой отправки вакансий за пять минут не появилось. Совместимость
флага и полный fixture-путь подтверждены; успешный живой новый отклик этим
наблюдением не подтверждён.

### Что остаётся проверить

Исправление закрывает установленное несовпадение `withoutTest`. Другие
изменения формы, CAPTCHA, неподдерживаемые вопросы, приватность резюме,
неопределённый результат и ошибки релевантности остаются отдельными причинами
остановки. Успех требует подтверждённого ответа HH, а не только нажатия кнопки.

Следующие проверки и ремонты:

- Подтвердить новый обычный отклик и новую нативную анкету при подходящей
  вакансии и действующем личном согласии; owner/member проверять отдельно.
- Разобрать восемь `UNCERTAIN` на личных примерах. Сам код причины не доказывает
  ложный пропуск; ранее известный пример поздней основной обязанности описан
  в [проверке релевантности](2026-11-02-hh-core-role-relevance.md).
- Различать отмену перед LLM после личного off и настоящий сбой вместо общего
  `failed`; сохранить отзыв согласия и запрет повторов.
- Добавить закрытый под-код отказа валидатора, без body, письма, cookie и
  значений полей. Текущая причина была установлена отдельным перехватом,
  исходные попытки сохраняли только общий код.

## English

### Cause and repair scope

On November 4, two ordinary applications stopped with
`JOB_HH_SUBMISSION_BLOCKED`. A separate temporary Chromium session copied the
owner's session and unconditionally blocked every mutating request. On both
forms, `withoutTest` was the only mismatch against the validator. Vacancy
138486454 sent `no`, while the code required `yes`; changing only that field
in memory made the request valid. Vacancy 138530283 failed on the same field.
Temporary profiles were removed. Diagnosis sent no applications and changed
none of the original operations.

The shared `submissionProtocol.js` now requires `withoutTest=no` for both
ordinary applications and supported native questionnaires. `yes` is rejected.
Account, vacancy, selected resume, exact letter, answers and durable checkpoint
checks remain in place. All accounts use this code; other users' switches are
preserved. Existing `manual_required` and `unknown` operations are not resent.

The ordinary fixture previously generated `yes` and reinforced the incorrect
assumption. It now reflects the observed request. Regressions cover multipart
and urlencoded `no`, forbidden/missing flags, different bound data and
unapproved questionnaire fields.

### Verification and rollout

Before publication: Windows browser suite — 114 passed, 11 Linux-only skipped;
independent focused review — no blocking findings, 3/3 tests passed.
Linux/Chromium passed 128/128 without skips. Isolated PostgreSQL/RPC/Chromium
acceptance passed 12/12 without skips, covering ordinary applications,
owner/member isolation, exact questionnaire answers, a lost receipt and
recovery without another POST. The disposable PostgreSQL and internal network
were removed.
GitHub main contains `f1bf207`. Windows and DE/NL source checkouts are
synchronized; source guards passed on all three nodes. DE runs
`jarvis-hh-without-test-browser:f1bf207` from the immutable release
`/home/deploy/releases/jarvis-f1bf207-hh-without-test`.
All 51 browser src/shared image files matched the release. Another 6/6 form
and protocol checks passed inside the release image.

Cutover completed on November 4 at 15:01:51 Moscow time. Environment matched;
the profile/OCR named volumes, sandbox, 3 CPUs and 1 GiB were preserved. An
array-based mount comparison stopped the first cutover script; a separate
comparison of exact destinations, volume names and access modes confirmed
matching mounts. Server/collector were stopped gracefully before replacement
and started after the new browser check. Browser/server are healthy; browser
restart count is 0; public live/ready returned HTTP 200. Other components and
Desktop were not rebuilt. NL received source updates and has no separate HH
browser runtime.

### Five minutes on the real account

The observation window ran from 15:02:52 to 15:07:52 Moscow time on the owner's
account. Its disabled setting was temporarily enabled through
`JobAutomationService`, checking scope, access, selected resume, connection and
revision; the regular worker handled candidates. Automation was disabled again
at 15:07:52, revision 8. Other accounts were not enabled; they share the repaired
code.

The window produced 25 skips: 15 `OUT_OF_DIRECTION`, 8 `UNCERTAIN` and two before
model evaluation. New application operations and sends: 0. The 23 recorded
model requests cost $0.0108002017, with no unknown amounts. Both original
stopped operations retained their IDs and
`manual_required/JOB_HH_SUBMISSION_BLOCKED` states. Old records and uncertain
outcomes were not retried.

One further item was reading prerequisite context when automation was disabled.
By 15:08:07 it had finished as `failed`, with no evaluation, draft, operation
or recorded model request. It finished at 15:07:56, after disablement, leaving
no active items. This was not a failed HH submission. The exact exception was
not retained; cancellation is inferred from timing and the pre-LLM error path,
rather than established by a stored failure code.

No suitable vacancy reached a new submission within five minutes. Flag
compatibility and the full fixture path passed; this observation does not
confirm a successful new live application.

### Remaining checks

The repair addresses the established `withoutTest` mismatch. Other form
changes, CAPTCHA, unsupported questions, resume privacy, uncertain outcomes
and relevance errors remain separate stopping conditions. Success requires a
verified HH receipt rather than a button click alone.

Next checks and repairs:

- Verify a new ordinary application and native questionnaire when a suitable
  vacancy and current personal consent are available; check owner/member
  separately.
- Review the eight `UNCERTAIN` results against private examples. A reason code
  alone does not prove a false skip. The previously known late-primary-duty
  example is recorded in the [relevance check](2026-11-02-hh-core-role-relevance.md).
- Distinguish pre-LLM cancellation after personal off from a real failure rather
  than using generic `failed`; preserve consent revocation and duplicate safety.
- Add a closed validator rejection sub-code without bodies, letters, cookies
  or field values. This cause required a separate intercepted request because
  the original attempts retained only a generic code.
