# UX Mini App: локальное исправление / Local Mini App UX repair

[Русский](#русский) | [English](#english)

## Русский

Более новый результат: [выпуск 23 октября](2026-10-23-mini-app-orbital-release.md). Локальный статус ниже сохранён как история этапа.

Позже 23 октября поверх этих исправлений реализован
[орбитальный интерфейс](2026-10-23-mini-app-orbital-development.md).
Ниже сохранён результат предшествующего этапа UX.

23 октября после браузерного аудита подготовлены исправления текущего Mini App.
Работа находится в отдельной ветке `codex/mini-app-ux`; публикации в GitHub и
установки на VPS не было. Орбитальный UI остаётся отдельным следующим этапом.

У личных разделов появились маршруты `#section/<permission>`. «Главная», логотип,
история браузера и перезагрузка больше не зависят от ручного скрытия экранов.
При открытии раздела заголовок получает фокус без принудительной прокрутки;
нижняя кнопка «Ассистент» отмечается только в диалоге. Якорь `#modules` сохранён.

Открытие диалога запускает одно чтение истории. Черновик сохраняется при переходах;
предупреждение о неизвестном результате и исходный request ID не стираются при
загрузке истории. Запоздалый ответ не заменяет другой экран или более свежую
историю. При уходе из HH освобождаются панель и её таймеры.

Пустые память, документы, устройства и Life OS показывают конкретное сообщение.
После ошибки чтения раздела или истории есть кнопка «Повторить». Она повторяет
чтение, а не изменение. Серверные подсказки, проверки прав, подтверждения и
проверка исходной операции сохраняются; Telegram bot menu и API не менялись.

Проверки: сборка Mini App, расширенный `node scripts/testMiniAppClient.cjs`,
`node scripts/testHhLoginTouch.cjs`, синтаксис и `git diff --check`. Браузерные
fixtures используют Edge и синтетические данные; проверены 320/390/1280 px,
семь нечатовых разделов, Home/логотип/Back/Forward/reload, права участника,
пустые состояния, повтор чтения, черновик, пересекающиеся чтения истории,
выход при отложенном чтении и восстановление неизвестного запроса.
Независимая ревизия выполнена; обнаруженное при ней стирание предупреждения
исправлено до итогового прогона.

Настоящие Telegram cookies/BackButton, клавиатура и FPS физического телефона,
реальный HH-вход не проверялись. Сервер и Desktop не менялись; установка EXE
не требуется. Проверка нового оформления станет возможна после его реализации.

[План](../superpowers/plans/2026-10-23-mini-app-ux.md).

## English

Superseded by the [October 23 release](2026-10-23-mini-app-orbital-release.md). The local status below is retained as stage history.

Later on October 23, the [orbital UI](2026-10-23-mini-app-orbital-development.md)
was implemented on top of these fixes. The preceding UX stage is retained below.

On October 23, browser-audit findings were addressed locally on
`codex/mini-app-ux`. No GitHub publication or VPS deployment was performed.
The orbital UI remains a separate next stage.

Personal sections now use `#section/<permission>` routes. Home, the brand link,
browser history and reload follow the same navigation handler. Section headings
receive focus without forced scrolling, only chat marks the Assistant dock link
as active, and the `#modules` anchor remains available.

Opening chat reads history once. Navigation retains the draft and loading history
preserves unknown-request feedback and the original request ID. Stale responses
cannot overwrite another section or newer chat history. Leaving HH disposes its
panel and timers. Empty lists have explicit feedback; failed section/history reads
offer a read-only retry. APIs, server notices, permission checks, bot menus and
mutation confirmation boundaries remain unchanged.

Validation: Mini App build, the extended `node scripts/testMiniAppClient.cjs`,
`node scripts/testHhLoginTouch.cjs`, syntax and `git diff --check`. Edge fixtures
cover 320/390/1280 px, seven non-chat sections, Home/brand/Back/Forward/reload,
member access, empty states, read retry, drafts, overlapping history reads,
logout during delayed reads and unknown-request recovery. An independent review
identified lost pending-request feedback; it was fixed before the final run.

Actual Telegram cookies/BackButton, physical phone keyboard/FPS and live HH login
remain unverified. Server and Desktop code did not change; no EXE update is needed.
The new visual design can only be tested after implementation.
