# Единый дизайн внутренних экранов / Unified Mini App interiors

[Русский](#русский) | [English](#english)

Дополнение 23 октября: по замечанию владельца убраны имя/Telegram ID в шапке,
постоянная строка роли и проверки Telegram, декоративные подписи CORE/ПРОСТРАНСТВО.
Выход перенесён в шапку; сообщения входа и ошибок сохранены.

October 23 follow-up: removed the header name/Telegram ID, persistent role and
Telegram verification notice, and decorative CORE/WORKSPACE captions following
owner feedback. Sign out is in the header; login and error messages remain.

## Русский

Более новый результат: [выпуск 23 октября](2026-10-23-mini-app-orbital-release.md). Локальный статус ниже сохранён как история этапа.

23 октября локально завершено оформление существующих внутренних экранов Mini App
поверх [орбитальной оболочки](2026-10-23-mini-app-orbital-development.md).
Работа остаётся в `codex/mini-app-ux`, в отдельном worktree; GitHub и VPS не обновлялись.

Графитовые поверхности, серебристые действия, поля, карточки, иконки и отступы
применяются ко всем экранам. Предупреждения, ошибки и неизвестный результат
различаются по смыслу. Фокус видим, поля рассчитаны на телефон, длинные строки
и исходные IDs переносятся. Reduced motion сохраняется.

| Экран | Что оформлено и проверено |
| --- | --- |
| Диалог | Сообщения с автором, ввод, пустой диалог, загрузка, ошибка чтения, отправка и unknown с проверкой исходного запроса |
| Память | Карточки записей, фильтр загруженного списка, пустое состояние, безопасный показ текста |
| Документы | Название и статус отдельно, фильтр, отсутствие результатов, пустой список и ошибка чтения |
| Устройства | Карточки, понятные статусы, длинные имена, фильтр и пустое состояние |
| Life OS | Миссии и договорённости с существующими деталями/МСК, фильтр и пустое состояние |
| VPN и Operations | Информационные панели с серверными ограничениями; новых действий управления нет |
| Пользователи, роли, права | Списки, поиск, добавление, редакторы, защита владельца, блокировка, подтверждение и unknown |
| История доступа | Карточки событий, дата в МСК, пустой список и восстановление ошибки чтения |
| HH в Mini App | Подключение, временная ссылка, выбор резюме, основной профиль, автоподнятие, обновление, подтверждение и unknown |
| Окно входа HH | Общая Jarvis-тема, предупреждение о ссылке, клавиатура, Enter/Tab, отмена и описание защиты входа |

Внутренние карточки являются read-only и не обещают несуществующие операции.
Сама страница HH внутри снимка не перекрашивается. Серверные права и API,
границы подтверждений и запрет повтора неизвестных изменений сохранены.

На телефоне орбитальная сцена компактнее внутри раздела. При выборе поля ввода
панель разворачивается и остаётся развёрнутой до явного сворачивания. Это
устраняет обнаруженное при проверке смещение кнопки отправки при потере фокуса.
HH-пояснение о бесплатном поднятии сохранено в раскрываемом блоке с видимым
указанием ограничения в четыре часа. Временная ссылка получает отдельный busy-статус.

Проверки используют production-сборку и безопасные fixtures. Новый
`node scripts/testMiniAppInteriors.cjs` прошёл на 320/390/844/1280 px, включая
фильтры, пустые/error/confirmation/unknown состояния, защищённого владельца,
восстановление доступа и HH-настроек без повторного POST. Сохранены 35 PNG
в игнорируемой `.superpowers/mini-app-interiors/`, выполнен визуальный осмотр.
Сборка, основные client/orbital/HH touch проверки и server 792/792 без пропусков
прошли. Команды находятся в [verification](../verification.md).

Итоговая проверка этого этапа выполнена главным агентом. Отдельной
независимой ревизии новых внутренних экранов не было.

Реальный вход и клавиатура в Telegram, FPS физического телефона и Linux Docker
image этим этапом не подтверждены. Внешних отправок и реальных действий HH не было.
Desktop не менялся, пересборка EXE не нужна. Выпуск на VPS требует отдельного поручения.

## English

Superseded by the [October 23 release](2026-10-23-mini-app-orbital-release.md). The local status below is retained as stage history.

On October 23 the existing Mini App interiors were restyled on top of the
orbital shell. Work remains local on `codex/mini-app-ux` in a separate worktree;
GitHub and VPS installations have not been updated.

Graphite surfaces, silver controls, fields, cards, icons and spacing now cover
chat, memory, documents, devices, Life OS, informational VPN/Operations panels,
people/roles/access/audit, HH connection and resume settings, and the separate
Jarvis HH login shell. External provider pixels are unchanged. Lists expose only
existing read-only data and do not invent upload/delete/control actions.

Loading, empty, read-error, confirmation and unknown-result states share the
theme. Current authorization, APIs, source confirmations and original request
IDs are preserved. Audit timestamps use Moscow time. On phones, focusing a
workspace input expands the panel until explicitly collapsed, preventing the
send button from shifting on blur. HH raising guidance remains available in a
disclosure with a visible four-hour limit, and link creation shows a busy state.

The new `node scripts/testMiniAppInteriors.cjs` passed with built production
assets and fictional API fixtures at 320/390/844/1280 px. It covers filters,
empty/error/confirmation/unknown states, owner protection, access recovery and
HH setting reconciliation without duplicate mutations. Thirty-five PNGs are
saved under ignored `.superpowers/mini-app-interiors/` and were visually inspected.
Build, client/orbital/HH touch and all 792 server tests passed without skips;
commands are listed in the verification guide.

The main agent completed the final review; this interior stage did not receive
a fresh independent review. Actual Telegram login/keyboard,
physical phone FPS and a Linux Docker image remain unverified. No real HH actions
or external sends occurred. Desktop is unchanged and needs no EXE build.
