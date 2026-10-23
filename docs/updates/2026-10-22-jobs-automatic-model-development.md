# Автоматический выбор модели для писем HH

[Русский](#русский) | [English](#english)

## Русский

Обновление: [выпущено 23 октября](2026-10-23-jobs-automatic-model-release.md).
Ниже сохранён локальный результат до выпуска.

Подготовлено локально по поручению владельца 22 октября; итоговая проверка завершена 23 октября. Ручной выбор модели
полностью удалён из поиска работы: нет пункта панели, пресетов, ввода ID,
старого текстового параметра и callbacks поля. Удалены `settings.model`,
отдельная переменная `JARVIS_JOB_MODEL` и её передача через Compose.

Адаптер писем использует существующий `FreeFirstProvider`. Он проверяет
доступность и цену по свежему каталогу, сначала пробует бесплатную очередь,
затем настроенные общие платные модели по оценке стоимости. Предел цены,
таймаут, безопасные условия fallback и учёт usage сохраняются. При неизвестном
сетевом исходе новая модель автоматически не вызывается. Генерация и отправка
писем сохраняют прежние пользовательские действия и отдельное подтверждение.

Migration 045 удаляет сохранённый выбор у всех пользователей и аннулирует
старые подтверждения настроек с model и активный ввод этого поля. Фильтры,
состояние поиска, revision, checkpoint и progress сохраняются. Старые кнопки
не могут вернуть персональную модель.

Проверены 791/791 server unit, 66/66 Telegram gate и 26/26 сценариев отдельной PostgreSQL:
автоматическая генерация, панель, миграция и регрессии истории. Проверки
адаптера используют тестовый транспорт, включая бесплатный результат,
явный отказ бесплатных вариантов, переход к платному резерву и стоимость.
Настоящие платные запросы не выполнялись. Полный сценарий через локальные HTTP,
настоящие bot handlers и PostgreSQL прошёл автоматическую генерацию, правку,
перевод, подтверждённую отправку и сверку потерянного ответа по исходному ID.
Независимая ревизия не нашла подтверждённых дефектов кода. Указанные ею
устаревшие инструкции подключения и описание первого выпуска панели обновлены.

На VPS ещё не установлено. Для выпуска нужны migration 045 и новый server;
collector также обновляется из-за изменения общих defaults/schema настроек.
Browser и Desktop этим изменением не затронуты.

## English

Update: [deployed on October 23](2026-10-23-jobs-automatic-model-release.md).
The pre-release local record is retained below.

Prepared locally at the owner's October 22 request; final verification completed on October 23. Manual job-model
selection is removed entirely: menu item, presets, custom ID, legacy text input,
field callbacks, per-user `settings.model`, `JARVIS_JOB_MODEL` and its Compose
forwarding are gone.

The letter adapter reuses the existing persistent `FreeFirstProvider`. It checks
fresh catalog availability and prices, tries verified free models first and
then configured global paid models by estimated cost. Price ceilings, timeout,
safe fallback conditions and usage accounting remain. Unknown network outcomes
do not invoke another model. Generation and sending retain their existing
user actions and separate send confirmation.

Migration 045 removes saved overrides for all users and invalidates old model
previews/input. Filters, activation, revision, checkpoints and progress remain.
Old controls cannot restore a per-user model.

Checks passed: 791/791 server unit, 66/66 Telegram gate and 26/26 isolated PostgreSQL scenarios for
automatic generation, settings, cleanup migration and history regressions.
Adapter tests use fake transport for free success, explicit free-model failures,
paid fallback and usage. No real paid requests were made. The complete local
HTTP/bot/PostgreSQL scenario passed automatic generation, editing, translation,
confirmed submission and original-ID reconciliation after a lost acknowledgement.
Independent review found no confirmed code defects. The outdated connection
instructions and original panel description noted by the reviewer were updated.

Not deployed. Rollout requires migration 045 and a new server; the collector
also needs updating because shared settings defaults/schema changed. Browser
and Desktop are unaffected.
