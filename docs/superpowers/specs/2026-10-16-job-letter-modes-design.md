# Четыре варианта сопроводительного письма / Four cover-letter modes

## Русский

16 октября 2026. Требования уточнены владельцем в текущей задаче.
Документ подготовлен для проверки перед реализацией; функция ещё не изменена.

### Сценарий

Факты и примеры необязательны для подготовки и отправки отклика.
AI обязательно получает сохранённые факты и примеры, если они есть:
факты ограничивают утверждения об опыте, примеры задают стиль.
Пустой или отсутствующий профиль создаётся без требования подтвердить пустоту.
Сохранение непустого профиля по-прежнему требует проверки владельцем.

В меню «Поиск работы» добавляется «Редактировать базовое сопроводительное».
Редактор показывает текущий текст или сообщает, что письмо ещё не задано.
Владелец присылает обычный многострочный текст без префиксов; перед заменой
показывается полный текст с подтверждением сохранения. Допустимо до 10 000
символов. Невалидный ввод не расходует активное ожидание.

Кнопка вакансии «Подготовить отклик» открывает выбор:

| Вариант | Источник | Действие |
| --- | --- | --- |
| Базовое | Сохранённое базовое письмо | Подготовить точный текст без вызова AI |
| Улучшенное | Сохранённое базовое письмо | AI адаптирует под вакансию и имеющийся опыт |
| Кастомное (без AI) | Текст владельца для этой вакансии | Подготовить точный текст без вызова AI |
| Кастомное (с AI) | Текст владельца для этой вакансии | AI адаптирует под вакансию и имеющийся опыт |

Кастомный текст не заменяет общее базовое письмо. Если базового письма нет,
первые два варианта предлагают его заполнить; оба кастомных варианта доступны.
Факты и примеры не являются условием доступности ни одного варианта.

После подготовки показывается полный итоговый текст. Отправка в HH требует
отдельного прежнего подтверждения с вакансией, работодателем, резюме и точным
текстом. Выбор режима, ввод текста и завершение AI сами ничего в HH не отправляют.
Варианты без AI не требуют модели или OpenRouter, не создают платных запросов
и не переписывают авторский текст. Кнопки явно обозначают действия с AI.

### AI и достоверность

Модель получает вакансию, исходное письмо, сохранённые факты и примеры стиля.
Авторский исходный текст является источником сведений владельца; профиль
дополняет их. Модель не придумывает опыт, навыки, годы, достижения или подпись.
При отсутствии опыта в обоих источниках она опирается на интерес к задачам
вакансии. Вакансия не становится доказательством опыта кандидата.
Примеры используются для стиля, а не как независимый источник биографии.
Встроенные инструкции в вакансии, примерах и письме остаются недоверенными.
Перегенерация, правка с AI и перевод получают исходный текст выбранного режима,
текущий черновик и актуальный профиль; ошибка AI сохраняет прежний черновик.

### Хранение и границы

Базовое письмо хранится в owner-scoped профиле отдельно от facts/examples.
Черновик хранит режим и исходное письмо для последующих явных действий с AI.
Изменение базового письма увеличивает revision профиля и делает прежние
подтверждения отправки неактуальными. Ревизии вакансии, профиля, черновика
и подключения проверяются перед отправкой во всех четырёх режимах.
Необязательность профиля снимает только запрет пустого профиля, сохраняя
проверки владельца, области данных и актуальности.

Новые callback-действия входят в закрытую грамматику и предел 64 байта.
Новые виды guided input добавляются одновременно в repository allowlist,
закрытую context shape и PostgreSQL CHECK новой forward-only миграцией.
Context содержит идентификаторы и revision, без пользовательского текста.
Тексты не попадают в callbacks, общую историю, diagnostics или логи.
Секреты, чужие чаты, member и group не получают доступа к письмам.
Неизвестная отправка проверяется по исходной операции; повтор под новым ID запрещён.
Production-зависимости и Desktop не меняются; публикация отдельно разрешается владельцем.

### Изменения и проверки

Изменяются job profile/schema, prompt, draft service/repository, application
repository, Telegram views/callbacks/service, interaction allowlist и миграция.
При необходимости обработчик новых путей выносится в отдельный небольшой модуль.
Обновляются контракт меню, инструкция проверки и двуязычная запись локального
результата; production-статус не объявляется до выпуска.

Unit-проверки покрывают четыре режима, отсутствие вызова AI для двух ручных
вариантов, включение исходника/фактов/примеров в AI и отсутствие обязательности
пустого профиля. Real-PostgreSQL acceptance проходит через настоящие message/menu
handlers и настоящий interaction repository: сохранение и замена базового,
invalid retry, closed context, успешный ввод, single consumption, expiry,
чужой user/chat/conversation, режимы и revisions. Проверяются сохранность
черновика при сбое AI, подтверждение точного текста, replay и unknown отправки.
Затем выполняются Telegram regression gate и полный server suite.
Все внешние отправки в тестах подставные. Реальные нажатия Telegram и выбранный
владельцем HH-отклик после подтверждения отмечаются отдельно после выпуска.

## English

16 October 2026. The owner clarified the requirements in this task.
This specification is ready for review; implementation has not started.

Facts and style examples become optional. When present, AI receives both:
facts constrain experience claims, and examples guide style. An absent or empty
profile must not block a draft or application; saving nonempty profile content
still requires owner confirmation.

The job menu adds “Редактировать базовое сопроводительное”. Its editor shows
the existing letter and accepts plain multiline text up to 10,000 characters,
followed by a full-text save confirmation. Invalid input preserves the interaction.

“Подготовить отклик” offers four modes:

| Mode | Source | Processing |
| --- | --- | --- |
| Base | Saved base letter | Exact text, no AI call |
| Improved | Saved base letter | AI adapts it to the vacancy and available experience |
| Custom without AI | Owner text for this vacancy | Exact text, no AI call |
| Custom with AI | Owner text for this vacancy | AI adapts it to the vacancy and available experience |

Custom input never replaces the saved base. Missing base text asks the owner
to fill it in for the first two modes; custom modes remain available.
All modes show the complete final draft and retain the separate HH confirmation
binding the exact text, vacancy, employer and resume. Choosing a mode or supplying
input never sends an HH application. Manual modes need neither model configuration
nor OpenRouter and create no billable model requests. AI controls are labelled explicitly.

AI receives the vacancy, source letter, saved facts and style examples. The owner's
source letter supplies experience information, complemented by profile facts.
It must not invent experience, skills, dates, achievements or a signature; without
experience information it can express interest in the vacancy's tasks. Vacancy
requirements and style samples are not evidence of the candidate's background.
Embedded instructions remain untrusted. Explicit regeneration, AI editing and
translation preserve the chosen source letter and current draft context. Failures
retain the previous draft.

The base letter is stored separately from facts/examples within the owner-scoped
profile. Drafts retain their mode and source text. Changing the base increments
the profile revision and invalidates pending application confirmations. All four
modes retain ownership, scope, vacancy/profile/draft/connection revisions, expiry,
atomic consumption, deduplication and original-operation reconciliation for unknown
outcomes. New guided kinds require repository allowlisting, closed ID/revision
contexts and a forward-only PostgreSQL CHECK migration. Callbacks remain closed
and limited to 64 bytes. Letter content is excluded from callbacks, general history,
diagnostics and logs. No production dependency or Desktop change is planned.
Publishing requires separate owner authorization.

Changes cover job profile/schema, prompt, drafts, application repository, Telegram
views/callbacks/handlers, interaction allowlist and migration, with a small separate
module if needed. Update the menu contract, verification instructions and bilingual
local-results note without claiming a production rollout. Unit tests cover every
mode and prompt inputs. Real-PostgreSQL tests use actual message/menu handlers and
interaction repository for base save/replace, invalid retry, closed context, success,
single consumption, expiry, foreign scopes, revisions, model failures, exact-text
confirmation, replay and unknown submission. Run the Telegram regression gate and
full server suite. External submissions use fixtures; live Telegram taps and an
owner-approved HH application remain separate post-release acceptance.
