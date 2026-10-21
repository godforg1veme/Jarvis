# Личный вход HH и управление с телефона / Personal HH sign-in and phone controls

## Русский

Более новый результат: [выпуск на DE и проверки](2026-10-21-hh-login-touch-release.md).
Ниже сохранена запись локальной разработки до публикации.

21 октября 2026 подготовлено локально по поручению владельца. Ветка
`codex/hh-login-touch`; GitHub и VPS этим этапом не обновлялись. Работа над
Operations UI в исходной папке сохранена отдельно.

Причина ошибки «Проверьте подключение к сети» подтверждена сравнением текущих
публичных скриптов HH и установленной browser policy: HH отправляет POST на
`/account/otp_generate` и `/account/login/by_code`, а Jarvis запрещал оба пути.
Добавлены только эти адреса. Проверки HTTPS origin, действия человека, профиля
и запрет посторонних изменений HH сохранены.

«Подключить HH» в Telegram или Mini App создаёт личную временную ссылку.
Пользователь получает её в своём private chat текстом и URL-кнопкой. Mini App
сохраняет собственную ссылку и отдельно показывает результат Telegram-доставки.
Нижняя клавиатура Telegram не меняется. Выбор основного резюме подтверждается
в исходной Mini App.

Миграция 040 добавляет состояние доставки и привязку адресата. Ticket
восстанавливается HMAC с отдельным назначением от существующего connect
секрета; в PostgreSQL остаётся только hash. Повторный запрос не меняет ссылку
и не продлевает срок. Конкурентная отправка получает один сохранённый claim;
unknown и потеря ответа не запускают вторую отправку. Перед отправкой
перепроверяются право jobs, revision и исходная личная привязка чата.
Ссылка не входит в историю Jarvis или логи; её текст отправляется только
соответствующему человеку, как он запросил.

В окне HH работают тапы по кнопкам и полям. Поле открывает локальный ввод
с подходящей клавиатурой, кнопка не открывает её. Значения полей не входят
в метаданные снимка: передаются только ограниченные координаты и тип ввода.
Печать, вставка, исправление, Unicode, composition и запасная нижняя панель
используют одну последовательность событий. Потерянный ответ сверяется по
исходному sequence; неподтверждённый ввод не повторяется. При закрытии
очередь больше не отправляет оставшиеся события.

Проверено локально:

- Server unit: 783/783, без пропусков. Отдельный Telegram gate: 66/66.
- Job browser: 70 прошли; 9 проверок Linux permissions пропущены на Windows.
- Настоящая отдельная PostgreSQL 16 на loopback: 14 acceptance-проверок
  доступа, Mini App и HH-сессий, включая доставку через реальные message/menu
  handlers, конкурентный повтор, restart/replay, unknown и отзыв права.
- Production Mini App browser fixtures: вход, права, подтверждения, исходные
  ID и старые кнопки; новый touch fixture на 390/1280 px использует настоящий
  Chromium и HhBrowser. Проверены тап, печать, редактирование, composition,
  Unicode, lost acknowledgement, отказ ввода, запасная панель и отмена.
- Сборка Mini App и `git diff --check` прошли. Зависимости не добавлялись.

Ограничения: VPS пока работает с прежним кодом; реальный вход Сени и системная
клавиатура iPhone ещё не приняты. Проверка полного pgvector migration pipeline
в этом Windows окружении не выполнялась: установленный PostgreSQL не содержит
расширение vector; migration 040 проверена на настоящей отдельной базе.
Desktop runtime не менялся; общий Desktop packaging-check в отдельной папке
не прошёл из-за отсутствующих локальных моделей Vosk и не является проверкой
изменённого компонента. Независимая финальная ревизия недоступна из-за лимита
исполнителей; итоговый diff и интеграцию проверил главный агент.

Для настоящей проверки нужны согласованный выпуск server/job-browser/Mini App
на DE, синхронизация исходников обоих VPS и вход пользователя. EXE не требуется.

## English

Newer result: [DE release and verification](2026-10-21-hh-login-touch-release.md).
The local development record below is preserved as pre-release history.

Prepared locally on October 21, 2026 with owner authorization, on
`codex/hh-login-touch`. This stage did not publish to GitHub or update either
VPS. The unrelated Operations UI work remains in its original checkout.

Current public HH scripts submit to `/account/otp_generate` and
`/account/login/by_code`; the deployed Jarvis browser policy rejected both.
Only these authentication paths are added. HTTPS origin, human-action and
profile guards and the rejection of unrelated HH writes remain.

Connecting HH from Telegram or the Mini App provides a private temporary link
as message text and a URL button. The Mini App retains its link and reports
Telegram delivery separately. Keep the Telegram bottom keyboard and resume
confirmation in the originating Mini App.

Migration 040 records delivery state and recipient binding. A purpose-specific
HMAC using the existing connect secret recovers a ticket; only its hash is stored.
Replays preserve the URL and expiry. One durable claim authorizes a send;
unknown outcomes never automatically send again. Current jobs access, revisions
and the private chat binding are rechecked. Links stay outside Jarvis history
and logs; message text is delivered only to the intended user as requested.

The HH window supports tapping buttons and fields, direct keyboard entry,
editing, paste, composition and Unicode. Only bounded geometry and keyboard
hints leave the browser as metadata, never field values. All controls share
one sequence stream and reconcile lost acknowledgements. The bottom panel
remains, and closing the page invalidates queued input.

Local checks: server 783/783; Telegram gate 66/66; job-browser 70 passed with
9 Windows skips for Linux permissions; 14 acceptance tests on a separate local
PostgreSQL 16, including actual Telegram message/menu handlers, concurrent
delivery, restart/replay, unknown and revoked access. Production Mini App
fixtures and real Chromium/HhBrowser touch fixtures at 390/1280 px passed,
as did the Mini App build and diff whitespace check. No dependencies were added.

Not yet verified: deployment, real member HH sign-in, and the iPhone system
keyboard. The complete pgvector migration pipeline was not run because this
Windows PostgreSQL lacks vector; migration 040 was exercised on a real isolated
database. Desktop is unchanged; its unrelated packaging check lacks local Vosk
models in this worktree. Final independent review was unavailable due to worker
usage limits; the main agent reviewed the diff and integration.

A release needs the server/job-browser/Mini App update on DE, both VPS source
syncs and member acceptance. No Desktop installer is needed.
