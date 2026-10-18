# Вход Mini App и удаление помощи / Mini App entry and Help removal

## Русский

18 октября 2026 выпущено на DE по поручению владельца. Код:
`32e9dde60aea6cfa8e9e20a18381473e271f4407`, server release
`/home/deploy/releases/jarvis-32e9dde-mini-entry`, image
`sha256:0235a41bdb05cd7304799ab38d6993b27b43e9e10e2f552bdc4517f8ed22ae66`.
GitHub main, Windows и исходники DE/NL синхронизированы. Пересоздан только server;
окружение и секреты сохранены, остальные контейнеры не менялись.

Раздел «Помощь» убран из нижней клавиатуры владельца и участников,
удалены справочный ответ и маршрут `/help`. Старый текст кнопки и команда
проходят обычную обработку с текущими правами; `/start` открывает главное меню.
Уже показанная клавиатура обновится при открытии «Главное» или `/start`.
В Bot API проверены default/private/owner commands и default/ru/en descriptions:
они пусты, отдельной зарегистрированной справки нет. Кнопка Mini App сохранена.

Перед исправлением на публичном Mini App воспроизведён экран без входа:
внешний Telegram SDK не загрузился, хотя synthetic launch fragment присутствовал.
Это возможная причина скриншота, а не доказанное состояние конкретного клиента.
Теперь клиент читает исходный `tgWebAppData` из fragment и передаёт его серверу,
даже если SDK недоступен. SDK загружается асинхронно. Вне Telegram без данных
запуска или действующей сессии доступ остаётся закрытым. Числовой ID не является
доказательством личности: сервер проверяет HMAC, срок и membership как прежде.
Приложение не записывает данные запуска в browser storage или логи.

Проверено:

- Build Mini App, Desktop assets и `git diff --check` прошли.
- Все 742 server tests прошли локально и в собранном Linux Docker image.
- Production browser fixtures прошли: отсутствие SDK с разрешением сервера,
  отказ сервера для fragment, прежние формы/права/личные разделы и размеры экрана.
- На публичном HTTPS: live/ready и Mini App — 200, анонимный `/mini/api/me` — 401.
  При заблокированном SDK synthetic fragment отправлен один раз; неправильная
  подпись получает 400, приложение остаётся закрытым, sessionStorage пуст.
- Новый server healthy, без перезапусков; ID остальных контейнеров сохранены.
  Desktop runtime не менялся, пересборка EXE не требовалась.

Настоящий вход владельца и плавность 3D на его устройстве остаются для клиентской
приёмки. Публичная проба с неверной подписью проверяет безопасный отказ;
успешный вход без SDK подтверждён browser fixture, а не реальным Telegram.

## English

Released on DE on October 18, 2026, with owner authorization. Code:
`32e9dde60aea6cfa8e9e20a18381473e271f4407`, server release
`/home/deploy/releases/jarvis-32e9dde-mini-entry`, image
`sha256:0235a41bdb05cd7304799ab38d6993b27b43e9e10e2f552bdc4517f8ed22ae66`.
GitHub main, Windows and DE/NL source checkouts are synchronized. Only the server
container was recreated; environment values, secrets and other containers remain.

Help was removed from owner/member bottom keyboards, together with its
descriptive answer and `/help` navigation route. Old button text and the command
use ordinary input handling with current permissions; `/start` opens Home.
Opening Home or `/start` refreshes a previously displayed keyboard. Bot API
checks found empty default/private/owner command lists and default/ru/en
descriptions, with no registered Help entry. The Mini App menu button remains.

Before the fix, a public Mini App probe reproduced the failed-entry screen:
the remote Telegram SDK did not load despite a synthetic launch fragment.
This is a possible cause of the screenshot, not a confirmed state of that client.
The client now reads raw fragment `tgWebAppData` and submits it to the server
even when the SDK is unavailable. The SDK loads asynchronously. Outside Telegram,
access still requires launch data or an existing session. A numeric ID is not
proof of identity: the server retains HMAC, expiry and membership checks.
The application never writes launch data to browser storage or logs.

Verified:

- Mini App build, Desktop asset check and `git diff --check` passed.
- All 742 server tests passed locally and in the built Linux Docker image.
- Production browser fixtures passed: missing SDK with server approval,
  fragment rejection, existing forms/permissions/private sections and screen sizes.
- Public HTTPS: live/ready and Mini App return 200; anonymous `/mini/api/me`
  returns 401. With the SDK blocked, the synthetic fragment is submitted once;
  an invalid signature returns 400, the app stays closed and sessionStorage is empty.
- The new server is healthy with no restarts; other container IDs are unchanged.
  Desktop runtime is unchanged, so no EXE rebuild was needed.

Actual owner login and 3D performance on their device still need client
acceptance. The public invalid-signature probe verifies safe rejection;
successful entry without the SDK is established by a browser fixture, not a real
Telegram client.
