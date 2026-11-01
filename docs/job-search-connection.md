# Подключение поиска работы

## Текущий путь, 1 ноября 2026

Каждый пользователь с действующим правом `jobs` подключает свой HH через
личную временную HTTPS-ссылку бота или Mini App и подтверждает основное резюме.
Профиль изолирован по UUID; username и роль администратора не открывают чужой
аккаунт. Права, выбранное резюме и revision перепроверяются сервером.
[Контракт Mini App](../mini-app/README.md).

Оценка вакансий и HH-письма используют фиксированную `z-ai/glm-5.3-flash` через
существующий `OPENROUTER_API_KEY`, отдельно от очереди основного чата. Ключи не
нужно присылать в Telegram или чат разработки. Персонального выбора модели нет.
`JARVIS_JOB_BUDGET_USD=2` — порог одного уведомления за календарный месяц по МСК;
он не останавливает работу. Дневного лимита откликов нет.

В ручном режиме карточки приходят пользователю, модель вызывается по запросу,
а отправка требует подтверждения точного письма. Личный «Автопоиск с LLM» по
умолчанию выключен. Включение разрешает будущие отклики от выбранного резюме
в привязанном private scope. Отказы и успешные автоотклики не уведомляют;
тесты, анкеты и проблемы передаются в личный Telegram. Выключение возвращает
ручную доставку необработанных вакансий. Почасовая сверка истории откликов
планируется независимо от поиска; расписание не доказывает успешный полный обход.

Код общий для всех профилей; изоляция и ограничения доступа проверены тестами.
Вход и полное чтение реального резюме подтверждены у владельца. Живые проверки
участников, переключателя внутри Telegram и первого реального автоотклика открыты.
[Выпуск](updates/2026-11-01-hh-autonomous-search-release.md) и
[восстановление входа и полного резюме](updates/2026-11-01-hh-session-and-complete-resume-repair.md).

Each user with current `jobs` permission connects a personal HH account through
a temporary HTTPS link from the bot or Mini App and confirms the primary resume.
Profiles are UUID-isolated; usernames and administrator roles grant no access to
another account. The server rechecks access, selected resume and revision.
See the Mini App contract linked above.

Vacancy evaluation and HH letters use fixed `z-ai/glm-5.3-flash` with the existing
OpenRouter key, separately from main chat routing. Never send keys in chat.
There is no per-user model selector. `JARVIS_JOB_BUDGET_USD=2` triggers one notice
per Moscow calendar month without stopping work; there is no daily application quota.
Manual mode delivers cards, invokes the model on request and requires exact-letter
approval before sending. Personal Autonomous job search defaults to off. Activation
authorizes future applications for the selected resume and bound private scope.
Rejections and successful applications stay quiet; tests, forms and actionable
failures go to the user's private Telegram chat. Disabling restores manual
handling of unprocessed vacancies. Hourly history reconciliation is scheduled
independently of search; its schedule does not prove a completed full scan.

The implementation applies to all profiles; tests cover isolation and access.
Real sign-in and complete-resume reading passed for the owner. Member flows,
the in-Telegram switch and the first real autonomous application remain open.
The release and repair records linked above contain evidence and limits.

## Восстановление подключения / Connection recovery

HTTP 403 или заголовок `Server: ddos-guard` сами по себе не доказывают сетевую
блокировку: HH может показать форму повторного входа на прежнем URL резюме.
Проверь закрытый статус и тип страницы без вывода cookies, телефона, HTML или
login ticket. Пароль и SMS-код вводит сам пользователь в личном окне HH.
Сохраняй профиль и выбранное резюме; не копируй cookies между пользователями.

Если HH требует вход, а Jarvis всё ещё показывает `connected`, это не рабочее
подключение. Восстановление должно пройти штатный сервис личной login session с
актуальными правами и подтверждением резюме. Кнопка входа пока не устраняет такую
устаревшую запись автоматически; этот случай требует ограниченного серверного
ремонта, как в записи 1 ноября. Не обходи его отключением проверок доступа или
подменой браузерного UUID. После входа проверь `requireComplete:true`; неподдерживаемые
непустые разделы курсов/сертификатов остаются причиной остановки, а не пустым резюме.

`JOB_COLLECTION_WINDOW_EXPIRED` относится к диапазону поиска, а не к сессии HH.
Проверь дату сохранённого прохода и отдельную очередь свежих вакансий. Не отмечай
непрочитанный диапазон завершённым и не удаляй сохранённый progress/checkpoint,
чтобы скрыть ошибку. Автопоиск включается лично после восстановления доступа.

HTTP 403 or a `Server: ddos-guard` header alone does not prove a network block:
HH may show its login form at the existing resume URL. Inspect only closed status
and page classification, without logging cookies, phone, HTML or login tickets.
The user enters password/SMS code in their own HH window. Preserve the profile
and selected resume; never copy cookies between users.

If HH needs login while Jarvis still reports connected, the connection is stale.
Recovery uses the normal personal login-session service, current access and
resume confirmation. The login button does not yet repair that stale record
automatically; this case needs the bounded server repair documented on November 1.
Do not disable access checks or substitute another browser UUID. Then verify
`requireComplete:true`. Unsupported nonempty course/certificate sections must
stop reading rather than be replaced with empty fields.

`JOB_COLLECTION_WINDOW_EXPIRED` concerns a saved search range, not the HH session.
Check that range and the independent fresh queue. Do not mark unread ranges
complete or delete progress/checkpoints to hide failure. Automation requires
personal activation after access is restored.

## История первого подключения, 15 октября 2026

Ниже сохранены первоначальные решения, проверки и ограничения. Текущий путь
описан выше. The original connection record follows; use the current path above.

**Обновление:** владелец подтвердил, что настройки HH находятся только
в кабинете, затем привёл уведомление о прекращении applicant API с
15 декабря 2025. Инструкции получения доступа через это API ниже сохраняют
историю и больше не являются текущим путём подключения.
[Согласованная замена](superpowers/specs/2026-10-15-job-search-without-api-options.md) —
отдельный браузер DE; ключи приложения HH для этого пути не требуются.

**Следующее решение:** владелец выбрал браузер DE и одобрил Playwright/Chromium.
Публичная проба поиска и полной вакансии прошла. Подготовлен временный
[ручной вход через SSH](../job-browser/README.md); передача ключей HH не нужна.
Вход владельца уже подтверждён на DE и сохранился после штатного перезапуска
браузера. Временный доступ к управлению закрыт; приватный профиль сохранён.
Основное резюме выбрано и сопоставлено с HH. Сервис чтения и приватный RPC
реализованы; сборщик использует браузер вместо API. Форма прочитана без
отправки. Предыдущий вывод о необходимости открыть резюме всем был ошибочным:
скрытый блок предупреждения принят за видимый. Проверка исправлена.
Владелец требует сохранить «Скрыто от выбранных работодателей» и существующий
стоп-лист. Его чтение проверено; компании из списка блокируются при inspect,
обычная вакансия проходит. Настройки видимости не меняются.

Последующая контрольная точка: browser driver отправки и восстановления
подключён к server runtime/RPC с отдельным apply credential, по умолчанию
выключенным. «Подключить HH» сверяет уже выполненный вход и выбранное основное
резюме, сохраняет только метаданные в PG. Сборщик получает только read credential.
Единый send/recovery E2E с PostgreSQL и Chromium прошёл на DE. Настоящий отклик
ещё не отправлялся. [Результат этого этапа](updates/2026-10-15-job-search-development.md)
и [параметры браузера](../job-browser/README.md) описывают тот этап; текущий путь приведён выше;
OAuth-инструкции ниже сохраняют только историю.

Состояние на 15 октября 2026: функция выпущена на DE после явного разрешения
владельца. Сохранённый вход, основное резюме, поиск и inspect подтверждены через
работающий server/browser. [Запись выпуска](updates/2026-10-15-job-search-release.md)
описывает оставшиеся действия владельца для включения поиска и live-приёмки.
API соискателя не используется.

## История: настройка OpenRouter, 23 октября 2026

Этот снимок заменён ноябрьской политикой выше. This snapshot was superseded by
the November policy above. The $3 threshold below describes the old deployment.

OpenRouter использует существующий `OPENROUTER_API_KEY`. Его значение не нужно
присылать в Telegram или чат разработки. Выпущен [автоматический выбор модели](updates/2026-10-23-jobs-automatic-model-release.md):
общая очередь OpenRouter проверяет бесплатные варианты и настроенный платный
резерв. Персональная настройка модели и отдельная переменная окружения удалены;
на DE обновлены server/collector и применена 045. `JARVIS_JOB_BUDGET_USD=3` означает уведомление,
а не остановку запросов после трёх долларов.
Прежнее [сравнение моделей](job-search-model-evaluation.md) сохраняет историю
ручного выбора до перехода на автоматическую очередь.

OpenRouter uses the existing API key; do not send it in chat. Automatic model
selection is deployed: the shared queue checks free models, then
configured paid fallback. Per-user model selection and the separate environment
variable are removed. DE server/collector and migration 045 are updated. The budget setting
remains a notification threshold. The model comparison above is historical.

Историческая проверка перед первым выпуском: окружение DE-контейнера подтвердило наличие ключа
OpenRouter. Переменные подключения HH в этом контейнере отсутствуют;
поиск работы там выключен. Проверялись только признаки наличия, без вывода значений.
Владелец подтвердил, что приложение HH уже зарегистрировано. В локальном
`.env` настройки HH под поддерживаемыми именами также не найдены; расположение
конфигурации и доступные приложению права ещё уточняются.

## История: получение доступа HH API, больше не используется

1. Открыть [портал HH API](https://dev.hh.ru/) и выбрать регистрацию приложения.
   Использовать свой аккаунт и описать личный поиск вакансий и подготовку
   откликов с подтверждением владельца.
2. Уточнить у HH доступные именно этому приложению методы: поиск и чтение
   вакансий, чтение собственных резюме, отправка отклика соискателя и чтение
   результата отправки. Наличие client ID и OAuth само по себе не подтверждает
   последние три возможности.
3. Для чтения вакансий разместить выданный HH токен только в закрытом окружении
   DE как `HH_APP_TOKEN`, а согласованный идентификатор приложения — как
   `HH_USER_AGENT`. Текущий клиент передаёт токен лишь в запросах GET к HH.
   Проверить один поисковый запрос и получение одной вакансии. При 401/403
   сначала выяснить права и требования HH; не включать массовые повторные запросы.
4. Для отправки необходим отдельный проверенный контракт API соискателя.
   После его получения требуется завершить подключение аккаунта, выбор одного
   основного резюме и адаптер отправки. В текущем production-пути они ещё
   не подключены. Заполнение `HH_CLIENT_ID`, `HH_CLIENT_SECRET`,
   `JARVIS_JOB_PUBLIC_ORIGIN` и `JARVIS_JOB_SECRET_KEY` сейчас не создаёт
   работающий OAuth-процесс.

Текущая [официальная OpenAPI-схема](https://api.hh.ru/openapi/specification/public)
не содержит прежних applicant-операций `/resumes/mine` и `POST /negotiations`.
Поэтому инструкцию «вставить ключ и отправлять отклики» нельзя считать проверенной.
Браузерный канал впоследствии согласован владельцем.

## Включение после принятия и выпуска

Выпуск выполняется по [порядку Jarvis](release-workflow.md). На DE включаются
`JARVIS_JOB_SEARCH_ENABLED=true`, настроенный общий маршрут OpenRouter и профиль Compose
`job-search-de`. Сборщик использует существующий server image и приватную БД;
второй polling Telegram-бот не запускается. На NL сборщик не запускается.
Браузер получает отдельные owner UUID, RPC secret и существующий приватный
volume через `JARVIS_JOB_BROWSER_PROFILE_VOLUME`; секреты не присылаются в чат.
Схема и проверки описаны в [пакете browser](../job-browser/README.md).

В личном Telegram владельца: «Поиск работы → Настройки», проверить запросы,
зарплату, Москву, удалёнку, 14 дней и интервал 30 минут. Затем ввести «включить»
и подтвердить показанные настройки. До этого историческая рассылка не начинается.
Отдельно заполнить и подтвердить факты и примеры для писем. Сбор карточек
не вызывает модель. Подготовка, правки и перевод вызываются кнопками.

После выпуска отдельно проверяются реальные карточки, рестарт без дублей,
правка и перевод в Telegram. Реальный отклик проверяется только при наличии
подтверждённого браузерного адаптера, доступного основного резюме и отдельного подтверждения
владельцем точного текста. Локальный HTTP-стенд не заменяет эти проверки.
