# HH: релевантность по основным обязанностям / Primary-duty relevance

Разработка начата 2 ноября; итоговые проверки выполнены 4 ноября 2026.
Development started November 2; final checks ran November 4, 2026.

## Русский

Пункт 1: отклик допускается, когда основная работа соответствует выбранному
AI/LLM-направлению. Клиентский опыт и использование GPT в другой профессии
сами по себе недостаточны. Предыдущий общий directionMatched этого не обеспечивал.

Одна оценка той же GLM 5.3 Flash теперь возвращает основную профессию, точный
поисковый запрос, отношение core/tool_only/adjacent/unclear и до трёх цитат
обязанностей. Модель получает полную вакансию, выбранное резюме, факты, базовое
письмо, настройки и результаты обычных фильтров. Переносимые навыки оцениваются
после направления. Названия должностей и отрасли не запрещаются: внедрение AI
в продажи или поддержку может подходить по основной работе.

Код предлагает до 96 исходных фрагментов по 10–240 символов. Короткий список
становится enum в отдельной JSON-схеме каждого вызова. Длинный список равномерно
выбирается по всему описанию; модель также может процитировать другой фрагмент
полного текста. Это кандидаты, а не заранее признанные обязанности.

До письма адаптер и worker проверяют точный запрос из текущих настроек и наличие
цитат в полном описании. tool_only/adjacent дают известный skip OUT_OF_DIRECTION;
неясность, чужой запрос или неподтверждённая цитата дают skip UNCERTAIN.
Пустые цитаты не считаются доказательством. Такие пропуски не запускают общую
15-минутную паузу. Неверный JSON остаётся ошибкой модели. Сохраняются один вызов,
лимит 6000, стоимость/request ID и отсутствие автоматического повтора.

Приватная evaluation хранит directionAssessment и selectionPolicyVersion=2
вместе с версиями контекста. Миграции не нужны. Старые решения не переписываются;
unknown-операции не повторяются. Политика действует для будущих оценок.

### Проверки и ограничения

Полный серверный набор: 930 passed, две PostgreSQL-проверки пропущены без БД.
Отдельный итоговый набор с изолированной PostgreSQL: 49/49 без пропусков.
Покрыты owner/member, отсутствие письма и отклика при неподходящем направлении,
сохранение оценки до письма, чужие запросы, выдуманные/пустые цитаты, Unicode,
длинные абзацы, обязанности в конце описания и независимые схемы пользователей.
Независимая ревизия выявила и помогла исправить ограничение первых 96 фрагментов.

Живые диагностические вызовы GLM использовали сохранённые карточки владельца,
реальные направления и отдельный тестовый AI-профиль с клиентским опытом.
Полное личное резюме не читалось: активный ручной сеанс HH сохранён.
Тестовый профиль не записывался пользователю. Это проверка направления,
а не персональная приёмка квалификации по полному живому резюме.

| Сохранённая вакансия | Последняя оценка |
| --- | --- |
| 137477284 — продажи недвижимости | skip OUT_OF_DIRECTION, tool_only |
| 138338991 — работа с клиентами в недвижимости | skip UNCERTAIN, unclear |
| 138659080 — обычная техподдержка AGIMA | skip OUT_OF_DIRECTION, adjacent |
| 138532199 — фармацевтические продажи | skip OUT_OF_DIRECTION, tool_only |

Четыре положительных примера получили apply/core: внедрение AI в продажи,
RAG поддержки, n8n/Make с LLM и AI-внедрение/обучение. Вымышленный AI Engineer
с обязанностями обычного продавца отклонён. Неясная вакансия получила UNCERTAIN.
Итоговая серия: 10/11. В длинном искусственном описании цитата не прошла проверку,
и подходящая вакансия была безопасно пропущена. Отдельная повторная диагностика
того же случая получила точную цитату и apply/core (1/1). Код между этими двумя
сериями не менялся. Это показывает остаточную изменчивость модели; отсутствие
всех ложных пропусков не заявляется, автоматические повторы не добавлены.

Всего при разработке выполнено 58 отдельных диагностических вызовов, $0.016343332.
Исходные операции до/после совпали; реальные письма и отклики не отправлялись.
Личные автоотклики остаются выключены. Смысл обязанностей определяет LLM;
проверка цитаты подтверждает источник, но сама по себе не доказывает релевантность.
Проблемы формы (пункт 2) и классификации ошибок (пункт 5) сюда не входят.

Фактическая установка и проверка записываются после выпуска.

## English

Item 1: applications require the primary job to match the selected AI/LLM
direction. Customer-service skills and GPT use in another profession are
insufficient. The earlier directionMatched flag did not enforce this reliably.

One evaluation by the same GLM 5.3 Flash now returns the primary profession,
an exact search query, core/tool_only/adjacent/unclear relationship and up to
three duty quotations. Complete vacancy, selected resume, facts, base letter,
settings and ordinary filter results remain available. Transferable skills are
considered after direction alignment. No title or industry blacklist is used:
implementing AI in sales or support can qualify through its primary duties.

Code suggests up to 96 source fragments of 10–240 characters. A complete small
list becomes an enum in an independent per-call JSON schema. Longer lists are
sampled across the full description; the model may also quote another exact
fragment from the complete text. Candidates are not preclassified duties.

Before letter creation, the adapter and worker verify current-query membership
and quotations against the full description. tool_only/adjacent produce a known
OUT_OF_DIRECTION skip; ambiguity, a foreign query or unsupported quotation
produce UNCERTAIN. Empty quotes provide no evidence. These skips do not trigger
the global 15-minute pause. Invalid JSON remains a model error. The single call,
6000-token limit, cost/request ID and no automatic retries are preserved.

Private evaluation stores directionAssessment and selectionPolicyVersion=2
with context revisions. No migration is needed. Historical decisions and unknown
operations remain unchanged. The policy applies to future evaluations.

### Validation and limits

Full server suite: 930 passed, two PostgreSQL checks skipped without a DB.
The final isolated PostgreSQL suite passed 49/49 with no skips. Coverage includes
owner/member isolation, no letters/applications for rejected directions,
persistence before drafting, foreign queries, fabricated/empty quotes, Unicode,
long paragraphs, late duties and independent concurrent-user schemas.
Independent review identified and helped fix the first-96-fragments limitation.

Live diagnostic GLM calls used saved owner-scoped cards, real directions and a
separate synthetic AI applicant with customer-service experience. The complete
personal resume was not read because an active manual HH session was preserved.
The fixture was not written to user data. This validates direction selection,
not personal qualification against the complete live resume.

| Saved vacancy | Latest evaluation |
| --- | --- |
| 137477284 — real-estate sales | skip OUT_OF_DIRECTION, tool_only |
| 138338991 — real-estate customer work | skip UNCERTAIN, unclear |
| 138659080 — ordinary AGIMA support | skip OUT_OF_DIRECTION, adjacent |
| 138532199 — pharmaceutical sales | skip OUT_OF_DIRECTION, tool_only |

Four positive examples received apply/core: AI implementation in sales, support
RAG development, n8n/Make with LLMs and AI adoption/training. A fictional AI
Engineer doing ordinary sales was rejected. An unclear vacancy received UNCERTAIN.
The final series passed 10/11. A quotation failed verification in a long synthetic
description, conservatively skipping a relevant vacancy. A separate repeat
diagnostic of that case returned an exact quote and apply/core (1/1), with no
code changes between these series. This demonstrates remaining model variability;
zero false negatives is not claimed and no automatic retries were added.

Development used 58 separate diagnostic calls costing $0.016343332. Original
operation states matched before/after; no real letters or applications were sent.
Personal automatic applications remain off. The model judges duty semantics;
quotation checks establish source grounding, not semantic relevance by themselves.
Form failures (item 2) and error classification (item 5) are separate work.

Actual installation and verification will be recorded after deployment.
