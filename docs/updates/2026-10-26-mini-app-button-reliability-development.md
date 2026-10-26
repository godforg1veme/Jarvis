# Mini App: надёжность диалога и кнопок

[Русский](#русский) | [English](#english)

## Русский

Продолжение: [локальный этап 3, переходы к действиям](2026-10-26-mini-app-handoffs-development.md).

26 октября 2026 локально исправлены этапы 1–2
[плана](../superpowers/plans/2026-10-26-mini-app-button-reliability.md).
Изменения находятся в `codex/mini-app-button-reliability`; на VPS не установлены.
Desktop runtime и Telegram callbacks не менялись.

- Ошибка обработки сообщения теперь имеет сохраняемую квитанцию `failed`.
  Клиент освобождает ввод после сверки по исходному UUID и не отправляет вопрос
  повторно. Неизвестный или отсутствующий результат сохраняет ожидание и UUID.
- Прерванный запрос старше пяти минут при сверке завершается как
  `request_expired`. Поздний исполнитель не может дописать ответ. Ответ и
  завершённая квитанция записываются одной транзакцией; потерянное подтверждение
  COMMIT сверяется по исходному ID без повторного вызова модели.
- Отмена HH и уход со страницы инвалидируют поколение запросов. Старые ответы
  и ошибки не показывают выбор резюме, не меняют новую сессию и её хранилище.
- Список доступа принимает только последнее обновление. Устаревшие success,
  503 и 401 не заменяют актуальный список и не закрывают действующую сессию.
- Перед выдачей сохранённого ответа сервер повторно проверяет доступ к
  ассистенту, включая повторный POST с тем же UUID.

Нужна forward-only миграция `049_mini_app_request_outcomes.sql`. Она применена
только в новых изолированных локальных тестовых схемах PostgreSQL 16.

Проверки: полный server suite **866/866**, без пропусков при подключённой
изолированной тестовой БД; Mini App PostgreSQL acceptance **12/12**. Новые
PostgreSQL сценарии проверяют ошибку модели, отсутствие повтора UUID,
истечение срока, откат сообщения при отказе квитанции и потерю COMMIT ack.
Браузерные fixtures проверяют терминальную ошибку после reload, сохранение
unknown, обратный порядок обновлений списка и гонки HH на 390/1280 px.
Сборка и все шесть наборов прошли: client, interiors, orbital, HH touch,
reliability и HH connection races. Ширины существующего interiors-набора:
320/390/844/1280 px.
Независимая ревизия не выявила оставшихся дефектов этапов 1–2.

Это локальный этап, не выпуск. Настоящие Telegram WebView/cookies, телефон,
owner/member и обновление production остаются непроверенными. Дальше по плану:
переходы к действиям бота/Operations, обновление и загрузка списков, карточки,
объяснение отдельной истории и последовательный перенос действий через общие
серверные сервисы. Эти пункты не считаются выполненными этой записью.

## English

Follow-up: [local stage 3, action handoffs](2026-10-26-mini-app-handoffs-development.md).

On October 26, 2026, stages 1–2 of the
[plan](../superpowers/plans/2026-10-26-mini-app-button-reliability.md) were fixed
locally. Changes are on `codex/mini-app-button-reliability` and are not installed
on either VPS. Desktop runtime and Telegram callbacks are unchanged.

- Failed message processing now has a durable `failed` receipt. The client
  releases input after reconciling the original UUID and never resends the
  question. An unknown or missing result retains the pending UUID.
- An interrupted request older than five minutes settles as `request_expired`
  when reconciled. A late worker cannot append an answer. The answer and its
  completed receipt share one transaction; a lost COMMIT acknowledgment is
  reconciled by the original ID without another model call.
- Cancelling HH or leaving the page invalidates the request generation. Old
  responses and errors cannot reveal the resume selector or change the new
  session and its storage.
- The access list applies only the latest refresh. Stale success, 503 and 401
  responses cannot replace current data or close the active session.
- Before returning a saved answer, the server rechecks assistant access,
  including duplicate POST requests with the same UUID.

Forward-only migration `049_mini_app_request_outcomes.sql` is required. It has
been applied only to new isolated local PostgreSQL 16 test schemas.

Verification: full server suite **866/866**, without skips when an isolated test
database is configured; Mini App PostgreSQL acceptance **12/12**. New PostgreSQL
cases cover model failure, UUID replay prevention, expiry, message rollback when
receipt completion fails, and lost COMMIT acknowledgment. Browser fixtures cover
terminal failure after reload, retained unknown results, out-of-order access
refreshes and HH races at 390/1280 px. Independent review found no remaining
defects in stages 1–2.
The build and all six suites passed: client, interiors, orbital, HH touch,
reliability and HH connection races. The existing interior suite covers
320/390/844/1280 px.

This is local development, not a release. Actual Telegram WebView/cookies,
physical phones, owner/member acceptance and production installation remain
unverified. Next stages cover bot/Operations navigation, refreshing and loading
lists, cards, explaining separate chat history and gradually adding actions
through shared server services. This record does not mark those stages complete.
