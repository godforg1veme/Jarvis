# HH: ручной ответ на капчу через Telegram

16 октября 2026. Владелец подтвердил сценарий: ответ на картинку является
командой ввести и один раз отправить текст в HH, без второй кнопки подтверждения.
Также поручил удалить использование Tailscale именно из HH во всех частях
проекта, GitHub и VPS. Остальные применения Tailscale сохраняются.

## Сценарий

При CAPTCHA сбор останавливается с сохранением фильтров, checkpoint и progress.
Бот присылает в личный чат владельца PNG только с картинкой CAPTCHA, без
адресной строки, страницы вакансии, account UI, cookies и скрытых полей.
Подпись просит использовать Telegram «Ответить» на эту картинку.
Текст такого ответа не попадает в модель, обычный диалог, память или логи.
Jarvis вводит его в ту же форму HH, допускает один native answer POST и делает
read-only проверку исходного target. Только штатный reader подтверждает успех.

При успехе бот сообщает о продолжении сбора; выключенный поиск не включается.
При неуспехе доступ остаётся закрыт и бот предлагает новую картинку. Новые
картинки не означают повторную отправку старого ответа. Отдельная кнопка
«Обновить картинку» позволяет явно запросить свежую CAPTCHA. В меню поиска
доступен owner/private пункт проверки HH вместо ссылки на Tailscale.

Ответ принимается только от владельца, в исходном private chat/conversation,
через reply к известному message ID. Обычный текст не считается ответом на
капчу. Чужие, просроченные, заменённые и уже использованные картинки отклоняются.
Ответ расходуется атомарно до запроса к browser. Неопределённая доставка фото
и неизвестный результат answer POST не запускаются повторно под новым ID.
Невалидный текст не расходует картинку; диагностические сообщения фиксированные.

## Browser и закрытый контракт

Один headless Chromium сохраняет прежний owner-bound профиль и журнал claims.
Manual coordinator и пауза без таймера сохраняются как механизм ручного ответа;
старые unresolved записи не сбрасываются. Xvfb, VNC, CDP и web gateway не нужны.

Приватный HTTP broker на 8082 в существующей job-browser-rpc сети доступен только
с отдельным bearer `JARVIS_JOB_CAPTCHA_TOKEN` и `x-jarvis-owner-id`.
Флаг `JARVIS_HH_CAPTCHA_TELEGRAM=1` одинаково включён для browser/server/collector.
Token отличен от read/apply, передаётся только browser и server. Collector его
не получает. Нет host ports или WebSocket.

Все операции — POST `/rpc`, content-type application/json, closed shape,
body <=8192; duplicate JSON keys/headers и лишние поля отклоняются до действия.
Envelope `{operation,args}`; ответ `{ok:true,value}` либо закрытый failure code.

- `status`, args `{}` → `{phase,revision}` с прежними phase.
- `challenge`, args `{refresh:boolean}` → `{outcome:'idle'}` либо
  `{outcome:'ready',challengeId:uuid,revision:integer,pngBase64:string,expiresAt:ISO}`.
  Без refresh текущая готовая картинка переиспользуется, а не перевыпускается
  на каждом tick. Новая выдача замещает предыдущий challengeId.
- `answer`, args `{challengeId:uuid,revision:integer,operationId:uuid,text:string}`
  → `{outcome:'solved'|'new_challenge'|'unknown'|'stale'|'invalid'|'already_used'}`.

Challenge действует 10 минут; это срок конкретной картинки, не таймер паузы.
PNG <=256KiB и <=1024×256 pixels. Проверяются HH origin, exact target/form/key,
видимость и natural dimensions. В broker не уходят form state, key или URL.
Перед submit проверяются та же форма, ключ и revision; durable claim фиксируется
до отправки. Replay/старый ключ/перезапуск не разрешают второй answer POST.
Ручной ответ нормализуется trim/lowercase/одиночный пробел; текущий HH RU guard
остаётся ограничен двумя кириллическими словами. Другой формат отклоняется
без расширения сетевых полномочий. OCR/модель не решают присланную человеку картинку.

Проверка результата использует временную read-only вкладку, закрываемую в finally.
Сбор и отклики заблокированы в pending/active/checking. При включённом Telegram
режиме CAPTCHA сразу передаётся человеку, без предварительной OCR-попытки.
Существующий OCR opt-in режим остаётся доступным только при выключенном Telegram
режиме и не получает Telegram ответы или новые полномочия.

## Server, PostgreSQL, Telegram

Отдельные небольшие client/repository/service/worker. Forward-only migration
для durable challenge delivery/reply state: owner/conversation/chat, challenge ID,
revision, expiry, delivery status/message ID, operation ID и outcome. Никаких
PNG, CAPTCHA текста, cookies, URL формы или токенов в таблицах/истории/телеметрии.
Reply перехватывается после update claim и авторизации, до appendMessage/AI и
до обычного guided input. Неизвестный reply к CAPTCHA не попадает в диалог.
Новые callback grammar закрыты, scope проверяется по repository, не по подписи.
Guided-input kind не добавляется: используется явный reply-to-message binding.

Фото отправляется тем же Jarvis Bot через ограниченный media transport. Worker
записывает message ID только при подтверждённом ответе Bot API. Lost ACK → unknown,
без автоповторной отправки. PNG временный в памяти, caption фиксированный.

## Удаление HH Tailscale пути

Удалить `job-manual/`, VNC broker/entrypoint/test fixtures, ws runtime dependency
если больше не используется, Xvfb/x11vnc image install, job-manual-de profile,
job-manual-control network и HH-specific systemd proxy/scripts/tests.
Удалить `JARVIS_JOB_MANUAL_*`, manual URL config/gate/Telegram кнопку «Открыть HH».
Живые документы описывают новый путь. Датированные старые решения/результаты
сохраняются как история с явной ссылкой на замену; Git history не переписывается.

На DE удалить только наш `/hh/` Serve handler HTTPS443 и пустой listener,
сохранив существующий HTTPS10000 `/` и любые чужие handlers. Отключить и удалить
только проверенные HH proxy units/launcher, gateway container и пустую отдельную
сеть. Старые HH env keys удалить из актуального release env без вывода значений.
Профиль, резюме, exclusions, PostgreSQL, OCR, VPN и остальные Tailscale применения
не удаляются. На NL синхронизировать исходники без запуска HH компонентов.

## Проверки и выпуск

Реальные Chromium fixtures: snapshot, stale/replaced picture, restart, duplicate
answer, native XHR, unknown dispatch и exact-target verification. HTTP broker:
credential/owner/body bounds/closed grammar/no arbitrary target. Real PostgreSQL
через message/menu handlers: owner/member/foreign chat, invalid retry, replay,
single consumption, stale photo, lost photo ACK и no history/model calls.
Focused Telegram gate и полный server suite; проверка удаления active HH TS refs.
Immutable releases, secret/profile inode preservation, health и runtime hashes.
Публикация и оба VPS явно поручены владельцем в текущей работе. Live приёмка:
реальное фото в Telegram, ручной reply и подтверждённое чтение HH после ответа.
