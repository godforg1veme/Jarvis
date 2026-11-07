# HH: отказы отправки и ложное направление / Submission failures and false direction

[Русский](#русский) | [English](#english)

## Русский

Продолжение [ремонта памяти 6 ноября](2026-11-06-hh-page-cleanup.md).
На DE установлен server/collector `4836021` и browser `0f19df2`.
GitHub main, Windows и исходники обоих VPS сверены. Browser обновлён отдельно;
server/collector при диагностических обновлениях не пересоздавались.
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
Во время этого окна прежний журнал сводил недоступное тело ответа,
нераспознанную ошибку и общий отказ к одному FORBIDDEN. Дальнейшие этапы добавили
закрытые категории ответа и
исходного запроса, без текста HH, URL, cookies или токенов. Новый 403 не даёт
права повторить исходную отправку. Автопоиск оставлен выключенным.

### Диагностика исходного отказа

Добавлена отдельная immutable запись в приватном журнале browser: категория
размера/кодирования ответа, категория распознанной ошибки, наличие XSRF,
совпадение его тела, cookie и известного заголовка, категории Origin/Referer.
Запись проверяет владельца, исходный operation/pair claim, анкету и хэш письма.
Она не является квитанцией успеха, не меняет outcome, не открывает повторную
отправку и не выходит в RPC. Тексты HH, URL, cookies и токены не сохраняются.
Независимые security/functionality-ревизии не нашли блокеров; Linux/Chromium
160/160, включая точный образ.
Диагностика `4aab2a2` установлена на DE: 59 browser-файлов и pinned bundle
сверены, env/mounts/inodes/policies сохранены, server/collector не пересозданы.
Live/ready — 200; начато десятиминутное наблюдение без новых отправок.

Изолированная копия только собственного профиля в tmpfs остановилась на CAPTCHA
до нативного клика; мутаций не разрешено. Проверка не установила причину 403.
Рабочий профиль не менялся. Read-only проверка production в 13:43 МСК также вернула
manual active, revision 2691; запрошена новая проверка человека. Auto off28.

Дополнение `2278a97` проверяет XSRF заголовка с cookie и при отсутствии токена
в теле POST. Старые записи предыдущей закрытой схемы остаются читаемыми.
Точный образ дополнения прошёл 14/14 Linux/Chromium-проверок, включая нативную
форму и durable journal; security-ревизия приняла совместимость. Дополнение установлено в release `e816e67`; это не доказательство причины403.
Наблюдение первого образа было завершено перед заменой (13 замеров, без сбоев);
для окончательного образа начато новое полное десятиминутное окно.

### Разбор уже полученного сжатого отказа

Кандидат `2dfccde` уточняет исходный403, если прежний inspector не мог прочитать
сжатый ответ или ответ без Content-Length. Он читает только сохранённый буфер
того же APIResponse в том же BrowserContext, с совпадением URL/status/UID,
Playwright1.64 и точного patched SHA. До декодирования проверяются Buffer и
размер1–32768 байт, MIME/encoding и UTF-8. Нет нового запроса, глобального поиска
по контекстам, повторной распаковки, копирования тела через RPC или сырого лога.
Несовпадение закрывает разбор; результат отправки остаётся unknown.
Playwright уже буферизовал весь ответ: лимит ограничивает новый разбор,
а не исходное потребление памяти fetch.

Независимая security-ревизия приняла границы. Точный Linux-образ прошёл158/158,
включая localhost GET fixture chunked/gzip/br/deflate, слишком большой и
невалидный UTF-8, другой контекст/URL/UID и запрет APIResponse.body(). Запросов
к HH и POST в этой фикстуре нет. Кандидат установлен в release `0f19df2`: 60 browser-файлов и patched bundle
сверены, env/mounts/inodes/policies сохранены; live/ready200, restart0.
В 14:03 МСК manual state стал idle2694. Полное выбранное резюме подтверждено;
новое живое окно начато 14:07:28 МСК на revision29 с восстановлением off после
теста и остановкой при unknown. Старые операции не повторяются.

### Живое окно 14:07–14:17 МСК

Окно завершено полностью: 11 skipped и одна новая unknown отправка с HTTP403.
Из двух предварительных apply независимая проверка разрешила один и остановила
один как UNCERTAIN. Расходы15 строк usage — $0.00791814, неопределённых расходов0.
Пауза следующих вакансий подтверждена: наблюдалось886 секунд остатка. Наблюдатель
восстановил off, revision30. Предыдущие unknown не переотправлялись.

Диагностика исходного403: малый текстовый ответ, errorClass=unclassified;
XSRF в теле, заголовке и cookie совпал; Origin/Referer относятся к HH. Явная потеря
или расхождение этих полей не подтверждены. Это не доказывает anti-bot, сетевую
блокировку или ошибку Node transport. В Jarvis14 sent за последние24 часа;
сохранённая HH-история также показывает14 за24 часа (597 всего, checked13:54 МСК).
[Официальная справка HH](https://feedback.hh.ru/knowledge-base/article/1618)
указывает200 откликов в день; достижение лимита по этим данным не подтверждено.

Контроль browser/server/collector:21 замер, heap47–62 MiB, restart/OOM0,
closed/unknown routes0, live/ready200. Окончательная проверка env/mounts/inodes/
policies и остальных служб прошла. Это стабильность runtime, не успешная доставка.
Оба VPS и GitHub/source сверены; Desktop сохранил прежний отсутствующий shared-файл.

Открыт вопрос консервативного отбора:139071223 «AI Native Product Owner»
остановлен как UNCERTAIN. Полный источник доступен:50 фрагментов, цитата о создании
продуктов с AI-агентами присутствует. Сохранённый вердикт не различает исходную
неясность модели и понижение невалидной цитаты нормализатором; повторять запрос
модели ради выяснения нельзя. Нужны закрытые метаданные этой проверки до коррекции.

Доставка остаётся открытой. Проверяется обычный браузерный transport, но простая
замена на route.continue небезопасна: Playwright пропускает redirected POST мимо
route guards. Изолированный HTTPS PoC с отдельным CDP response guard остановил
307/308 (включая другой origin):7 сценариев, исходныйPOST1, повторныхPOST0.
Это только localhost fixture, не HH и не production. Потеря CDP-сессии и надёжное
получение исходной квитанции ещё требуют проверки. Production остаётся на
route.fetch с maxRedirects0/maxRetries0; старые неизвестные операции не повторяются.

## English

This continues the [November 6 memory repair](2026-11-06-hh-page-cleanup.md).
Server/collector `4836021` and browser `0f19df2` are installed on DE.
GitHub main, Windows and both VPS source checkouts matched. Browser was updated
separately; diagnostic updates did not recreate server/collector.
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

Production backoff is confirmed, but delivery remains unresolved. During that window, the former
journal collapsed unavailable response bodies, unclassified errors and generic
refusals into FORBIDDEN. Subsequent stages record closed response/request categories
without HH text, URLs, cookies or tokens. A new 403 never permits repeating the
original submission. Automation remains off.

### Original-refusal diagnostics

A separate immutable private browser-journal record now contains response
size/encoding and error classes, XSRF presence and body/cookie/known-header
matching, and Origin/Referer categories. It validates owner, original operation/
pair claim, questionnaire binding and letter hash. It is not a success receipt,
does not change outcome or permit resubmission, and is not exposed over RPC.
HH text, URLs, cookies and tokens are never stored. Independent security review
found no blocker; Linux/Chromium passed 160/160, including the exact image. Installation of diagnostic
stage `4aab2a2` is confirmed on DE: 59 browser files and the pinned bundle
matched. Environment/mounts/inodes/policies were preserved; server/collector
were not recreated. Live/ready returned 200; a ten-minute watch without new
submissions is in progress.

An isolated own-profile tmpfs copy stopped at CAPTCHA before any native click;
no mutations were allowed. This did not establish the 403 cause or change the
working profile. A production read-only check at 13:43 Moscow time also returned manual
active, revision 2691. A fresh human check was requested; automation stays off28.

Follow-up `2278a97` compares the XSRF header with its cookie even when the POST
body has no token. Earlier closed-schema records remain readable. Its exact
image passed 14/14 Linux/Chromium cases, including the native form and durable
journal; security review accepted compatibility. This follow-up is installed
in release `e816e67` and does not itself establish the403 cause. The first-image
watch was superseded before replacement (13 samples without failures); a fresh
full ten-minute window is running for the final image.

### Classifying an already received compressed refusal

Candidate `2dfccde` refines the original403 when the former inspector could not
read a compressed response or one without Content-Length. It reads only that
APIResponse's existing buffer in the same BrowserContext, with matching URL/
status/UID, Playwright1.64 and exact patched SHA. Buffer type and1–32768 byte
size are checked before decoding, with MIME/encoding and UTF-8 checks. There is
no new request, global context search, second decompression, body RPC copy or
raw log. A mismatch closes inspection; submission outcome remains unknown.
Playwright has already buffered the full response: this limit bounds new
inspection, not the original fetch memory use.

Independent security review accepted the boundary. The exact Linux image passed
158/158, including localhost GET fixtures for chunked/gzip/br/deflate, oversize,
invalid UTF-8, wrong context/URL/UID and forbidden APIResponse.body(). The fixture
has no HH requests or POST. The candidate is installed in release `0f19df2`: 60 browser files and the patched
bundle matched, environment/mounts/inodes/policies were preserved, live/ready200
and restart0. Manual state became idle2694 at14:03 Moscow time. The complete
selected resume was verified. A fresh live window started at14:07:28 Moscow time
on revision29, restoring off after the test and stopping on unknown. Old
operations are never resent.

### Live window14:07–14:17 Moscow time

The full window completed:11 skipped and one new unknown submission with HTTP403.
Of two preliminary apply decisions, independent verification allowed one and
stopped one as UNCERTAIN. Fifteen usage rows totaled $0.00791814 with zero unknown
costs. Backoff of later vacancies was observed with886 seconds remaining. The
observer restored off at revision30. Earlier unknowns were not resent.

Original403 diagnostics: small text response, errorClass=unclassified; body/header/
cookie XSRF matched, and Origin/Referer belonged to HH. An obvious missing or
mismatched field is not confirmed. This does not prove anti-bot, network blocking
or a Node transport defect. Jarvis has14 sent in the last24 hours; stored HH
history also shows14 in24 hours (597 total, checked13:54 Moscow time).
[HH's official help](https://feedback.hh.ru/knowledge-base/article/1618) states
200 applications per day; these observations do not confirm reaching that limit.

Browser/server/collector monitoring:21 samples, heap47–62 MiB, zero restarts/OOMs
and closed/unknown routes, live/ready200. Final environment/mount/inode/policy
and other-service checks passed. This establishes runtime stability, not delivery.
Both VPS and GitHub/source matched; Desktop retains its earlier missing shared file.

Conservative selection remains an open question:139071223, “AI Native Product
Owner”, was stopped as UNCERTAIN. The complete source was available:50 fragments,
including the duty about creating products with AI agents. The stored verdict
cannot distinguish model uncertainty from quote invalidation by the normalizer.
Do not repeat that model request merely to diagnose it; capture closed validation
metadata before deciding on a correction.

Delivery remains unresolved. Standard browser transport is being investigated,
but simply switching to route.continue is unsafe: Playwright bypasses route guards
for redirected POSTs. An isolated HTTPS PoC with a separate CDP response guard
stopped307/308, including another origin:7 scenarios, one original POST and zero
repeated POSTs. This is localhost fixture evidence, not HH or production. CDP
session loss and reliable original-receipt capture still require verification.
Production retains route.fetch with maxRedirects0/maxRetries0; old uncertain
operations are never resent.
