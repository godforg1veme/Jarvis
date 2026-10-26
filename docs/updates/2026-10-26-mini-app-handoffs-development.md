# Mini App: переходы к действиям бота и Operations

[Русский](#русский) | [English](#english)

## Русский

Продолжение: [списки, карточки и история, локальный этап 4](2026-10-26-mini-app-lists-development.md).

26 октября локально подготовлен этап 3
[общего плана](../superpowers/plans/2026-10-26-mini-app-button-reliability.md).
Он продолжает [исправления этапов 1–2](2026-10-26-mini-app-button-reliability-development.md).
Работа остаётся в `codex/mini-app-button-reliability`, без публикации и изменений VPS.

Личные разделы Mini App показывают, какие действия доступны в боте, и открывают
сразу соответствующее меню. Это работает для памяти, документов, устройств,
Life OS, HH, VPN и Operations. В поиске работы переход находится рядом с
существующей панелью подключения HH и резюме; работает и при пустом списке.
Ссылка использует реальное имя уже инициализированного бота. Если оно неизвестно,
Mini App объясняет ручной переход, не подставляя другой адрес.

Кнопка внутри Telegram использует штатный метод открытия ссылки. Без SDK или при
его отказе остаётся HTTPS-ссылка. URL, вид перехода и раздел проверяются; подпись
рисуется текстом. Параметры содержат только закрытое имя раздела, без ID ресурсов,
пользовательского текста, credentials и подтверждений. Переход открывает меню,
но не подтверждает изменение. Как и обычная навигация бота, он отменяет активный
пошаговый ввод после проверки доступа.

VPN и Operations сохраняют ограничение владельца. Прямая кнопка Operations
доступна только при безопасном настроенном HTTPS origin. Общий валидатор теперь
также защищает старую кнопку бота: адрес с данными входа, посторонним путём,
query или fragment не попадает в интерфейс. Вход в Operations по-прежнему нужно
отдельно подтвердить в боте. Права пользователя проверяются повторно в обоих
клиентах; ссылка не даёт полномочий. Новых callback families и guided kinds нет.

Проверки: server **874/874** без пропусков с изолированной PostgreSQL 16,
Mini App PostgreSQL **13/13**, focused navigation/menu tests **48/48**.
Проверка на PostgreSQL проходит путь от URL личного раздела до настоящего
обработчика меню и проверяет отзыв права в БД. Браузерный набор проверяет SDK,
fallback, некорректные ссылки, пустые списки и HH на 390/1280 px; все внешние
переходы в нём перехвачены локально. Независимая ревизия дефектов не выявила.
Сборка и семь последовательных браузерных наборов прошли: client, interiors,
orbital, HH touch, reliability, HH connection races и section handoffs.

Для установки всей ветки нужна также миграция 049 из этапов 1–2; этап 3 новой
миграции не добавляет. Настоящие Telegram WebView/телефон, owner/member и вход в
Operations ещё требуют приёмки после разрешённого выпуска. Следующими остаются
обновление и последовательная загрузка списков, карточки, объяснение отдельной
истории и перенос пользовательских действий через общие серверные сервисы.

Протокол переходов: [Telegram deep links](https://core.telegram.org/bots/features#deep-linking)
и [Mini App API](https://core.telegram.org/bots/webapps#initializing-mini-apps).

## English

Follow-up: [lists, cards and history, local stage 4](2026-10-26-mini-app-lists-development.md).

On October 26, stage 3 of the
[shared plan](../superpowers/plans/2026-10-26-mini-app-button-reliability.md) was
prepared locally, following [stages 1–2](2026-10-26-mini-app-button-reliability-development.md).
Work remains on `codex/mini-app-button-reliability`, without publication or VPS changes.

Personal Mini App sections explain which actions are available in the bot and
open the corresponding menu directly: memory, documents, devices, Life OS, HH,
VPN and Operations. Job search retains its HH connection and resume panel beside
the handoff, including empty lists. Links use the actual initialized bot's
username. If unavailable, the Mini App explains manual navigation instead of
substituting another destination.

Clicks inside Telegram use its native link-opening method. Without the SDK or
when it fails, the HTTPS anchor remains available. URL shape, destination kind
and section are checked; labels render as text. Startup parameters contain only
closed section names, without resource IDs, user text, credentials or confirmations.
Navigation opens a menu and never approves a change. As with existing bot menu
navigation, it cancels active guided input after access checks.

VPN and Operations remain owner-only. The direct Operations button is offered
only for a safe configured HTTPS origin. The shared validator also protects the
existing bot button: credentials, unrelated paths, queries and fragments cannot
enter its URL. Operations login still requires separate approval in the bot.
Current permissions are checked in both clients; links grant no authority.
No callback families or guided-input kinds were added.

Verification: server **874/874**, without skips using isolated PostgreSQL 16;
Mini App PostgreSQL **13/13**; focused navigation/menu tests **48/48**. PostgreSQL
acceptance follows the section URL through the real message/menu handler and
checks database permission revocation. Browser fixtures cover SDK methods,
fallback, malformed links, empty lists and HH at 390/1280 px; all external
destinations are intercepted locally. Independent review found no defects.
The build and seven sequential browser suites passed: client, interiors,
orbital, HH touch, reliability, HH connection races and section handoffs.

Installing the full branch also requires migration 049 from stages 1–2; stage 3
adds no migration. Actual Telegram WebView/phone, owner/member and Operations
login acceptance remain for an authorized release. Upcoming work covers refreshing
and loading further list pages, cards, explaining separate chat history and
adding user actions through shared server services.

Protocol references: [Telegram deep links](https://core.telegram.org/bots/features#deep-linking)
and [Mini App API](https://core.telegram.org/bots/webapps#initializing-mini-apps).
