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
Фактическая версия установки и пятиминутное наблюдение будут записаны после
проверки работающего браузера; эта запись пока не подтверждает живую отправку.

### Что остаётся проверить

Исправление закрывает установленное несовпадение `withoutTest`. Другие
изменения формы, CAPTCHA, неподдерживаемые вопросы, приватность резюме,
неопределённый результат и ошибки релевантности остаются отдельными причинами
остановки. Успех требует подтверждённого ответа HH, а не только нажатия кнопки.

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
The installed version and five-minute observation will be recorded after
checking the running browser. This record does not yet confirm a live send.

### Remaining checks

The repair addresses the established `withoutTest` mismatch. Other form
changes, CAPTCHA, unsupported questions, resume privacy, uncertain outcomes
and relevance errors remain separate stopping conditions. Success requires a
verified HH receipt rather than a button click alone.
