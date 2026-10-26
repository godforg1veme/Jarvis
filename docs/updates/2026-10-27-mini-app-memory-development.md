# Mini App: операции с памятью / Memory actions

[Русский](#русский) | [English](#english)

## Русский

Позднее 27 октября оба дополнительных теста и замечания общей ревизии исправлены.
Более новый результат: [выпуск кнопок и памяти](2026-10-27-mini-app-buttons-release.md).

27 октября локально готов первый раздел этапа 5
[плана](../superpowers/plans/2026-10-26-mini-app-button-reliability.md):
добавление, исправление и удаление памяти в Mini App. Перед сохранением
показывается текст изменения; удаление требует отдельного подтверждения.
Кнопки исправления и удаления находятся внутри раскрытой карточки.
Если серверный сервис записи не подключён, раздел остаётся доступен для чтения.
Ветка `codex/mini-app-button-reliability` не опубликована; VPS не обновлялись.

Все три действия используют общий `MemoryService`. Изменение, история версии
и квитанция результата записываются в одной транзакции. Проверяются актуальные
права, живая сессия, владелец записи и SHA-256 её исходного содержимого.
Изменение прав и запись сериализуются. Устаревшая карточка не перезаписывает
изменённую или удалённую запись. Подтверждения бота не переиспользуются.

До отправки браузер сохраняет только исходный UUID и числовой Telegram ID,
без текста памяти. При недоступном sessionStorage запрос не отправляется.
После потери ответа, перезагрузки или нового входа того же пользователя можно
проверить исходную операцию. Отсутствующая квитанция не разрешает повтор под
новым ID. Кнопка отмены атомарно возвращает завершённый результат либо сохраняет
запрет на выполнение этого UUID; поздний запрос уже не изменит память.
При конфликте интерфейс предлагает проверить или отменить исходную операцию.

Общий фильтр чувствительных данных дополнен известными форматами ключей,
длинных Bearer credentials, заголовков приватных ключей и VPN URI.
Он не гарантирует распознавание произвольного неизвестного секрета.
Квитанции не содержат исходного текста, только хеш параметров и ID результата.

Проверено: Mini App build, **877/877** серверных тестов без пропусков,
**22/22** PostgreSQL acceptance и восемь браузерных наборов на production assets.
Новый браузерный набор проверяет подтверждения, три действия, двойной клик,
безопасный вывод текста, потерю ответа и reload, исходный UUID, отсутствующую
квитанцию, отмену, конфликт, отзыв доступа, недоступные хранилище/сервис и
раскладку на 390/1280 px. Скриншоты обоих размеров просмотрены.
Независимая security-ревизия выполнена; подтверждённых дефектов после исправлений
не осталось. PostgreSQL-сценарии выполнялись последовательно: создание и удаление
расширения pgvector в отдельных schema конфликтует между параллельными fixtures.
Полный pipeline из **53 миграций** применён в изолированной тестовой PostgreSQL.

Дополнительный `jobFullRuntimeAcceptance.cjs` не принят: fixture сначала ожидает
старую модель назначения владельца, а при её уточнении создаёт HH-репозитории
без обязательного AccessService. Production-проверки прав не ослаблялись;
этот fixture в рамках этапа не менялся. Отдельный дизайн-превью тест
`testMiniAppPreview.cjs` не прошёл ожидание остановки кадров кнопкой паузы.
Оба результата не входят в восемь прошедших production browser suites.

Для всей локальной ветки нужны миграции 049–051. Живые Telegram WebView,
телефонная клавиатура и два аккаунта остаются для разрешённого выпуска.
Этап 5 целиком не завершён: следующие разделы и ручная сверка HH unknown
остаются в плане. Этап 6 также открыт.

## English

Later on October 27, both additional tests and full-branch review findings were fixed.
Newer result: [buttons and memory release](2026-10-27-mini-app-buttons-release.md).

On October 27, the first section of stage 5 of the
[plan](../superpowers/plans/2026-10-26-mini-app-button-reliability.md) is ready
locally: adding, correcting and forgetting memories in Mini App. A review shows
the proposed text before saving; forgetting requires explicit confirmation.
Correction and deletion buttons appear inside expanded cards. If the server
write service is not connected, the section remains available for reading.
The `codex/mini-app-button-reliability` branch is unpublished; VPS nodes were not updated.

All three actions use the shared `MemoryService`. The change, version history
and result receipt commit in one transaction. Current permissions, a live
session, record ownership and the SHA-256 of its original content are checked.
Access changes and writes are serialized. Stale cards cannot overwrite changed
or forgotten records. Bot confirmations are not reused.

Before sending, the browser persists only the original UUID and numeric Telegram
ID, without memory text. Unavailable sessionStorage prevents sending. Following
a lost reply, reload or a fresh login by the same user, the original operation
can be checked. A missing receipt never permits retrying with a new ID.
Cancellation atomically returns a completed result or records a tombstone that
prevents that UUID from executing; a late request cannot change memory.
Conflicts offer checking or cancelling the original operation.

The shared sensitive-data filter now covers known key formats, long Bearer
credentials, private-key headers and VPN URI schemes. It cannot guarantee
detection of arbitrary unknown secrets. Receipts contain no original text,
only a parameter hash and result ID.

Validation: Mini App build, **877/877** server tests without skips, **22/22**
PostgreSQL acceptance scenarios and eight browser suites against production
assets. The new browser suite covers confirmations, all three actions, double
clicks, safe text rendering, lost replies and reload, the original UUID, missing
receipts, cancellation, conflicts, revoked access, unavailable storage/service
and 390/1280 px layouts. Screenshots at both sizes were inspected. Independent
security review was completed; no confirmed defects remained after fixes.
PostgreSQL scenarios ran sequentially: creating and dropping pgvector in isolated
schemas conflicts between concurrent fixtures. The complete **53-migration**
pipeline was applied in isolated test PostgreSQL.

The additional `jobFullRuntimeAcceptance.cjs` was not accepted: its fixture first
expects the old owner-assignment model and, after correcting that setup, creates
HH repositories without the required AccessService. Production access checks
were not weakened; this fixture was not changed in this stage. The separate
`testMiniAppPreview.cjs` design-preview test failed its expectation that the
pause button stops frames. Neither result is included in the eight passing
production browser suites.

The complete local branch needs migrations 049–051. Actual Telegram WebView,
phone-keyboard and two-account acceptance remain for an authorized release.
Stage 5 is not complete: other sections and manual HH unknown reconciliation
remain in the plan. Stage 6 is also open.
