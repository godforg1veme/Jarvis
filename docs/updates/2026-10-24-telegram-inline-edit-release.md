# Telegram: обновление сообщений и сворачиваемое меню

[Русский](#русский) | [English](#english)

## Русский

24 октября 2026 года по поручению владельца обе правки опубликованы в GitHub
`main` и установлены на DE. Runtime commit:
`e8571220431adf73c8f5582ed80538f1e469123d`, образ `jarvis-telegram:e857122`.
Последующая запись результата меняет только MD-файлы и не требует пересборки.

Текстовые inline-кнопки всех разделов редактируют нажатое сообщение.
Просмотр старой вакансии, подготовка отклика и возврат остаются на её месте
в истории чата, даже если ниже появились новые карточки. Длинные тексты
полностью показываются страницами в том же сообщении; возврат доступен на
каждой странице. Кнопки остальных действий появляются после полного текста.
Перелистывание не повторяет исходную операцию. Новые вакансии, ответы на
написанный текст, фотографии, документы и выдаваемые файлы сохраняют собственную
отправку. Права, ревизии, сроки и отдельное подтверждение отклика сохранены.

Нижнее меню отправляется с `is_persistent: false`, `one_time_keyboard: false`:
бот больше не просит постоянно показывать его при скрытой обычной клавиатуре.
Меню можно свернуть и открыть значком возле поля ввода; автоскрытие после выбора
не запрашивается. Telegram управляет первым показом, прокруткой и сохранённой
видимостью. Строго ручной показ во всех клиентах нельзя гарантировать Bot API.
Для обновления уже открытого чата нужно один раз отправить `/start`.

### Установка и проверки

| Узел или проверка | Результат |
| --- | --- |
| GitHub / Windows / DE / NL source | Опубликованная `main`, без локальных изменений и расхождения |
| DE server | Новый образ, `healthy`, без перезапусков после старта; 343 исходных файла и build inputs совпадают |
| Контейнеры DE | Пересоздан только server; семь остальных контейнеров сохранили IDs |
| Окружение | 87 переменных server совпадают с прежним runtime; окружение семи Compose-сервисов сверено без вывода значений |
| Данные и секреты | Сопоставления volumes/networks сохранены, содержимое и права смонтированного секрета совпадают; прежний release не заменялся |
| Тесты | Server 811/811 локально; Telegram 75/75 в новом образе, без сети и production volumes |
| HTTPS | `/health/live`, `/health/ready`: smoke прошёл |
| NL | Source обновлён; Host Agent и VPN не менялись |
| Desktop | Установленная 1.0.2 совпадает: 146 файлов, Electron native и bundled runtime; EXE не пересобирался |

Страницы привязаны к Telegram user/chat/message и внутренним user/conversation,
проверяют текущие права. Кэш содержит максимум 200 снимков на 10 минут и теряется
при перезапуске; чужой или истёкший callback показывает безопасное уведомление.
Клики по одному сообщению обрабатываются последовательно. Ошибка редактирования
не создаёт новое сообщение и не повторяет действие. У быстрых операций alert
является первым callback-ответом; после 1,5 секунды бот останавливает spinner,
и последующий alert уже не гарантирован клиентом. Ошибки доставки сохраняют
только закрытые диагностические коды.

Независимая ревизия проверила scope, гонку редактирования и обработку ACK;
подтверждённые замечания исправлены. Настоящие owner/member нажатия, длинное
письмо, сворачивание и прокрутка в Telegram, а также уведомление после ошибки
долгой операции остаются отдельной приёмкой. Тесты с подменой Bot API не заменяют
эти проверки. Реальный отклик в HH этим выпуском не отправлялся.

Основные источники: [контракт](../telegram-menu-contract.md),
[архитектура](../telegram-button-architecture.md),
[локальный этап](2026-10-24-telegram-inline-edit-development.md).

## English

On October 24, 2026, the owner authorized publishing both changes to GitHub
`main` and installing them on DE. Runtime commit:
`e8571220431adf73c8f5582ed80538f1e469123d`, image `jarvis-telegram:e857122`.
The subsequent result record changes only Markdown files and needs no rebuild.

Text inline buttons across all sections edit the message that was clicked.
Viewing an old vacancy, preparing an application and returning remain at that
position in chat history, even with newer cards below it. Long text is shown
in full through pages in the same message, with return controls on every page.
Other action buttons appear after the complete text. Paging does not repeat
the original operation. New vacancies, replies to typed input, photos, documents
and delivered files retain their own delivery paths. Permissions, revisions,
expiry and separate application confirmation are preserved.

The bottom menu uses `is_persistent: false`, `one_time_keyboard: false`:
the bot no longer requests persistent display when the regular keyboard is
hidden. Users can hide and reopen the menu with the icon near the input field;
selecting an item does not request automatic hiding. Telegram controls initial
display, scrolling and remembered visibility. The Bot API cannot guarantee
strictly manual display in every client. Send `/start` once to update an already
open chat.

### Installation and verification

| Node or check | Result |
| --- | --- |
| GitHub / Windows / DE / NL source | Published `main`, with no local changes or divergence |
| DE server | New image, healthy, no restarts after startup; 343 source files and build inputs match |
| DE containers | Only server was recreated; seven other containers retained their IDs |
| Environment | All 87 server variables match the previous runtime; seven Compose-service environments compared without exposing values |
| Data and secrets | Volume/network mappings preserved; mounted secret bytes and permissions match; previous release directory retained |
| Tests | Local server 811/811; Telegram 75/75 in the new image without network or production volumes |
| HTTPS | `/health/live` and `/health/ready` smoke passed |
| NL | Source updated; Host Agent and VPN unchanged |
| Desktop | Installed 1.0.2 matches: 146 files, native Electron and bundled runtime; EXE was not rebuilt |

Pages bind to the Telegram user/chat/message and internal user/conversation,
and check current permissions. The cache holds at most 200 snapshots for 10
minutes and disappears on restart; foreign or expired callbacks show a safe
notice. Clicks on one message are processed in sequence. An edit failure neither
appends a message nor repeats the action. For fast operations, the alert is the
first callback answer; after 1.5 seconds the bot stops the spinner and the client
may not display a later alert. Delivery errors retain only closed diagnostic
codes.

An independent review checked scope, edit races and ACK handling; confirmed
findings were fixed. Real owner/member taps, a long letter, menu hiding and
scrolling in Telegram, and an alert after a slow-operation failure remain
separate acceptance checks. Tests with a substituted Bot API do not establish
these outcomes. No real HH application was submitted during this release.

Primary references: [contract](../telegram-menu-contract.md),
[architecture](../telegram-button-architecture.md),
[local stage](2026-10-24-telegram-inline-edit-development.md).
