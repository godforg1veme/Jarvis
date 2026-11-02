# HH: полный контекст отбора и ответы / Complete selection context and answers

## Русский

Согласовано владельцем в текущей задаче 1 ноября 2026: исправить нерелевантный
отбор, неподтверждённые намерения в письмах и разрешить LLM отвечать на вопросы
работодателя непосредственно в HH при личном включённом автопоиске.

Оценщик получает все настройки поиска, результат существующих фильтров с
причинами и неопределённостями, полную карточку вакансии, выбранное полное
резюме, подтверждённые факты и базовое письмо. Направление работы проверяется
до переносимости навыков. Частичное совпадение допустимо внутри целевого
направления; упоминание AI в инструменте продавца не делает продажи AI-ролью.
Существующие фильтры и неизвестные условия сохраняют прежнюю семантику;
модель не может обойти права, исключения, revisions и запрет повторной отправки.
Краткое основание решения сохраняется приватно вместе с версиями входных данных.

Письма и ответы не изобретают опыт, готовность сменить профессию, переехать,
условия оплаты или график. Личные ответы опираются на материалы пользователя;
профессиональные объяснения могут использовать знания модели без утверждения
личного опыта. Неизвестный обязательный личный ответ передаётся пользователю.

Поддерживаются только проверяемые текстовые вопросы и варианты ответа в
нативной форме HH, связанной с текущими vacancy/resume. Внешние ссылки,
загрузки файлов, CAPTCHA, неподдерживаемые тесты и неизвестные формы требуют
ручного действия. Структура HH подтверждается чтением реальной формы; фикстура
доказывает только внутренний контракт. Вопросы и варианты — недоверенные данные.

Вопросы и точные ответы сохраняются до отправки, входят в неизменяемую
идентичность операции и проверяются повторно. Старые операции без вопросов
сохраняют прежнюю идентичность. Unknown не переотправляется; проверка прежней
операции не создаёт нового ID. Ручной режим сохраняет подтверждение точного
текста и не получает скрытую генерацию/отправку ответов.

Причины остановки закрытые и сохраняются от browser до application/outbox.
Telegram сообщает реальную причину; меню/callback grammar/scopes прежние.
Новые production-зависимости, push/deploy и реальные отклики не входят в задачу.

## English

Approved by the owner in this task on November 1, 2026: correct irrelevant
selection and invented intentions, and allow the LLM to answer employer
questions directly inside HH under personal enabled automation.

The evaluator receives all search settings, existing filter results and unknowns,
the complete vacancy, complete selected resume, confirmed facts and base letter.
Target direction precedes transferable fit; incidental AI tools do not turn a
sales job into an AI role. Existing filter semantics, access, exclusions,
revisions and deduplication remain enforced. Store a private short decision
reason with input versions. Letters and answers cannot invent personal facts or
career/relocation/pay/schedule commitments. Professional explanations may use
model knowledge without claiming personal experience. Missing required personal
answers require user intervention.

Support bounded native HH text/choice questions only for the exact vacancy and
resume. External forms, uploads, CAPTCHA, unsupported tests and unknown forms
require manual action. Real HH structure needs read-only verification; fixtures
prove the internal contract only. Treat all question content as untrusted data.
Persist questions and exact answers before sending, bind them to immutable
operation identity, and recheck the form. Preserve old question-free identities.
Unknown operations are reconciled by their original ID. Manual mode retains its
exact-text confirmation and does not silently generate or submit answers.

Persist closed stop reasons through browser, application and outbox, and show
truthful Telegram notices without changing menus, callbacks or scopes. No new
production dependencies, push/deploy or real applications are authorized here.
