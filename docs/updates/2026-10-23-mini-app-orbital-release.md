# Выпуск орбитального Mini App / Orbital Mini App release

[Русский](#русский) | [English](#english)

## Русский

23 октября по поручению владельца выпущены согласованные UX-исправления и единый
дизайн Mini App. Код опубликован в GitHub `main`:
`ce1b2ed7a02031c084c4783a065459dfac921a34`.

Планеты и фон соответствуют дашборду, планеты движутся по орбитам. Оформлены
диалог, память, документы, устройства, Life OS, управление доступом и Jarvis-экраны
HH. VPN и Operations сохраняют информационные представления. Исправлены история
переходов, возврат, повтор чтения и сохранение черновика диалога. Неизвестные
операции проверяются по исходному ID. Убраны плашка имени/Telegram ID, постоянное
сообщение роли и декоративные подписи CORE/ПРОСТРАНСТВО; выход находится в шапке.

| Узел | Подтверждённый результат |
| --- | --- |
| GitHub и Windows | Код в `main`, чистые исходники совпадают |
| DE и NL source | Fast-forward до опубликованного кода, source guard прошёл на обоих VPS |
| DE Server | Релиз `/home/deploy/releases/jarvis-ce1b2ed-mini-orbital`, образ `jarvis-mini-orbital:ce1b2ed`, healthy |
| Остальные контейнеры DE | ID сохранены; окружение всех работающих контейнеров совпадает с состоянием до замены сервера |
| Desktop и Host Agent | Установленные файлы совпадают с принятой версией; обновление этих компонентов не требовалось |

На Windows и внутри нового Linux-образа прошли 792/792 server tests без пропусков.
Client/interiors/HH browser fixtures прошли; повторная проверка орбитального UI
на принятой `main` прошла. Независимая ревизия не обнаружила блокирующих дефектов.
После объединения свежей документации обновлены две проверки её формата:
извлечение подписей клавиатуры и поиск ссылок в карте документации. Проверка
клавиатуры учитывает актуальное личное разрешение `jobs` участника.

Preflight, release guard, внешние live/ready smoke и сверка десяти публичных
Mini App assets с содержимым образа прошли; ответы имеют `Cache-Control: no-store`.
Env сверено без вывода значений; секреты сохранены через hard links, их исходные
inode не удалялись. Заменён только server с `--no-deps --no-build`.
Итоговая `release-status --fetch --vps --desktop-app … --check` не нашла расхождений.
Завершённые ветки проверены на включение в `main` и удалены; чистые рабочие папки
сохранены. Последующая запись результата меняет только документацию и не требует
перезапуска приложений.

Остаётся живое принятие на физическом телефоне в Telegram: owner/admin/member,
клавиатура, cookies/BackButton, плавность и настоящий HH-вход. Тестовые данные и
публичные assets не подтверждают эти сценарии. Backup timer и backup/restore
не включались.

Предыдущие этапы сохранены: [UX](2026-10-23-mini-app-ux-development.md),
[орбиты](2026-10-23-mini-app-orbital-development.md),
[внутренние экраны](2026-10-23-mini-app-interiors-development.md).

## English

On October 23, the owner authorized publication of the agreed Mini App UX fixes
and shared design. The code is published in GitHub `main` at
`ce1b2ed7a02031c084c4783a065459dfac921a34`.

Planets and sky follow the dashboard, with planets moving along their orbits.
Chat, memory, documents, devices, Life OS, access administration and Jarvis-owned
HH screens share the theme. VPN and Operations retain informational views.
Navigation history, return actions, read retries and chat draft retention were
fixed. Unknown operations are reconciled using their original ID. The name/Telegram
ID badge, persistent role notice and decorative CORE/WORKSPACE captions were
removed; sign out is in the header.

| Node | Verified result |
| --- | --- |
| GitHub and Windows | Code is in `main`; clean source matches |
| DE and NL source | Fast-forward to the published code; source guard passed on both nodes |
| DE Server | Release `/home/deploy/releases/jarvis-ce1b2ed-mini-orbital`, image `jarvis-mini-orbital:ce1b2ed`, healthy |
| Other DE containers | IDs preserved; all running container environments match the pre-switch state |
| Desktop and Host Agent | Installed files match the accepted version; no component update was required |

All 792 server tests passed without skips on Windows and inside the new Linux
image. Client/interiors/HH browser fixtures passed; the orbital UI suite passed
again on accepted `main`. Independent review found no blocking defects. After
merging the current documentation, two format checks were updated: extracting
keyboard labels and finding links in the documentation map. The keyboard check
accounts for the member's current personal `jobs` permission.

Preflight, release guard, external live/ready smoke and comparisons of ten public
Mini App assets against the image passed; responses use `Cache-Control: no-store`.
Environment values were compared without printing them. Secrets were preserved
through hard links, keeping their original inodes. Only server was replaced,
using `--no-deps --no-build`. The final
`release-status --fetch --vps --desktop-app … --check` found no differences.
Completed branches were verified as included in `main` and deleted; clean
worktrees were retained. The subsequent result record changes documentation only
and requires no application restart.

Live acceptance on a physical phone in Telegram remains: owner/admin/member,
keyboard, cookies/BackButton, smoothness and real HH login. Fixtures and public
assets do not prove these scenarios. Backup timer and backup/restore were not
enabled.

Earlier stages remain available: [UX](2026-10-23-mini-app-ux-development.md),
[orbits](2026-10-23-mini-app-orbital-development.md),
[interior screens](2026-10-23-mini-app-interiors-development.md).
