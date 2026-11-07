# HH: отказы отправки и ложное направление / Submission failures and false direction

[Русский](#русский) | [English](#english)

## Русский

Продолжение [ремонта памяти 6 ноября](2026-11-06-hh-page-cleanup.md).
На DE установлен server/collector `4836021`; browser остаётся `2a201a0`
без пересоздания. GitHub main, Windows и исходники обоих VPS сверены.
Причина самого HTTP 403 остаётся открытой; успешная новая отправка не подтверждена.

### Что произошло ночью

После полуночи 7 ноября подтверждены 14 отправок: состояние sent совпало
в PostgreSQL и приватном durable журнале browser, verified=true для каждой.
Они произошли в 00:34–01:33 МСК. Успешные автоотклики не дают отдельного
уведомления; сообщения показывают исключения. Успех доставки сам по себе
не подтверждает релевантность выбранной вакансии.

За тот же период: 325 skipped, 5 manual_required, 6 unknown после отправки,
2 unknown до создания application и 1 failed с JOB_HH_DOM_CHANGED.
Три manual остановки связаны с нехваткой подтверждённых ответов, одна —
с отдельным тестом HH, одна — с неподтверждённым намерением в письме.
Это соответствует правилу владельца: брать личные факты из резюме,
останавливать отправку при нехватке сведений.

Все шесть неопределённых отправок получили JOB_HH_RECEIPT_FORBIDDEN:
HTTP 403 без распознанного признака XSRF, origin, CAPTCHA или rate limit.
Первый — сметчик 139078272 в 01:43 МСК, затем 139159889, 139160125, 139165170,
139120691 и 139181005. После первого 403 worker не вызвал backoff и продолжил
следующие вакансии. Исходная причина самого 403 не доказана; повторять POST
под новым ID нельзя. Дополнительная сверка каждого исходного ID чтением
оставила шесть unknown. Их claims сохранены, новых отправок не было.

QA 139161274 и Python 139171674: JOB_HH_ACCESS_DENIED возник до создания
application/operation. Сообщение «Обработка прервана» относится к этой
подготовке; оно не доказывает, что отклик дошёл до HH. Item остаётся unknown
из-за уже начатой обработки моделью. В этом этапе его не переотправляем.

Сетевой incident на DE открыт 01:50:17 и закрыт 01:50:42 МСК. Он не устанавливает
причину всех 403: они наблюдались до и после этого интервала; сам HTTP-ответ
означает, что запрос получил ответ источника. VPN-сервисы не перезапускались.
Ремонт памяти сохраняет результат: за более пяти часов рабочего runtime
server/browser/collector restart=0, heap OOM=0, closed/unknown routes=0.
Контрольный heap 71 MiB при активной операции; production GC не форсировался.

### Установленные исправления

После блокирующего receipt или ошибки HH на позднем этапе worker делает
существующую паузу 15 минут в текущих user/conversation/chat/revision.
Исходный item/application остаётся unknown; пауза касается следующих вакансий.
Она не гарантирует снятия 403, повтор исходного POST и отмена согласия запрещены.

Сметчик 139078272 был ошибочно оценён как AI QA/LLM Engineer: модель сослалась
на строительные расчёты и одну строку о внедрении ИИ. Старая серверная проверка
проверяла присутствие цитат, но не доказательство целевого рабочего результата.
Вариант проверки по словам отклонён ревизией: добавление слова «модуль»
позволяло обойти его, а подходящие формулировки отсекались.

После предварительного apply теперь идёт независимая проверка основной работы
по исходным названию, описанию и запросам поиска. Резюме, письмо, факты кандидата
и первая оценка ей не передаются. Отказ останавливает письмо существующим skip;
неопределённый результат не разрешает отправку. Дополнительный вызов выполняется
только для предварительного apply и записывается отдельной строкой job_usage
под стабильным evaluation_request_id:direction до API. Обе стадии входят
в существующий месячный учёт и уведомление; порог уведомления не является лимитом.
Используются прежние GLM/provider/schema, новых зависимостей или миграций нет.
Обе оценки модельные, поэтому гарантии безошибочного отбора всех профессий нет.

Проверено на Windows и Node 22 в Linux-образе: 954 server tests прошли, два DB-only отдельно вошли в
24/24 PostgreSQL-проверки. Последние проверили настоящие draft/application,
unknown после403, паузу следующей вакансии, одинаковые IDs, изоляцию владельца
и участника, veto без письма и раздельный учёт обеих стадий.
Публичные сценарии проверены на настоящей текущей GLM: исходный сметчик,
вариант со сметным модулем/тестированием расчётов, обычная поддержка и обычный QA
отклонены; Python LLM-интеграции и системный аналитик LLM приняты. Итого 6/6,
стоимость по provider usage $0.00205326. Это запросы классификатора, без POST в HH.

### Проверка после установки

Независимые ревизии направления и границ данных завершены. В образе совпали
390 server/shared-файлов и входные файлы сборки; browser и pinned Playwright
не изменились. Env, mounts и bind inodes, ресурсные и security-настройки,
остальные сервисы сохранены. Live/ready вернули 200; перезапусков и OOM нет.
В 18 замерах окна heap составил 60–70 MiB, closed/unknown routes — 0.
NL получил исходники; HH runtime на нём не установлен. Desktop не менялся;
сохранилось прежнее расхождение одного неиспользуемого shared-файла.

В живом окне 03:41–03:51 МСК проверка человека была idle. Пять вакансий
отклонены; одна новая отправка снова получила HTTP 403. Worker поставил
15-минутную паузу (наблюдалось 893 секунды остатка), наблюдатель выключил
автопоиск на revision 28. Следующих отправок не было. Восемь строк usage
составили $0.004241008, неизвестных расходов нет. Старые unknown не повторялись.

Пауза подтверждена в production, но доставка остаётся неисправленной.
Текущий журнал сводит недоступное тело ответа, нераспознанную ошибку и общий
отказ к одному FORBIDDEN. Следующий этап — закрытые категории ответа и
исходного запроса, без текста HH, URL, cookies или токенов. Новый 403 не даёт
права повторить исходную отправку. Автопоиск оставлен выключенным.

### Следующий этап: диагностика исходного отказа

Добавлена отдельная immutable запись в приватном журнале browser: категория
размера/кодирования ответа, категория распознанной ошибки, наличие XSRF,
совпадение его тела, cookie и известного заголовка, категории Origin/Referer.
Запись проверяет владельца, исходный operation/pair claim, анкету и хэш письма.
Она не является квитанцией успеха, не меняет outcome, не открывает повторную
отправку и не выходит в RPC. Тексты HH, URL, cookies и токены не сохраняются.
Независимая security-ревизия не нашла блокеров; Linux/Chromium 160/160.
Установка этой диагностики пока не подтверждена.

Изолированная копия только собственного профиля в tmpfs остановилась на CAPTCHA
до нативного клика; мутаций не разрешено. Проверка не установила причину 403.
Рабочий профиль не менялся. Текущая read-only проверка production также вернула
manual active, revision 2691; запрошена новая проверка человека. Auto off28.

## English

This continues the [November 6 memory repair](2026-11-06-hh-page-cleanup.md).
Server/collector `4836021` are installed on DE; browser remains `2a201a0`
without recreation. GitHub main, Windows and both VPS source checkouts matched.
The HTTP 403 cause remains open; a new successful submission is not confirmed.

### Overnight evidence

After midnight on November 7, 14 applications were confirmed: PostgreSQL sent
matched the browser's private durable journal, with verified=true for each.
They occurred at 00:34–01:33 Moscow time. Successful automatic applications
are silent; notifications show exceptions. Successful delivery alone does not
establish that a vacancy was relevant.

The same window contained 325 skipped, 5 manual_required, 6 unknown after submission,
2 unknown before application creation and 1 failed with JOB_HH_DOM_CHANGED.
Three manual stops lacked confirmed questionnaire answers, one needed a separate
HH test, and one contained an unsupported personal intention in the letter.
These follow the owner's policy: use confirmed resume facts and stop when required
personal information is missing.

All six uncertain submissions returned JOB_HH_RECEIPT_FORBIDDEN: HTTP 403 without
a recognized XSRF, origin, CAPTCHA or rate-limit reason. The first was estimator
139078272 at 01:43 Moscow time, followed by 139159889, 139160125, 139165170,
139120691 and139181005. The worker failed to back off after the first 403 and
continued with later vacancies. The cause of the 403 itself remains unproven;
it never authorizes another POST under a new ID. One additional read-only check
of each original ID left all six unknown. Claims were preserved without new sends.

QA 139161274 and Python 139171674 encountered JOB_HH_ACCESS_DENIED before an
application/operation existed. Their interrupted-processing message concerns
preparation and does not prove submission to HH. The item remains unknown because
model processing already began; this stage does not resend it.

The DE network incident opened at 01:50:17 and resolved at 01:50:42 Moscow time.
It does not establish the cause of every 403: failures occurred before and after
that interval, and an HTTP response means a source response was received. VPN
services were not restarted. The memory repair still holds: over five hours of
production server/browser/collector runtime, zero restarts, zero heap OOMs and
zero closed/unknown-page routes. The observed heap was 71 MiB during an active
operation; production GC was not forced.

### Installed repairs

After a blocking receipt or a later-stage HH source error, the worker applies
the existing 15-minute backoff for the current user/conversation/chat/revision.
The original item/application stays unknown; only later vacancies are paused.
This does not guarantee that 403 disappears. Repeating the original POST or
bypassing consent is prohibited.

Estimator 139078272 was incorrectly labeled AI QA/LLM Engineer using construction
estimates and one AI-implementation line. The former server check verified quote
presence without establishing a target work deliverable. The proposed lexical check was rejected in review: adding “module” bypassed
it, while suitable wording could be rejected.

A preliminary apply is now followed by independent main-work verification using
only source title/description and search queries. Resume, letter, candidate facts
and the first verdict are excluded. A veto uses the existing skip path before
any letter; uncertainty never authorizes submission. The extra call occurs only
for preliminary apply and gets its own job_usage row under the stable
evaluation_request_id:direction before the API call. Both stages enter existing
monthly accounting and notice; the notice threshold is not a spending cap.
The same GLM/provider/schema is used, with no new dependency or migration.
Both judgments are model-based and do not guarantee perfect occupational matching.

Windows and Linux image validation on Node 22: 954 server tests passed; both DB-only cases were included in a
separate 24/24 PostgreSQL suite. It covered real drafts/applications, unknown after
403, pausing the next candidate, stable IDs, owner/member isolation, veto without
letter generation and separate billing of both stages. Public cases were also
checked against the current real GLM: the original estimator, its module/calculation-
testing variant, ordinary support and ordinary QA were rejected; Python LLM
integration and LLM systems analysis were accepted. Result 6/6, provider-reported
cost $0.00205326. These were classifier calls without any HH POST.

### Post-installation validation

Independent direction and data-boundary reviews are complete. The image matched
390 server/shared files and build inputs; browser and pinned Playwright were
unchanged. Environment, mounts and bind inodes, resource/security settings and
other services were preserved. Live/ready returned 200 with no restarts or OOMs.
Across 18 samples, heap was 60–70 MiB and closed/unknown routes stayed at zero.
NL received source only and has no HH runtime. Desktop was unchanged; the earlier
single unused shared-file mismatch remains.

During the 03:41–03:51 Moscow live window, the human-check state was idle. Five
vacancies were skipped; one new submission again returned HTTP 403. The worker
applied 15-minute backoff (893 seconds remaining were observed), and the observer
disabled automation at revision 28. No later submissions occurred. Eight usage
rows totaled $0.004241008, with no unknown costs. Old unknowns were not resent.

Production backoff is confirmed, but delivery remains unresolved. The current
journal collapses unavailable response bodies, unclassified errors and generic
refusals into FORBIDDEN. The next stage records closed response/request categories
without HH text, URLs, cookies or tokens. A new 403 never permits repeating the
original submission. Automation remains off.

### Next stage: original-refusal diagnostics

A separate immutable private browser-journal record now contains response
size/encoding and error classes, XSRF presence and body/cookie/known-header
matching, and Origin/Referer categories. It validates owner, original operation/
pair claim, questionnaire binding and letter hash. It is not a success receipt,
does not change outcome or permit resubmission, and is not exposed over RPC.
HH text, URLs, cookies and tokens are never stored. Independent security review
found no blocker; Linux/Chromium passed 160/160. Installation of this diagnostic
stage is not yet confirmed.

An isolated own-profile tmpfs copy stopped at CAPTCHA before any native click;
no mutations were allowed. This did not establish the 403 cause or change the
working profile. A current production read-only check also returned manual
active, revision 2691. A fresh human check was requested; automation stays off28.
