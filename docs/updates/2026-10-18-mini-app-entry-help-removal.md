# Вход Mini App и удаление помощи / Mini App entry and Help removal

## Русский

18 октября 2026, локальная правка по запросу владельца. Не опубликована.
Раздел «Помощь» убран из нижней клавиатуры владельца и участников,
удалены справочный ответ и маршрут `/help`. Старый текст кнопки и команда
проходят обычную обработку с текущими правами; `/start` открывает главное меню.
После выпуска уже показанная клавиатура обновится при открытии «Главное».

На публичном Mini App воспроизведён экран без входа: внешний Telegram SDK
не загрузился, хотя synthetic launch fragment присутствовал. Это воспроизводит
возможную причину скриншота, но не доказывает состояние конкретного клиента.
Клиент теперь читает исходный `tgWebAppData` из fragment и передаёт его серверу,
даже если SDK недоступен. SDK загружается асинхронно. Вне Telegram без данных
запуска или действующей сессии доступ остаётся закрытым. Числовой ID не является
доказательством личности: сервер проверяет HMAC, срок и membership как прежде.
Данные запуска не записываются в browser storage или логи.

Проверки: production browser fixtures, в том числе заблокированный SDK с
серверным разрешением/отказом, прошли. Build Mini App, проверка Desktop assets, `git diff --check` и все
742 server tests с обновлённым контрактом меню прошли. Живой телефон и обновление
бота требуют отдельной публикации по правилу AGENTS.md.

## English

October 18, 2026, owner-requested local change. Not published.
Help was removed from owner/member bottom keyboards, together with its
descriptive answer and `/help` navigation route. Old button text and the command
use ordinary input handling with current permissions; `/start` opens Home.
After release, opening Home refreshes a previously displayed keyboard.

A public Mini App probe reproduced the failed-entry screen: the remote Telegram
SDK did not load despite a synthetic launch fragment. This reproduces a possible
cause of the screenshot, not the state of that particular client. The client now
reads raw fragment `tgWebAppData` and submits it to the server even when the SDK
is unavailable. The SDK loads asynchronously. Outside Telegram, access still
requires launch data or an existing session. A numeric ID is not proof of identity:
the server retains HMAC, expiry and membership checks. Launch data is never
written to browser storage or logs.

Production browser fixtures passed, including a blocked SDK with server approval
and rejection. The Mini App build, Desktop asset check, `git diff --check` and
all 742 server tests passed with the updated menu contract. Actual phone acceptance and bot deployment require
separate publication authorization under AGENTS.md.
