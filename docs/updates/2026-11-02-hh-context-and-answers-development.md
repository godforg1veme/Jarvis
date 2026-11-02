# HH: контекст отбора и ответы / Selection context and answers

## Русский

Локальная разработка по согласованной владельцем
[схеме](../superpowers/specs/2026-11-01-hh-context-and-answers-design.md).
Изменения не опубликованы и не установлены на VPS. Состояние установленного
автопоиска описывает [выпуск 1 ноября](2026-11-01-hh-autonomous-search-release.md).

### Отбор и письма

После сообщений о вакансиях 137477284 и 138338991 проверены сохранённые исходные
операции владельца. Обе остановились с `manual_required`; браузерный журнал
подтвердил отсутствие пропущенного через защиту валидированного POST.
Точная сработавшая проверка не была сохранена. Повторный осмотр обеих вакансий
не обнаружил требования ручного ответа; сообщения о тесте/полях не доказывали
наличие теста. Исходные операции не переотправлялись.

Теперь оценка и создание письма получают полную карточку вакансии, все личные
настройки поиска, результат обычных фильтров и их неопределённости, пометки
совпадения, полное выбранное резюме, факты и базовое письмо. Обычные запреты
проверяются независимо от LLM. Совпадение направления проверяется перед
переносимостью навыков: использование AI брокером не делает продажу квартир
работой по внедрению AI. Краткая причина и версии входных данных сохраняются
приватно в migration 056.

Автоматическое письмо получает базовое сопроводительное как исходный текст.
Модель отвечает на вопросы, которые работодатель просит раскрыть в письме.
Неизвестный обязательный личный ответ останавливает отклик. Дополнительная
проверка блокирует неподтверждённые карьерные намерения и сохраняет отрицания
в цитатах. Это консервативная проверка известных классов фраз; она не доказывает
семантическую истинность произвольного текста модели.

Смена версии поиска блокирует отправку по старому решению. Пересмотр возможен
только для сохранённого известного `skip` без письма или операции, при новой
версии настроек и новом сохранённом ID оценки. Неопределённые вызовы и отклики
автоматически не повторяются. Старые отказы без сохранённой версии не
переоцениваются задним числом.

### Ответы и диагностика

Migration 057 хранит приватный запрос вопросов, версии контекста и точные
ответы до отправки. После вызова модели повторно проверяются права, согласие,
выбранное резюме и версии поиска, профиля и вакансии. При неизвестном результате
модели второй запрос не выполняется. Вопросы и варианты трактуются как
недоверенные данные; служебные hidden-поля HH не передаются модели.

Личные ответы используют поддержанные цитаты; произвольное «да» к переезду или
смене профессии не выводится из несвязанного опыта. Объяснения профессиональных
понятий могут использовать знания модели без приписывания личного опыта.
Внешние анкеты, файлы, CAPTCHA и неизвестные формы остаются ручными действиями.
Ручная отправка сохраняет подтверждение точного письма и не включает скрытую
генерацию ответов.

Форма `/applicant/vacancy_response/test` реализована по публичному production
коду HH: [страница вопросов](https://i.hh.ru/build/VacancyResponse-route.325bf730cd1687f2.js)
и [отправка формы](https://i.hh.ru/build/9573.36080ab0186e8583.js).
Поддерживаются текст, один вариант и несколько вариантов. Проверяются точные
QA-маркеры, идентичность теста, выбранное резюме и состав полей. Служебное время
проверяется в подготовленной форме; оно не меняет хеш вопросов. Порядок ключей
JSONB не меняет хеш. Смешанный вариант «другое + свой текст», изображения и
неподдерживаемые формы требуют ручного ответа. Короткий личный выбор «да/нет»
без дословного подтверждения не угадывается по общим навыкам.

Браузер передаёт закрытую причину остановки через журнал операции, сервер и
личное уведомление. Отсутствующая причина остаётся неизвестной; её не заменяет
заявление о тесте или изменении формы. Меню, callbacks и scope не меняются.
Журнал с вопросами привязывает хеши формы и ответов к прежнему operation ID.
Если квитанция отправки потеряна, существующее подтверждение письма в истории
HH не доказывает точные ответы: результат остаётся unknown, повтор запрещён.

### Проверки

На работающей GLM с новым промптом проверены три обезличенных сценария:
краткие описания двух исходных продаж недвижимости — `OUT_OF_DIRECTION`,
смежная роль внедрения AI — `DIRECTION_FIT`. Это отдельная диагностическая
проверка модели, не реальный отклик и не доказательство всех будущих решений.

| Проверка | Фактический результат |
| --- | --- |
| Полный server suite | 916 прошли, 2 требуют PostgreSQL и пропущены локально |
| Две пропущенные проверки резюме | Отдельно прошли с PostgreSQL; файл 4/4, без пропусков |
| Обязательный Telegram regression gate | 78/78 |
| Linux browser suite и native driver | 122/122, без пропусков, в новом тестовом образе |
| Отдельные PostgreSQL-наборы | 45/45, без пропусков |
| Сквозной автоматический ответ | PostgreSQL → LLM fixture → RPC → Chromium → один POST: прошёл |
| Прежняя ручная отправка | Подтверждение → PostgreSQL/RPC/Chromium → восстановление исходного ID: прошла |
| Сборка browser | Новый root context и Dockerfile allowlist: прошла |

Независимые security/functional проверки нашли и помогли устранить ложное
обоснование цитатой из отрицания, подмену личного ответа профессиональным,
устаревший skip и выдуманную причину остановки. Нативную форму и множественный
выбор главный агент проверил по коду и Chromium-сценариям. После последней
доработки отдельная повторная ревизия специалистом не выполнена.

Публичный JS подтверждает протокол, а сетевые фикстуры — исполняемый сценарий.
Ни одна найденная для живого осмотра вакансия не открыла проверяемый тест;
чтение 61 публичной карточки и нескольких личных проверок не доказывает
совместимость всех вариантов HH. Реальная отправка ответов, live owner/member
приёмка и новый Telegram-текст после установки остаются непроверенными.
Настоящие отклики не отправлялись.
Для применения потребуются отдельное поручение на публикацию, миграции и
обновление server/HH browser. Desktop не менялся.

## English

Local development follows the owner-approved
[design](../superpowers/specs/2026-11-01-hh-context-and-answers-design.md).
Nothing is published or deployed. The installed automation is documented in the
[November 1 release](2026-11-01-hh-autonomous-search-release.md).

Both original owner operations for vacancies 137477284 and 138338991 stopped
with `manual_required`; the browser ledger establishes that no validated POST
passed its guard. The specific branch was not recorded. Later read-only
inspection did not find a manual-answer requirement. Neither operation was retried.

Evaluation and letter generation now receive the complete vacancy, all search
settings, existing filter results and unknowns, match annotations, complete
selected resume, facts and base letter. Existing exclusions remain independent
of the LLM. Target direction precedes transferable skills: an estate broker's AI
tools do not turn property sales into AI implementation. Migration 056 stores a
private short decision reason and input versions.

Automatic letters use the base letter as source, answer requested in-letter
questions and stop for missing mandatory personal facts. A conservative guard
blocks unsupported career commitments and preserves quote negation. It covers
known phrase classes, not arbitrary semantic truth. Search revision changes
block stale sends. Only confirmed skipped evaluations without drafts or
operations may be reconsidered for new settings under a new persisted request
ID. Unknown requests and outcomes are never automatically retried; legacy skips
without recorded context versions are not retroactively reconsidered.

Migration 057 stores private question requests, context versions and exact
answers before submission. Access, consent, resume and search/profile/vacancy
versions are checked after model invocation. Questions are untrusted data;
hidden HH transport fields never enter the model prompt. Personal answers use
supported excerpts; unrelated experience cannot justify a yes to relocation or
a career change. Objective professional explanations can use model knowledge
without personal claims. External forms, files, CAPTCHA and unknown forms stay
manual. Manual applications retain exact-letter confirmation without hidden
answer generation.

The native `/applicant/vacancy_response/test` path follows HH's public production
[question page](https://i.hh.ru/build/VacancyResponse-route.325bf730cd1687f2.js)
and [form transport](https://i.hh.ru/build/9573.36080ab0186e8583.js).
Text, single-choice and multiple-choice controls are supported. Exact QA markers,
test identity, selected resume and field composition are rechecked. Transient
start time is bound to the prepared form, not the question hash; JSONB key order
does not alter that hash. Mixed other-plus-text answers, images and unsupported
forms stay manual. Short personal yes/no selections without verbatim support
are not guessed from general skills.

Closed stop reasons propagate through browser, durable ledger, server and private
notices. Missing reasons remain unknown rather than being presented as tests or
changed forms. Menus, callbacks and scopes are unchanged. Questionnaire and
answer hashes bind to the original operation ID. If the receipt is lost, the
existing letter-only HH history proof cannot establish exact answers: the
operation remains unknown and cannot be resubmitted.

Three live GLM diagnostics used anonymized data with the new prompt: summaries
of the two property-sales jobs were rejected as `OUT_OF_DIRECTION`; a related AI
implementation role was accepted as `DIRECTION_FIT`. These were model probes,
not real applications or proof of every future decision.

| Check | Actual result |
| --- | --- |
| Full server suite | 916 passed; 2 database-dependent tests skipped locally |
| Skipped resume checks | Passed separately with PostgreSQL; file 4/4 with no skips |
| Required Telegram regression gate | 78/78 |
| Linux browser suite and native driver | 122/122, no skips, in the new test image |
| Isolated PostgreSQL suites | 45/45, no skips |
| Automatic-answer integration | PostgreSQL → model fixture → RPC → Chromium → one POST passed |
| Existing manual application | Confirmation → PostgreSQL/RPC/Chromium → original-ID recovery passed |
| Browser build | Root context and Dockerfile allowlist passed |

Independent security/functional reviews exposed and helped fix negated evidence,
personal answers disguised as knowledge, stale skips and invented stop reasons.
The main agent reviewed native-form and multiple-choice code and Chromium
scenarios. A separate specialist did not re-review the final native changes.

Public JavaScript establishes the transport; network fixtures establish executable
behavior. None of the vacancies inspected live exposed a verifiable native test;
61 public cards and several private read-only checks do not establish every HH
variant. Real answer submission, live owner/member acceptance and the installed
Telegram wording remain unverified. No real applications were sent. Applying the changes requires
separate publication authorization, migrations and server/HH browser updates.
Desktop is unchanged.
