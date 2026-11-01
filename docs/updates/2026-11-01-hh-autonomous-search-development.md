# Автопоиск с LLM / Autonomous job search

1 ноября 2026. Локальная ветка `codex/hh-truthful-reframing`. Не опубликовано.

## Русский

В боте и Mini App добавлен личный переключатель «Автопоиск с LLM», по умолчанию
выключенный. Включение разрешает автоотклики от выбранного резюме. Проверяются
актуальные jobs, user/conversation/chat, consent revision, выбранное резюме,
версии профиля/вакансии, скрытие и текущие фильтры. После смены резюме требуется
обновить разрешение. Выключение возвращает ручной режим; уже начатый внешний
запрос отменить нельзя.

Поиск по фразам и жёсткие фильтры сохраняются. Оценщик получает содержательные
разделы резюме и факты, возвращает только apply/skip. Допускаются правдивые
частичные соответствия около 60–70% и переносимые навыки. Процентного порога
и дневной квоты нет. Письмо использует aggressive_truthful_reframing с сохранением
фактического статуса личных проектов.

Карточки, отказы и успешные автоотклики не рассылаются. Тест/анкета передаётся
в личный чат с канонической ссылкой HH. Вход, неполное резюме и неопределённая
отправка дают личное сообщение без повторного отклика. После выключения
пропущенные автоматикой вакансии не рассылаются задним числом.

Миграция 054 хранит согласия/задания и устанавливает существующим профилям
порог $2. Defaults/config/env.example также обновлены до $2. Одно уведомление
за календарный месяц по МСК не останавливает поиск. Миграция 055 различает
стоимость провайдера, расчёт по токенам и неизвестную сумму. Оценка и письмо
учитываются вместе; некорректный оплаченный ответ не теряет usage.

После выбора пользователем 1 ноября основная модель оценки и писем —
`z-ai/glm-5.3-flash` через существующий `OPENROUTER_API_KEY`. Отдельный ключ
DeepSeek больше не требуется; прямой адаптер удалён. Модель фиксирована,
JSON-схема строгая. GLM требует reasoning: используется low, внутренний текст
исключён из ответа; бюджет оценки — 1024 токена, письма — 6000. Провайдер выбирается по цене с верхней
границей $0.15/$0.50 за миллион входных/выходных токенов и без платы за запрос.
Повторы и автоматическая подмена модели отключены. Это границы допуска,
а не обещание конкретной цены. Нет ключа или HH apply capability — включение
недоступно. Основной чат сохраняет прежнюю очередь; HH-письма используют GLM.

Уведомление $2 использует `usage.cost` OpenRouter. Отсутствующая стоимость
остаётся unknown и не считается нулевой; тариф DeepSeek для GLM не применяется.
Контракты проверены по [модели](https://openrouter.ai/z-ai/glm-5.3-flash),
[маршрутизации](https://openrouter.ai/docs/guides/routing/provider-selection)
и [usage](https://openrouter.ai/docs/cookbook/administration/usage-accounting).

### Полнота резюме

Автоматическая оценка и письмо требуют `resume_content` с `requireComplete:true`.
DOM-чтение включает заголовок, весь опыт, навыки, образование, «О себе»
и распознанные разделы языков/курсов/сертификатов. Строгий режим требует четырёх
основных разделов, отсутствия незавершённой загрузки/скрытых известных секций
и прохождения прежних ограничений размера/PII. Отсутствующие разделы пока могут
потребовать ручного разбора, даже если пользователь действительно их не заполнил.
Legacy SSR извлекает не всё, поэтому остаётся только в ручном пути.
Живое полное чтение выбранных резюме нужно проверить до включения автоматики.

### Проверки и запуск

Перед выпуском полный server suite: 901 пройдено, 2 PostgreSQL-пропуска, 0 ошибок. Полный
job-browser suite: 99 пройдено, 10 платформенных/opt-in пропусков, 0 ошибок.
Изолированная настоящая PostgreSQL: 24 новых и существующих сценария
откликов/генерации/delivery/usage прошли. Mini App build
и браузерные fixtures на 320/390/1280 px прошли; мобильный экран осмотрен.
Независимая проверка consent/access/replay не нашла оставшихся подтверждённых
P1/P2 в проверенной границе. Старые PG fixtures обновлены для текущих identity,
access и происхождения резюме; production-проверки не ослаблялись.

Нужны согласованный выпуск, проверка действующего OpenRouter key, изолированная возможность HH apply
и живое полное чтение резюме. Обновляются server/Mini App, job-browser,
миграции 054/055; Desktop не меняется. Перед выпуском живые синтетические
проверки через существующий ключ подтвердили GLM: оценка stop/валидный JSON,
113 токенов, $0.00001997; письмо stop/валидные text+factIds, 1120 токенов,
$0.00024442. Отключённый reasoning сначала дал HTTP 400; low устранил отказ.
Работодателям ничего не отправлялось. Живое чтение выбранного резюме вернуло
JOB_HH_ACCESS_DENIED: реальное полное чтение, Telegram/WebView нажатия и первый
разрешённый HH-отклик остаются открытыми. Автоматика выключена по умолчанию.

## English

Personal Autonomous job search controls are implemented locally in Telegram and
Mini App, off by default. Enabling authorizes the selected personal resume with
current jobs, private scope, consent and provenance checks. Phrase searches and
hard filters remain. The decision-only model allows credible partial matches
and transferable project experience; letters use aggressive truthful reframing.
No percentage threshold or daily application quota is introduced.

Cards, rejections and successes stay silent. Tests/forms receive private canonical
HH links. Missing prerequisites and uncertain sends never trigger blind replay.
Disabling restores unprocessed manual delivery but cannot recall an external
request already started. Migrations 054/055 add consent/work records, set existing
notice thresholds to $2 and distinguish provider cost, estimates and unknown cost.
One Moscow-calendar-month notice never stops work. Following the owner's choice,
both evaluation and letters now use fixed `z-ai/glm-5.3-flash` through the existing
OpenRouter key. No separate DeepSeek key or direct adapter remains. Price-sorted
providers must support strict JSON and low reasoning (required by GLM), within $0.15/$0.50
per million input/output tokens and zero per-request fees. No retries or model
fallbacks occur. Costs use OpenRouter usage.cost; missing cost stays unknown.
The main assistant's routing is unchanged.

Automatic evaluation and letters require complete supported DOM resume sections.
Partial SSR is rejected; genuinely absent main sections can require manual
follow-up. Complete live reading remains an acceptance gate.

Pre-release verification: server 901 passed/2 PostgreSQL tests skipped; job-browser 99 passed/10 Linux-only tests skipped;
24 PG application/generation/delivery/usage checks passed. Mini App build and browser fixtures at
320/390/1280 passed. An independent security review found no remaining proven
P1/P2 in the reviewed boundary. Live synthetic probes before release confirmed
the existing key and GLM: valid decision at 113 tokens/$0.00001997 and valid
letter/fact references at 1120 tokens/$0.00024442. Disabled reasoning returned
400; low reasoning passed. Decision and letter budgets are 1024/6000 tokens,
including required reasoning, which is excluded from output. Live resume reading
returned JOB_HH_ACCESS_DENIED. Complete real HH reading, Telegram/WebView and
the first authorized application remain unverified; automation defaults off.
No real employer application occurred. Deployment status is recorded below.
