# Telegram: обновление сообщений на месте

[Русский](#русский) | [English](#english)

## Русский

24 октября 2026 года. Изменения подготовлены локально в
`codex/telegram-inline-edit`. GitHub, VPS и установленное приложение этим этапом
не обновлялись.

По дополнительному запросу владельца нижнее меню больше не отправляется с
признаком постоянного показа: `is_persistent: false`, `one_time_keyboard: false`
для всех ролей и исходящей проверки. Меню можно свернуть и открыть значком
около ввода; автоскрытие после выбора пункта не запрашивается. Telegram управляет
первым показом, прокруткой и сохранённой видимостью, поэтому строго ручной показ
во всех клиентах нельзя гарантировать через Bot API. Существующий чат получит
новые флаги после установки и следующего открытия главной или `/start`.

Кнопки текстовых сообщений редактируют сообщение, на котором нажаты. Старая
вакансия остаётся на своём месте при просмотре, выборе письма и возврате, даже
если ниже уже пришли новые карточки. Длинный текст полностью показывается
страницами внутри того же сообщения. Возврат доступен на каждой странице,
остальные кнопки действий появляются после полного текста. Перелистывание
не генерирует письмо заново и не повторяет отправку.

Страницы связаны с исходными пользователем, чатом, сообщением и диалогом;
права проверяются заново. Кэш ограничен 200 снимками на 10 минут, находится
только в памяти процесса и очищается при перезапуске. Просроченная или чужая
страница даёт безопасное уведомление. Быстрые нажатия на одно сообщение
обрабатываются последовательно. Обычные ответы на написанный текст, фотографии,
документы и delivery-only artifacts сохраняют отдельную отправку.

Ошибка редактирования не создаёт сообщение внизу чата и не повторяет действие.
На быстром пути всплывающее уведомление является первым ответом на callback.
Для долгих действий через 1,5 секунды бот останавливает индикатор ожидания;
показ уведомления об ошибке после этого ответа не гарантирован Telegram.
Если уведомление также не доставлено, остаётся закрытый код ошибки в логе.

Проверки: Telegram gate 75/75; полный server suite 811/811, без пропусков.
Новые 9 тестов проходят через настоящий Bot dispatcher и message service с
подменой Bot API transport. Проверены исходный ID сообщения при новых карточках
ниже, возврат, полный текст по страницам, чужой scope, отзыв прав в обоих
проверочных шагах, expiry/restart, duplicate update, not-modified, ошибка
редактирования и одновременные нажатия. Отдельная ревизия проверила scope и
обработку гонки; её замечания учтены. PostgreSQL-схема, guided kinds и production
зависимости не менялись.

Остаётся порученный владельцем выпуск серверного компонента и живая проверка
Telegram: owner/member, старая вакансия, длинное письмо, возврат и ошибка после
долгой операции. Desktop не менялся, пересборка EXE не нужна. Автоматические
fixtures не подтверждают настоящую доставку Telegram или отправку отклика в HH.

Основные источники: [контракт меню](../telegram-menu-contract.md),
[архитектура](../telegram-button-architecture.md),
[решение](../superpowers/specs/2026-10-24-telegram-inline-edit-design.md).

## English

October 24, 2026. Changes are prepared locally on `codex/telegram-inline-edit`.
This stage did not update GitHub, either VPS or the installed application.

At the owner's additional request, the bottom menu is sent with
`is_persistent: false` and `one_time_keyboard: false` for every role and in outbound
validation. The user can hide and reopen it with the icon near the input field;
selecting a menu item does not request automatic hiding. Telegram controls initial
display, scrolling and remembered visibility, so strictly manual-only display
cannot be guaranteed across all clients through the Bot API. An existing chat
receives the new flags after installation and its next Home or `/start` delivery.

Text-message buttons edit the message that was clicked. An old vacancy stays
at its original position during viewing, letter selection and return navigation,
even when newer cards have arrived below it. Long text is shown in full through
pages within the same message. Return controls remain on every page; other action
buttons appear after the complete text. Paging neither regenerates a letter nor
repeats submission.

Pages bind to the original user, chat, message and conversation, and recheck
current permissions. The process-memory cache holds at most 200 snapshots for
10 minutes and disappears on restart. Expired or foreign pages return a safe
notice. Rapid clicks on one message are processed in sequence. Normal replies
to typed input, photos, documents and delivery-only artifacts retain separate
delivery.

An edit failure neither appends a message nor repeats the action. On fast paths,
the error alert is the first callback answer. For slow actions, the bot stops
the spinner after 1.5 seconds; Telegram does not guarantee that an error alert
sent after that acknowledgement will appear. If the alert also fails, a closed
failure code remains in the log.

Verification: Telegram gate 75/75 and full server suite 811/811, with no skips.
The nine new tests run through the real Bot dispatcher and message service with
a substituted Bot API transport. They cover the original message ID with newer
cards below, return navigation, complete paged text, foreign scope, permission
revocation at both checks, expiry/restart, duplicate updates, not-modified,
edit failure and concurrent clicks. An independent review checked scope and
the race handling; its findings were addressed. No PostgreSQL schema, guided
kind or production dependency changed.

Owner-authorized server deployment and live Telegram acceptance remain pending:
owner/member, an old vacancy, a long letter, return navigation and failure after
a slow action. Desktop did not change and needs no EXE rebuild. Automated fixtures
do not establish real Telegram delivery or HH application submission.

Primary references: [menu contract](../telegram-menu-contract.md),
[architecture](../telegram-button-architecture.md),
[design](../superpowers/specs/2026-10-24-telegram-inline-edit-design.md).
