# Автопоиск с LLM / Autonomous job search

Согласовано пользователем в чате 31 октября 2026. Реализация локальная; выпуск
и реальные отклики в рамках разработки не разрешены.

## Поведение

Личный переключатель «Автопоиск с LLM» доступен в разделе поиска работы бота
и Telegram Mini App всем пользователям с актуальным правом jobs. По умолчанию
он выключен. Включение явно разрешает будущие отклики от выбранного личного
резюме. Выключение возвращает текущую доставку карточек и ручное подтверждение.

Поиск по фразам и жёсткие личные фильтры сохраняются. Все прошедшие их вакансии
оцениваются по полным доступным содержательным разделам выбранного резюме
и подтверждённым фактам. Отдельный промпт допускает частичное соответствие
около 60–70%, самостоятельные проекты и переносимые навыки. Процент не является
автоматическим порогом. Нет доказанной связи с задачами — молчаливый пропуск.
Ответ оценщика содержит только apply/skip, без развёрнутого обоснования.

Письмо использует aggressive_truthful_reframing: сильная профессиональная подача
подтверждённого опыта без придуманных работодателей, стажа, KPI и масштаба.
Автоматические карточки, пропуски и успехи не отправляются в Telegram.
Тесты, анкеты и дополнительные обязательные поля передаются владельцу профиля
в личный Telegram со ссылкой; система сама их не проходит.

Дневной квоты нет. Технические ограничения HH сохраняются. Расходы оценки
и генерации учитываются по пользователю. Один порог $2 за календарный месяц
по МСК вызывает уведомление без остановки. Неизвестная стоимость не равна нулю;
расчёт по токенам явно отличается от суммы, подтверждённой провайдером.

## Границы

Согласие хранит исходные user/conversation/chat, выбранное резюме и revision
подключения. Перед отправкой проверяются текущие права, включение, фильтры,
резюме, версии вакансии и профиля. Ручные подтверждения остаются прежними.
Фоновая операция получает устойчивый ID до внешнего действия. Неопределённый
результат проверяется по исходному ID, повторная отправка запрещена.
Документы являются данными; инструкции работодателя не меняют правила.

После выбора пользователем 1 ноября основная модель — `z-ai/glm-5.3-flash`
через существующий OpenRouter key, с закрытым endpoint, JSON и обязательным reasoning low.
Живые проверки выявили, что GLM не допускает disabled; low скрыт из ответа.
Стоимость берётся из usage OpenRouter. Нет ключа или
возможности отправки HH — включение недоступно с понятным объяснением.

## Проверки

Реальные PostgreSQL fixtures: пользовательская изоляция, согласие и версии,
отзыв доступа, disable, конкурентный claim, перезапуск, unknown и отсутствие
дублей; модель и HH заменены управляемыми адаптерами без внешних отправок.
Unit: JSON, полное резюме, частичное соответствие, usage и отсутствие повторов.
Бот: закрытые callbacks и прежние ручные сценарии. Mini App: доступ, CAS,
ошибки и узкий/широкий экран. Настоящие Telegram/HH проверки — после выпуска.

## English

Implementation note, November 1: automatic evaluation and letter generation use
strict supported DOM resume reading. Legacy SSR does not prove full coverage and
is rejected in auto mode; absent main sections can require manual follow-up.
The [local result](../../updates/2026-11-01-hh-autonomous-search-development.md)
records exact checks, provider cost estimates and remaining live acceptance.

Each authorized user can enable Autonomous job search in Telegram and Mini App.
It preserves phrase searches and hard personal filters, evaluates every matching
vacancy against the complete supported resume sections and confirmed facts, and
allows credible partial matches and transferable project experience. Rejections
and successful applications remain silent. Tests/forms require a personal
Telegram handoff. The existing manual flow returns when automation is disabled.

Consent is bound to the user's private scope and selected resume revision.
Access, settings, consent and provenance are rechecked before submission.
Durable operation IDs prevent duplicate applications after an uncertain result.
One $2 monthly notice uses Moscow calendar months and never stops processing.
Token-based cost estimates are identified separately from provider-reported cost.
Local verification uses isolated databases and fake external adapters; no release
or real application is authorized by this design document.
