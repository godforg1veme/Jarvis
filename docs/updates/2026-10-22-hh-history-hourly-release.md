# История HH раз в час: выпуск 22 октября

[Русский](#русский) | [English](#english)

## Русский

По поручению владельца опубликован и установлен полный почасовой обход
истории HH для всех подключённых пользователей с действующим правом `jobs`.
Состояние поиска новых вакансий на него не влияет. Текущие проверки, checkpoint,
личные browser profiles, доступ и ручное обновление сохранены.
[Реализация и локальные проверки](2026-10-22-hh-history-hourly-development.md).

Код: `0de5e7f0efc42a76cd50a33abac0ac63be21698b`.
Release: `/home/deploy/releases/jarvis-0de5e7f-hh-history`.
На DE заменены только server и browser. Migration 044 применена автоматически
при запуске server. Оба контейнера healthy, restarts 0; сборщик возобновлён
с прежним образом и container ID. PostgreSQL, OCR, ASR и tunnel не заменялись.
Окружение совпало по 88 server и 11 browser ключам, volumes сохранены,
секретный bind mount сохранил inode. Исходники обоих VPS обновлены из GitHub main.

В новых Linux-образах прошли 787/787 server unit, 13/13 PostgreSQL history,
90/90 browser unit и 4/4 Chromium history fixtures, без пропусков.
Тестовые PostgreSQL и internal-сеть удалены. В server сверены 337 source/shared
файлов, в browser 45 исходных файлов; все 26 файлов готовых интерфейсов
совпали с прежним образом. Публичные live/ready проверки прошли.
Host Agent и VPN-службы обоих узлов активны; Desktop 1.0.2 совпадает по 146
файлам, Electron и bundled runtime. Его сборка не нужна.

Новые подписи различают архивные и неподтверждённые приглашения, у каждой
строки есть время проверки. Список сортируется по исходной дате HH, а не
дате импорта. Старые записи до полного обхода не имеют доказательства
актуальности. После установки чтение HH снова доступно: прежний ручной режим
больше не блокирует обновление. Первый фоновый обход завершён в 21:02:50 МСК:
27 страниц, 527 записей, ошибок нет; все записи имеют доказательство этого
полного обхода. Следующий автоматический обход станет доступен в 22:02:50 МСК.

Все десять записей со скриншота подтверждены именно в архиве HH. Их исходные
даты — от 10 декабря 2021 до 16 сентября 2024 года. В каждой реальной серверной
карточке проверена подпись «Приглашение (архив)». Это объясняет расхождение:
прежний список выдавал архивные приглашения без контекста и ставил их первыми
по времени импорта. Подтверждены также новая подпись почасового режима и время
проверки. Это проверка серверного представления, не нажатие из Telegram.

Server image: `sha256:3d9932acfcf2bec4287e9e889fe7c548ae40710bcb28c8859d5df88103081c09`.
Browser image: `sha256:ae8d6f3ddccfb2d34bd91bdd8ea0c1288b08b419ed9ca6206921a6f9b8188364`.
Приватные подтверждения: `/home/deploy/maintenance/hh-history-20261022`.
Следующий запуск через час и настоящие Telegram-нажатия ещё не наблюдались.
Локальные checkout и ветки других задач сохранены; предупреждение общего
inventory относится к Windows task branch, а не к отставанию VPS или runtime.

## English

At the owner's request, complete hourly HH history refresh was published and
deployed for every connected user with current `jobs` access. Vacancy-search
activation is independent. Existing runs, checkpoints, personal browser profiles,
access checks and manual refresh remain.
[Implementation and local verification](2026-10-22-hh-history-hourly-development.md).

Code: `0de5e7f0efc42a76cd50a33abac0ac63be21698b`.
Release: `/home/deploy/releases/jarvis-0de5e7f-hh-history`.
Only DE server and browser were replaced. Migration 044 applied on server
startup. Both are healthy with zero restarts; the collector resumed with its
previous image and container ID. PostgreSQL, OCR, ASR and tunnel were retained.
Environment matches across 88 server and 11 browser keys, volumes are retained,
and the secret bind mount retains its inode. Both VPS source checkouts match
GitHub main.

The Linux images passed 787/787 server unit, 13/13 PostgreSQL history,
90/90 browser unit and 4/4 Chromium history fixtures, without skips.
Disposable test PostgreSQL and its internal network were removed. All 337
server/shared source files and 45 browser files match the release; all 26
prebuilt UI assets match the previous image. Public live/ready checks passed.
Host Agent and VPN services remain active on both nodes. Desktop 1.0.2 matches
146 files, Electron and bundled runtime; rebuilding is unnecessary.

New labels distinguish archived and unconfirmed invitations, each row shows
its status-check time, and ordering uses original HH dates rather than import
time. Legacy rows are unconfirmed until a full pass supplies evidence. After
rollout HH reading became available again: the previous manual mode no longer
blocks it. The first background pass completed at 21:02:50 Moscow time: 27
pages and 527 records, without errors. Every record has proof from this full
pass. The next automatic pass becomes due at 22:02:50 Moscow time.

All ten screenshot records were confirmed in HH's archived section. Their
original dates range from December 10, 2021 to September 16, 2024. Each live
server-rendered detail now shows the archived invitation label. The old list
omitted archive context and put these rows first by import time. The hourly
notice and per-row timestamps were verified too. This is a server-rendered
view check, not a real Telegram tap.

Server image: `sha256:3d9932acfcf2bec4287e9e889fe7c548ae40710bcb28c8859d5df88103081c09`.
Browser image: `sha256:ae8d6f3ddccfb2d34bd91bdd8ea0c1288b08b419ed9ca6206921a6f9b8188364`.
Private evidence: `/home/deploy/maintenance/hh-history-20261022`.
The next hourly run and real Telegram taps have not yet been observed.
Other tasks' local branches/checkouts were preserved; inventory warnings
concern the Windows task branch, not VPS source or runtime drift.
