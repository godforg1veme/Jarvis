# Панель настроек поиска / Job settings panel

[Русский](#русский) | [English](#english)

## Русский

16 октября 2026. Реализовано локально в `codex/job-settings-panel`, не установлено
на VPS. Владелец согласовал [сценарий](../superpowers/specs/2026-10-16-job-settings-panel-design.md).

Вместо длинного редактора с командами «Настройки» показывает отдельные кнопки:
доход, город, удалённые вакансии, интервал, глубина истории, модель AI, порог
уведомления о расходах, запросы и исключения. Открытие экрана не ждёт текста.
Для чисел есть предустановки и «Ввести своё», для удалённых вакансий — «Да/Нет».
Город вводится обычным названием. Модели берутся из текущей настройки и серверной
конфигурации OpenRouter; можно наследовать модель поиска или ввести ID.
Это не полный каталог провайдера и не проверка доступности модели.

Фразы открываются отдельно, по восемь на странице. Их можно добавлять и удалять
с подтверждением; последний запрос удалить нельзя, дубли не добавляются.
После добавления показана страница с новой фразой. Любое изменение сначала
показывает короткую разницу, затем «Сохранить / Отмена». Сохранение возвращает
актуальную панель или список. Порог уведомления не становится лимитом расходов.

Новый guided kind `job_setting_value` добавлен migration 036 вместе с allowlist
и закрытым context. Существующие scopes, revision, expiry и single consumption
сохранены. Навигация отменяет ввод, неверное значение допускает повторную попытку.
Старый уже выданный редактор остаётся совместимым. Изменения не вызывают AI/HH,
не меняют профиль и подтверждения отправки писем. Новых зависимостей нет.

Проверки: server 652/652, Telegram gate 65/65, реальные PostgreSQL job acceptance
28/28, включая четыре новых сценария панели. Они проходят через настоящие
message/menu handlers и interaction repository, проверяют поля, списки, модели,
возвраты, границы, подтверждения, старые кнопки, scope, отмену и повторы.
Миграция проверена в отдельной временной PostgreSQL; production не изменён.

Для выпуска нужны отдельное поручение, GitHub main, исходники обоих VPS и
обновление только server на DE с migration 036. Browser/collector/Desktop
не требуют пересборки. После выпуска остаётся проверить реальные нажатия
панели, ввод и возвраты в Telegram, а также полные runtime migrations с pgvector.

## English

16 October 2026. Implemented locally in `codex/job-settings-panel`, not installed
on the VPS nodes. The owner approved the design linked above.

Settings now shows separate buttons for income, city, remote vacancies, interval,
initial history depth, AI model, spending notification threshold, queries and
exclusions. Opening it starts no text input. Numeric fields offer presets and
custom input, remote vacancies use Yes/No, and city accepts an ordinary name.
Models come from the current setting and server OpenRouter configuration, with
an inherited default and custom ID option. This is neither the full provider
catalog nor an availability check.

Phrase lists show eight entries per page, with confirmed addition/removal.
The last query cannot be deleted and exact duplicates are ignored. Adding a
phrase opens its page. Each change shows a concise difference and Save/Cancel;
saving returns to the current panel or list. The notification threshold remains
a notification, not a spending cap.

Migration 036 adds `job_setting_value` together with the repository allowlist
and closed context. Existing scope, revision, expiry and single consumption
remain. Navigation cancels input; invalid values allow retry. Previously issued
legacy editors stay compatible. Changes make no AI/HH calls and do not affect
profiles or letter submission confirmations. No dependencies were added.

Checks: server 652/652, Telegram gate 65/65, real PostgreSQL job acceptance 28/28,
including four new panel scenarios. Actual message/menu handlers and the real
interaction repository cover fields, lists, models, returns, bounds, confirmation,
stale buttons, scope, cancellation and replay. Migration was exercised on a separate
temporary PostgreSQL instance; production is unchanged.

Release requires separate authorization, GitHub main, both VPS source updates
and only the DE server rollout with migration 036. Browser, collector and Desktop
need no rebuild. Remaining release checks are real Telegram panel/input/return
acceptance and full runtime migrations with pgvector.
