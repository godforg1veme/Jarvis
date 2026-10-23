# Автоматическая модель поиска работы / Automatic job model

Владелец поручил полностью убрать ручной выбор модели, включая старые настройки,
и выбирать модель автоматически. Удаляются пункт панели, ручной ID, callbacks
этого поля, старый текстовый ввод, персональное поле `settings.model` и
серверная переменная `JARVIS_JOB_MODEL`.

Генерация писем использует существующий `FreeFirstProvider`: свежий проверенный
каталог, бесплатная очередь, затем настроенные общие платные модели по цене.
Сетевой unknown не повторяется на другой модели; предел цены и учёт usage
сохраняются. Генерация начинается по прежнему запросу пользователя, отправка
письма сохраняет отдельное подтверждение.

Migration 045 удаляет только model из сохранённых settings, аннулирует старые
settings previews с этим полем и активный ввод model. Фильтры, состояние поиска,
checkpoint и история не меняются. Старые кнопки не включают ручной режим.
Новые зависимости и changing actions не добавляются. Выпуск отдельно согласуется.

The owner requested complete removal of manual model selection. Remove its UI,
callbacks/input, saved per-user field and dedicated job-model environment setting.
Use the existing free-first router with catalog/price checks, global paid fallback,
unknown-outcome safeguards and usage accounting. Generation remains user-triggered
and sending retains its confirmation. Migration 045 removes obsolete selections
and invalidates old model inputs/previews without changing filters or progress.
Deployment remains separately authorized.
